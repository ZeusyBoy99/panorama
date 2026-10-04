import { beforeEach, describe, it, expect, vi } from 'vitest';
import { RaceEngine } from '../src/providers/mock/engine';
import { SessionController } from '../src/state/controller';
import { useRace } from '../src/state/store';
import { MockProvider } from '../src/providers/mock/provider';
import { parseRecording, ReplayProvider, type Recording } from '../src/providers/replay/provider';
import { readSnapshot, saveSnapshot } from '../src/persistence/storage';
function fixture(): Recording {
  const e = new RaceEngine(),
    records = [];
  for (let offset = 0; offset <= 10000; offset += 1000) {
    if (offset) e.advance(1000);
    records.push({ offset, snapshot: e.snapshot('sector', 'recording', offset / 1000 + 1) });
  }
  return { format: 'panorama-replay', version: 1, name: 'test', records };
}
beforeEach(() => {
  useRace.setState({ snapshot: null, rejected: 0, accepted: 0, validationError: null });
});
describe('session acceptance, cleanup and replay', () => {
  it('rejects old/duplicate and malformed snapshots, accepts new stream reset and prevents retired stream return', () => {
    const c = new SessionController(),
      s = new RaceEngine().snapshot('position', 'one', 8);
    expect(c.accept(s)).toBe(true);
    expect(c.accept(s)).toBe(false);
    expect(c.accept({ ...s, sequence: 7 })).toBe(false);
    expect(c.accept({ ...s, schemaVersion: 9 })).toBe(false);
    expect(useRace.getState().snapshot?.sequence).toBe(8);
    expect(c.accept({ ...s, streamId: 'two', sequence: 0 })).toBe(true);
    expect(c.accept({ ...s, sequence: 99 })).toBe(false);
    expect(
      c.accept({
        ...s,
        sessionId: 'fresh',
        session: { ...s.session, id: 'fresh' },
        streamId: 'three',
        sequence: 0,
      }),
    ).toBe(true);
  });
  it('deduplicates supplied event IDs and replaces explicit invalidations', () => {
    const c = new SessionController(),
      e = new RaceEngine(),
      s = e.snapshot();
    s.events.push(s.events[0]);
    c.accept(s);
    expect(new Set(useRace.getState().snapshot?.events.map((e) => e.id)).size).toBe(
      useRace.getState().snapshot?.events.length,
    );
    c.accept(e.snapshot('classification', 'next', 1));
    expect(useRace.getState().snapshot?.entries[0].lastLap).toBeNull();
  });
  it('disconnects subscriptions on source switch and late old messages cannot mutate state', () => {
    const c = new SessionController(),
      a = new MockProvider(),
      b = new MockProvider(44);
    c.switchTo(a);
    const first = useRace.getState().snapshot!.streamId;
    c.switchTo(b);
    const second = useRace.getState().snapshot!.streamId;
    a.inject('stream');
    expect(useRace.getState().snapshot!.streamId).toBe(second);
    expect(second).not.toBe(first);
    c.stop();
  });
  it('outage lasts 15 real seconds at 20x and resynchronises from full snapshot', () => {
    vi.useFakeTimers();
    const p = new MockProvider(),
      c = new SessionController();
    c.switchTo(p);
    p.setSpeed(20);
    const start = useRace.getState().snapshot!.session.elapsed;
    p.inject('outage');
    c.resync();
    expect(useRace.getState().snapshot!.session.elapsed).toBe(start);
    p.setPaused(true);
    expect(useRace.getState().snapshot!.session.elapsed).toBe(start);
    p.setPaused(false);
    vi.advanceTimersByTime(14900);
    expect(useRace.getState().status.connection).toBe('reconnecting');
    expect(useRace.getState().snapshot!.session.elapsed).toBe(start);
    vi.advanceTimersByTime(600);
    expect(useRace.getState().status.connection).toBe('connected');
    expect(useRace.getState().snapshot!.session.elapsed).toBeGreaterThan(start);
    c.stop();
    vi.useRealTimers();
  });
  it('backward replay seek replaces future state and provides a continuous playback clock', () => {
    const recording = fixture(),
      p = new ReplayProvider(recording);
    p.seek(8000);
    const later = p.getFullSnapshot();
    p.seek(1000);
    const back = p.getFullSnapshot();
    expect(back.entries).toEqual(recording.records[1].snapshot.entries);
    expect(back.events).toEqual(recording.records[1].snapshot.events);
    expect(back.session.elapsed).toBeLessThan(later.session.elapsed);
    expect(back.streamId).not.toBe(later.streamId);
    p.seek(1500);
    expect(p.getFullSnapshot().session.elapsed).toBe(
      recording.records[0].snapshot.session.elapsed + 1500,
    );
  });
  it('rejects invalid JSON, version, count and non-monotonic replay records', () => {
    const r = fixture();
    expect(parseRecording(JSON.stringify(r)).records.length).toBe(11);
    expect(() => parseRecording('bad')).toThrow('JSON');
    expect(() => parseRecording(JSON.stringify({ ...r, version: 2 }))).toThrow('Invalid replay');
    expect(() =>
      parseRecording(JSON.stringify({ ...r, records: [r.records[1], r.records[0]] })),
    ).toThrow();
    expect(() => parseRecording(' '.repeat(8 * 1024 * 1024 + 1))).toThrow('too large');
  });
  it('cache retains original receipt and source identity and fails gracefully when unavailable', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    });
    const s = { ...new RaceEngine().snapshot(), receiptTimestamp: 123 };
    expect(saveSnapshot(s)).toBe(true);
    expect(readSnapshot()?.receiptTimestamp).toBe(123);
    const c = new SessionController();
    c.hydrate();
    expect(useRace.getState().cached).toBe(true);
    expect(useRace.getState().snapshot?.receiptTimestamp).toBe(123);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw Error('denied');
      },
      setItem: () => {
        throw Error('quota');
      },
    });
    expect(readSnapshot()).toBeNull();
    expect(saveSnapshot(s)).toBe(false);
    vi.unstubAllGlobals();
  });
});
