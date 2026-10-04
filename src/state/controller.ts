import { snapshotSchema, type Snapshot } from '../domain/schema';
import type { TimingProvider } from '../providers/contract';
import { readSnapshot, saveSnapshot } from '../persistence/storage';
import { useRace, useUI } from './store';
export class SessionController {
  private generation = 0;
  private cleanups: (() => void)[] = [];
  private provider: TimingProvider | null = null;
  private lastPersist = 0;
  private recording: Snapshot[] = [];
  private retiredStreams = new Set<string>();
  accept(input: unknown) {
    const parsed = snapshotSchema.safeParse(input);
    if (!parsed.success) {
      useRace.setState((s) => ({
        validationError: 'Rejected malformed feed: ' + parsed.error.issues[0].message,
        rejected: s.rejected + 1,
      }));
      return false;
    }
    const next = parsed.data,
      current = useRace.getState().snapshot,
      key = next.sessionId + ':' + next.streamId;
    if (
      this.retiredStreams.has(key) ||
      (current &&
        current.sessionId === next.sessionId &&
        current.streamId === next.streamId &&
        next.sequence <= current.sequence)
    ) {
      useRace.setState((s) => ({ rejected: s.rejected + 1 }));
      return false;
    }
    if (current && (current.streamId !== next.streamId || current.sessionId !== next.sessionId)) {
      this.retiredStreams.add(current.sessionId + ':' + current.streamId);
      if (this.retiredStreams.size > 32)
        this.retiredStreams.delete(this.retiredStreams.values().next().value!);
    }
    const uniqueEvents = Array.from(new Map(next.events.map((e) => [e.id, e])).values());
    const snapshot = { ...next, events: uniqueEvents, receiptTimestamp: Date.now() };
    useRace.setState((s) => ({
      snapshot,
      receivedMono: performance.now(),
      cached: false,
      validationError: null,
      accepted: s.accepted + 1,
    }));
    const selected = useUI.getState().selectedId;
    if (selected && !snapshot.entries.some((e) => e.id === selected)) useUI.getState().select(null);
    const last = this.recording.at(-1);
    if (
      !last ||
      last.profile !== snapshot.profile ||
      last.sessionId !== snapshot.sessionId ||
      snapshot.session.elapsed < last.session.elapsed
    )
      this.recording = [];
    if (
      !this.recording.length ||
      snapshot.session.elapsed > (this.recording.at(-1)?.session.elapsed ?? 0)
    ) {
      this.recording.push(structuredClone(snapshot));
      this.recording = this.recording.slice(-60);
    }
    if (performance.now() - this.lastPersist >= 2000) {
      this.lastPersist = performance.now();
      if (!saveSnapshot(snapshot)) useUI.setState({ storageError: true });
    }
    return true;
  }
  switchTo(provider: TimingProvider) {
    this.stop();
    const generation = ++this.generation;
    this.provider = provider;
    this.retiredStreams.clear();
    this.recording = [];
    useRace.setState({ snapshot: null, cached: false, validationError: null });
    this.cleanups = [
      provider.subscribeSnapshots((s) => {
        if (generation === this.generation) this.accept(s);
      }),
      provider.subscribeStatus((status) => {
        if (generation === this.generation) useRace.setState({ status });
      }),
    ];
    provider.connect();
  }
  resync() {
    if (this.provider && useRace.getState().status.connection === 'connected')
      this.accept(this.provider.getFullSnapshot());
  }
  hydrate() {
    const snapshot = readSnapshot();
    if (snapshot)
      useRace.setState({
        snapshot,
        cached: true,
        receivedMono: performance.now(),
        status: {
          connection: 'stopped',
          message: 'Last-known cached data',
          paused: true,
          speed: 1,
        },
      });
  }
  getRecording() {
    const first = this.recording[0]?.session.elapsed ?? 0;
    return {
      format: 'panorama-replay' as const,
      version: 1 as const,
      name: 'Panorama short recording',
      records: this.recording.map((snapshot) => ({
        offset: snapshot.session.elapsed - first,
        snapshot,
      })),
    };
  }
  stop() {
    ++this.generation;
    this.cleanups.forEach((f) => f());
    this.cleanups = [];
    this.provider?.disconnect();
    this.provider = null;
  }
}
export const controller = new SessionController();
