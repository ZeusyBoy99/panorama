/**
 * Natsoft live-timing provider.
 *
 * Connects directly from the browser to the meeting's WebSocket endpoint
 * (derived from the user-supplied page URL, http->ws / https->wss, like the
 * official client). No credentials, no server proxy, no open fetch: only
 * explicit timing URLs are ever opened, redirects are revalidated and capped.
 *
 * Behaviour:
 * - merges full (<New>) and delta packets into one authoritative picture and
 *   publishes complete schemaVersion 1 snapshots at most every 500 ms;
 * - a new upstream epoch (<New> with a new Seq, or a reconnect) starts a new
 *   stream identity so the session controller can resynchronise cleanly;
 * - reconnects with bounded exponential backoff (1, 2, 4, 8, 16, then 30 s);
 * - the ~1 Hz countdown packets double as the feed heartbeat; per-car
 *   freshness still comes from each car's own last update, never the
 *   heartbeat.
 */

import type { Snapshot } from '../../domain/schema';
import type { ProviderStatus, TimingProvider } from '../contract';
import { decodePacket, resolveTimingUrl, upgradeToSecureSocket } from './decode';
import { applyPacket, emptyState, type LiveFeedState } from './state';
import { LIVE_CAPABILITIES, NatsoftAdapter } from './adapter';

const BACKOFF = [1000, 2000, 4000, 8000, 16000, 30000];
const PUBLISH_MS = 500;
const MAX_REDIRECTS = 3;

function fileSlug(pageUrl: string): string {
  const path = new URL(pageUrl).pathname.split('/').filter(Boolean).pop() ?? 'meeting';
  return path.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'meeting';
}

export class NatsoftLiveProvider implements TimingProvider {
  readonly id = 'live';
  readonly capabilities = { ...LIVE_CAPABILITIES };

  private state: LiveFeedState = emptyState();
  private adapter: NatsoftAdapter;
  private socket: WebSocket | null = null;
  private snapshots = new Set<(s: unknown) => void>();
  private statuses = new Set<(s: ProviderStatus) => void>();
  private status: ProviderStatus = {
    connection: 'connecting',
    message: 'Connecting to live timing',
    paused: false,
    speed: 1,
  };
  private stopped = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private publishTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private lastSnapshot: Snapshot | null = null;
  private lastPacketMono = 0;
  private lastPublishMono = 0;
  private connectCount = 0;
  private redirects = 0;
  readonly pageUrl: string;
  private socketUrl: string;

  constructor(pageUrl: string) {
    const resolved = resolveTimingUrl(pageUrl);
    this.pageUrl = resolved.pageUrl;
    const pageProtocol =
      typeof window !== 'undefined' ? window.location.protocol : 'https:';
    this.socketUrl = upgradeToSecureSocket(resolved.socketUrl, pageProtocol);
    this.adapter = new NatsoftAdapter(fileSlug(this.pageUrl), 'live');
  }

  subscribeSnapshots(cb: (s: unknown) => void) {
    this.snapshots.add(cb);
    return () => {
      this.snapshots.delete(cb);
    };
  }

  subscribeStatus(cb: (status: ProviderStatus) => void) {
    this.statuses.add(cb);
    cb({ ...this.status });
    return () => {
      this.statuses.delete(cb);
    };
  }

  private announce() {
    this.statuses.forEach((cb) => cb({ ...this.status }));
  }

  private emit(snapshot: Snapshot) {
    this.lastSnapshot = snapshot;
    this.snapshots.forEach((cb) => cb(snapshot));
  }

  getFullSnapshot(): Snapshot {
    if (!this.lastSnapshot) throw new Error('No live snapshot received yet');
    return structuredClone(this.lastSnapshot);
  }

  connect() {
    this.stopped = false;
    this.attempt = 0;
    this.open();
  }

  disconnect() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.publishTimer) clearTimeout(this.publishTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.retryTimer = this.publishTimer = this.watchdogTimer = null;
    this.socket?.close();
    this.socket = null;
    this.status = { connection: 'stopped', message: 'Live timing stopped', paused: false, speed: 1 };
    this.announce();
  }

  private open() {
    if (this.stopped) return;
    this.status = { connection: 'connecting', message: 'Connecting to live timing', paused: false, speed: 1 };
    this.announce();
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.socketUrl);
    } catch {
      this.scheduleRetry('Could not open the timing connection');
      return;
    }
    this.socket = socket;
    this.connectCount += 1;

    socket.onopen = () => {
      this.attempt = 0;
      this.redirects = 0;
      this.status = { connection: 'connected', message: 'Live timing · Natsoft feed', paused: false, speed: 1 };
      this.announce();
    };
    socket.onmessage = (event) => {
      try {
        const xml = decodePacket(String(event.data));
        this.lastPacketMono = performance.now();
        const result = applyPacket(this.state, xml);
        if (result.redirect !== undefined) {
          this.followRedirect(result.redirect);
          return;
        }
        if (result.change === 'reset') {
          const seq = /Seq="([^"]*)"/.exec(xml)?.[1] ?? String(this.connectCount);
          this.adapter = new NatsoftAdapter(
            fileSlug(this.pageUrl),
            'live-' + this.connectCount + '-' + seq,
          );
        }
        this.schedulePublish();
      } catch (error) {
        if (error instanceof Error && /not available/i.test(error.message)) {
          this.status = { connection: 'error', message: error.message, paused: false, speed: 1 };
          this.announce();
          this.closeAndStop();
        }
        // Other malformed packets are ignored; the last valid snapshot stands.
      }
    };
    socket.onerror = () => {
      // onclose follows with the retry; nothing to do here.
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (!this.stopped) this.scheduleRetry('Live timing connection lost');
    };
  }

  private followRedirect(url: string) {
    if (this.redirects >= MAX_REDIRECTS || !url) {
      this.scheduleRetry('Timing server redirect was rejected');
      return;
    }
    try {
      const resolved = resolveTimingUrl(url);
      if (!/^wss?:/i.test(resolved.socketUrl)) throw new Error('bad redirect');
      this.redirects += 1;
      this.socketUrl = resolved.socketUrl;
    } catch {
      this.scheduleRetry('Timing server redirect was rejected');
      return;
    }
    this.socket?.close();
    this.socket = null;
    this.open();
  }

  private schedulePublish() {
    if (this.publishTimer || this.stopped) return;
    if (!this.watchdogTimer) this.watchdogTimer = setInterval(() => this.watchdog(), 2000);
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      if (this.stopped || this.status.connection !== 'connected') return;
      this.publishNow();
    }, PUBLISH_MS);
  }

  private publishNow() {
    try {
      const snapshot = this.adapter.build(this.state);
      if (snapshot) {
        this.lastPublishMono = performance.now();
        this.emit(snapshot);
      }
    } catch {
      // A transient build failure must not kill the feed; retry next tick.
      this.schedulePublish();
    }
  }

  /**
   * Watchdog: guarantees the UI keeps refreshing (with honestly growing
   * ages) even if packets stall, and resynchronises when a running session
   * goes quiet for 30 s. A finished session going quiet is normal — the
   * last classification simply stands with its original timestamps.
   */
  private watchdog() {
    if (this.stopped || this.status.connection !== 'connected') return;
    const now = performance.now();
    if (now - this.lastPublishMono >= 2000) this.publishNow();
    const phase = this.adapter.phase;
    if (
      this.lastPacketMono > 0 &&
      now - this.lastPacketMono > 30000 &&
      phase !== '' &&
      phase !== 'finished'
    ) {
      this.socket?.close();
    }
  }

  private scheduleRetry(message: string) {
    if (this.stopped) return;
    const delay = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)];
    this.attempt += 1;
    this.status = {
      connection: 'reconnecting',
      message: message + ' · retrying',
      paused: false,
      speed: 1,
    };
    this.announce();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private closeAndStop() {
    this.socket?.close();
    this.socket = null;
  }
}
