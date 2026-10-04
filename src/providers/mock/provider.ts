import { capabilities, type Profile, type Snapshot } from '../../domain/schema';
import type { PlaybackControls, ProviderStatus, TimingProvider } from '../contract';
import { RaceEngine, type Scenario } from './engine';
export type Fault = 'outage' | 'duplicate' | 'stream' | 'session' | 'schema';
let streamNumber = 0;
export class MockProvider implements TimingProvider, PlaybackControls {
  readonly id = 'demo';
  private engine: RaceEngine;
  private stream = 'demo-' + ++streamNumber;
  private sequence = 0;
  private sessionId = 'bathurst-demo-2026';
  private snapshots = new Set<(s: unknown) => void>();
  private statuses = new Set<(s: ProviderStatus) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private published = 0;
  private started = 0;
  private autoFault = false;
  private recoveryAt = 0;
  private malformedUntil = 0;
  private status: ProviderStatus = {
    connection: 'connecting',
    message: 'Starting simulator',
    paused: false,
    speed: 1,
  };
  constructor(
    readonly seed = 10002026,
    readonly scenario: Scenario = 'Normal racing',
    readonly profile: Profile = 'position',
  ) {
    this.engine = new RaceEngine(seed, scenario);
  }
  get capabilities() {
    return capabilities(this.profile);
  }
  subscribeSnapshots(cb: (s: unknown) => void) {
    this.snapshots.add(cb);
    return () => {
      this.snapshots.delete(cb);
    };
  }
  subscribeStatus(cb: (s: ProviderStatus) => void) {
    this.statuses.add(cb);
    cb({ ...this.status });
    return () => {
      this.statuses.delete(cb);
    };
  }
  private announce() {
    this.statuses.forEach((cb) => cb({ ...this.status }));
  }
  private emit(s: unknown) {
    this.snapshots.forEach((cb) => cb(s));
  }
  getFullSnapshot(): Snapshot {
    const s = this.engine.snapshot(this.profile, this.stream, ++this.sequence);
    s.sessionId = this.sessionId;
    s.session.id = this.sessionId;
    return s;
  }
  connect() {
    if (this.timer) return;
    this.last = performance.now();
    this.started = this.last;
    this.status.connection = 'connected';
    this.status.message = 'Simulated feed';
    this.announce();
    this.emit(this.getFullSnapshot());
    this.timer = setInterval(() => this.pulse(), 50);
  }
  private pulse() {
    const now = performance.now(),
      dt = now - this.last;
    this.last = now;
    if (!this.status.paused) this.engine.advance(Math.min(dt, 2000) * this.status.speed);
    if (!this.autoFault && now - this.started >= 3000) {
      this.autoFault = true;
      const map: Partial<Record<Scenario, Fault>> = {
        'Feed outage': 'outage',
        'Duplicate / out-of-order': 'duplicate',
        'New stream / session': 'stream',
        'Schema errors': 'schema',
      };
      const fault = map[this.scenario];
      if (fault) this.inject(fault);
    }
    if (this.recoveryAt) {
      if (now < this.recoveryAt) return;
      this.recoveryAt = 0;
      this.status.connection = 'connected';
      this.status.message = 'Recovered from full snapshot';
      this.announce();
      this.emit(this.getFullSnapshot());
      this.published = now;
      return;
    }
    if (this.malformedUntil) {
      if (now < this.malformedUntil) return;
      this.malformedUntil = 0;
      this.status.connection = 'connected';
      this.status.message = 'Valid feed restored';
      this.announce();
    }
    if (now - this.published >= 500) {
      this.published = now;
      this.emit(this.getFullSnapshot());
    }
  }
  disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.status.connection = 'stopped';
    this.status.message = 'Stopped';
    this.announce();
  }
  setPaused(value: boolean) {
    this.status.paused = value;
    this.last = performance.now();
    this.status.message = value ? 'Playback intentionally paused' : 'Simulated feed';
    this.announce();
    if (!this.recoveryAt && !this.malformedUntil) this.emit(this.getFullSnapshot());
  }
  setSpeed(value: number) {
    this.status.speed = [1, 5, 20].includes(value) ? value : 1;
    this.announce();
  }
  reset() {
    this.engine = new RaceEngine(this.seed, this.scenario);
    this.stream = 'demo-' + ++streamNumber;
    this.sequence = 0;
    this.recoveryAt = 0;
    this.malformedUntil = 0;
    this.autoFault = false;
    this.started = performance.now();
    this.status.connection = 'connected';
    this.announce();
    this.emit(this.getFullSnapshot());
  }
  inject(fault: Fault) {
    if (fault === 'outage') {
      this.recoveryAt = performance.now() + 15000;
      this.status.connection = 'reconnecting';
      this.status.message = 'Injected outage · 15 real seconds';
      this.announce();
    } else if (fault === 'duplicate') {
      const s = this.getFullSnapshot();
      this.emit(s);
      this.emit({ ...s, sequence: s.sequence - 1 });
      this.emit(s);
    } else if (fault === 'session') {
      this.stream = 'demo-' + ++streamNumber;
      this.sessionId = 'bathurst-demo-2026-session-' + streamNumber;
      this.engine = new RaceEngine(this.seed, this.scenario);
      this.sequence = 0;
      this.emit(this.getFullSnapshot());
    } else if (fault === 'stream') {
      this.stream = 'demo-' + ++streamNumber;
      this.sequence = 0;
      this.emit(this.getFullSnapshot());
    } else {
      this.emit({ schemaVersion: 999, entries: 'malformed' });
      this.malformedUntil = performance.now() + 3000;
      this.status.connection = 'error';
      this.status.message = 'Injected invalid schema · last valid data retained';
      this.announce();
    }
  }
}
