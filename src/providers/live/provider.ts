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
import {
  decodePacket,
  prepareMeetingSocket,
  resolveTimingUrl,
  upgradeToSecureSocket,
} from './decode';
import { applyPacket, emptyState, type LiveFeedState } from './state';
import { LIVE_CAPABILITIES, NatsoftAdapter } from './adapter';

const BACKOFF = [1000, 2000, 4000, 8000, 16000, 30000];
const PUBLISH_MS = 500;
const MAX_REDIRECTS = 3;
const MEETING_RECHECK_MS = 30_000;

function fileSlug(pageUrl: string): string {
  const path = new URL(pageUrl).pathname.split('/').filter(Boolean).pop() ?? 'meeting';
  return (
    path
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'meeting'
  );
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
  private readonly initialSocketUrl: string;
  private socketUrl: string;
  private bootstrap: AbortController | null = null;

  constructor(pageUrl: string) {
    const resolved = resolveTimingUrl(pageUrl);
    const page = new URL(resolved.pageUrl);
    page.search = '';
    page.hash = '';
    this.pageUrl = page.href;
    const pageProtocol = typeof window !== 'undefined' ? window.location.protocol : 'https:';
    this.initialSocketUrl = upgradeToSecureSocket(resolved.socketUrl, pageProtocol);
    this.socketUrl = this.initialSocketUrl;
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
    void this.open();
  }

  disconnect() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.closeConnection();
    this.status = {
      connection: 'stopped',
      message: 'Live timing stopped',
      paused: false,
      speed: 1,
    };
    this.announce();
  }

  private async open() {
    if (this.stopped) return;
    this.status = {
      connection: 'connecting',
      message: 'Connecting to live timing',
      paused: false,
      speed: 1,
    };
    this.announce();
    const bootstrap = new AbortController();
    this.bootstrap = bootstrap;
    let socket: WebSocket;
    try {
      const url = await prepareMeetingSocket(
        this.socketUrl,
        AbortSignal.any([bootstrap.signal, AbortSignal.timeout(8000)]),
      );
      if (this.stopped || this.bootstrap !== bootstrap) return;
      socket = new WebSocket(url);
    } catch {
      if (this.bootstrap === bootstrap) this.scheduleRetry('Could not open the timing connection');
      return;
    } finally {
      if (this.bootstrap === bootstrap) this.bootstrap = null;
    }
    this.socket = socket;
    this.connectCount += 1;
    this.state = emptyState();
    this.lastPacketMono = performance.now();
    this.watchdogTimer = setInterval(() => this.watchdog(), 2000);

    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      try {
        const xml = decodePacket(String(event.data));
        const result = applyPacket(this.state, xml);
        if (result.redirect !== undefined) {
          this.followRedirect(result.redirect);
          return;
        }
        if (result.change === 'none') return;
        this.lastPacketMono = performance.now();
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
          this.scheduleRetry(error.message, MEETING_RECHECK_MS);
        }
        // Other malformed packets are ignored; the last valid snapshot stands.
      }
    };
    socket.onerror = () => {
      // onclose follows with the retry; nothing to do here.
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
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
      this.socketUrl = upgradeToSecureSocket(
        resolved.socketUrl,
        new URL(this.socket?.url ?? this.socketUrl).protocol === 'wss:' ? 'https:' : 'http:',
      );
    } catch {
      this.scheduleRetry('Timing server redirect was rejected');
      return;
    }
    this.closeConnection();
    void this.open();
  }

  private schedulePublish() {
    if (this.publishTimer || this.stopped) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      if (this.stopped || !this.socket) return;
      this.publishNow();
    }, PUBLISH_MS);
  }

  private publishNow() {
    try {
      const snapshot = this.adapter.build(this.state);
      if (snapshot) {
        this.lastPublishMono = performance.now();
        this.emit(snapshot);
        if (this.status.connection !== 'connected') {
          this.attempt = 0;
          this.status = {
            connection: 'connected',
            message: 'Live timing · Natsoft feed',
            paused: false,
            speed: 1,
          };
          this.announce();
        }
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
    if (this.stopped || !this.socket) return;
    const now = performance.now();
    const connected = this.status.connection === 'connected';
    if (connected && now - this.lastPublishMono >= 2000) this.publishNow();
    const phase = this.adapter.phase;
    if (now - this.lastPacketMono > 30000 && (!connected || phase !== 'finished')) {
      this.socket?.close();
    }
  }

  private scheduleRetry(message: string, meetingRecheck?: number) {
    if (this.stopped) return;
    this.closeConnection();
    const delay = meetingRecheck ?? BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)];
    this.attempt += 1;
    this.status = {
      connection: meetingRecheck ? 'error' : 'reconnecting',
      message: meetingRecheck
        ? message + ' Checking again in 30 seconds.'
        : message + ' · retrying',
      paused: false,
      speed: 1,
    };
    this.announce();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.redirects = 0;
      this.socketUrl = this.initialSocketUrl;
      void this.open();
    }, delay);
  }

  private closeConnection() {
    this.bootstrap?.abort();
    this.bootstrap = null;
    if (this.publishTimer) clearTimeout(this.publishTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.publishTimer = this.watchdogTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
  }
}
