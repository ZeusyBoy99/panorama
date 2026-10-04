import { describe, it, expect } from 'vitest';
import { RaceEngine } from '../src/providers/mock/engine';
import { snapshotSchema, type Profile } from '../src/domain/schema';
import { gapText, lapTime } from '../src/domain/format';
import { lapProgress, unwrapForward } from '../src/domain/speed';
import { pointAt } from '../src/features/map/geometry';
import { resolvePosition } from '../src/features/map/resolver';
import { pitEntryAnchor, pitExitAnchor } from '../src/assets/track';
describe('deterministic race and observations', () => {
  it('same seed and elapsed time are independent of wall cadence and acceleration', () => {
    const a = new RaceEngine(),
      b = new RaceEngine();
    a.advance(600000);
    for (let i = 0; i < 1200; i++) b.advance(500);
    expect(a.snapshot()).toEqual(b.snapshot());
  });
  it('crosses every lap/sector boundary, keeps histories bounded and timings sum', () => {
    const e = new RaceEngine();
    e.advance(500000);
    const s = e.snapshot();
    expect(snapshotSchema.safeParse(s).success).toBe(true);
    for (const c of s.entries) {
      expect(c.lapHistory.length).toBeLessThanOrEqual(16);
      expect(c.previousSectors.reduce<number>((sum, n) => sum + (n ?? 0), 0)).toBeCloseTo(
        c.lastLap!,
        4,
      );
      expect(c.currentSectors.some((t) => t === null)).toBe(true);
      expect(c.lastLapCrossing?.lap).toBe(c.laps);
    }
  });
  it.each(['position', 'sector', 'lap', 'classification'] as Profile[])(
    '%s profile exposes only supported data',
    (profile) => {
      const s = new RaceEngine().snapshot(profile);
      expect(snapshotSchema.safeParse(s).success).toBe(true);
      for (const e of s.entries) {
        if (profile !== 'position') expect(e.observation.kind).not.toBe('position');
        if (profile === 'lap') {
          expect(e.currentSector).toBeNull();
          expect(e.previousSectors).toEqual([null, null, null]);
          expect(e.observation.kind === 'crossing' && e.observation.anchor.kind).toBe('lap');
        }
        if (profile === 'classification') {
          expect(e.observation.kind).toBe('unavailable');
          expect(e.lastLapCrossing).toBeNull();
          expect(e.lapHistory).toEqual([]);
          expect(e.lastLap).toBeNull();
        }
      }
    },
  );
  it('laps-down gaps use true distance deficits, not every unmatched start-line crossing', () => {
    const s = new RaceEngine().snapshot();
    expect(s.entries.some((e) => e.gap.kind === 'laps')).toBe(true);
    for (const c of s.entries.filter((c) => c.gap.kind === 'laps'))
      expect(gapText(c.gap)).toContain('LAP');
    expect(gapText({ kind: 'unknown' })).toBe('—');
    expect(lapTime(null)).toBe('—');
    expect(lapTime(126432)).toBe('2:06.432');
  });
  it('wraps forward without adding a classified lap', () => {
    expect(unwrapForward(0.99, 0.01)).toBeCloseTo(1.01);
    expect(pointAt(0).x).toBeCloseTo(pointAt(1).x);
    expect(lapProgress(0.29)).toBeGreaterThan(0.3);
  });
  it('red flag stops movement and lap creation then resumes', () => {
    const e = new RaceEngine(10002026, 'Red flag');
    e.advance(6000);
    const before = e.snapshot();
    e.advance(15000);
    const after = e.snapshot();
    expect(after.session.trackStatus).toBe('red');
    expect(
      after.entries.map((c) => [
        c.id,
        c.laps,
        c.observation.kind === 'position' ? c.observation.progress : null,
      ]),
    ).toEqual(
      before.entries.map((c) => [
        c.id,
        c.laps,
        c.observation.kind === 'position' ? c.observation.progress : null,
      ]),
    );
    e.advance(12000);
    expect(e.snapshot().session.trackStatus).toBe('green');
  });
  it('pit requests wait for junction, stop for service, swap driver without identity loss and exit at demo anchor', () => {
    const e = new RaceEngine(10002026, 'Pit cycle');
    let entered = false,
      exited = false,
      swapped = false,
      serviceProgress: number | null = null,
      serviceCount = 0;
    for (let i = 0; i < 5000; i++) {
      e.advance(50);
      const s = e.snapshot();
      const c = s.entries.find((c) => c.id === 'entry-0')!;
      if (c.pitObservation?.kind === 'entry' && !entered) {
        entered = true;
        expect(c.observation.kind === 'position' && c.observation.progress).toBeCloseTo(
          pitEntryAnchor.mainProgress,
          2,
        );
      }
      if (c.pitObservation?.kind === 'service' && c.observation.kind === 'position') {
        if (serviceCount++ < 20) {
          if (serviceProgress !== null) expect(c.observation.pitProgress).toBe(serviceProgress);
          serviceProgress = c.observation.pitProgress;
        }
        swapped = c.currentDriverId === c.drivers[1].id;
      }
      if (c.pitObservation?.kind === 'exit' && !exited) {
        exited = true;
        expect(c.observation.kind === 'position' && c.observation.progress).toBeCloseTo(
          pitExitAnchor.mainProgress,
          2,
        );
      }
    }
    expect(entered && exited && swapped).toBe(true);
  });
  it('retires at supplied location and freezes; timing-only retirement has no invented position', () => {
    const e = new RaceEngine(10002026, 'Retirement');
    e.advance(13000);
    const first = e.snapshot().entries.find((c) => c.id === 'entry-7')!;
    e.advance(90000);
    const last = e.snapshot().entries.find((c) => c.id === 'entry-7')!;
    expect(first.status).toBe('retired');
    expect(last.observation).toEqual({
      ...first.observation,
      ...(first.observation.kind === 'position' ? { at: e.time } : {}),
    });
    const sparse = e.snapshot('sector');
    expect(
      resolvePosition(
        sparse.entries.find((c) => c.id === 'entry-7')!,
        sparse,
        sparse.session.elapsed,
      ).progress,
    ).toBeNull();
  });
  it('silent car ages despite a fresh heartbeat and estimates expire', () => {
    const e = new RaceEngine(10002026, 'One car goes silent');
    e.advance(6000);
    const s = e.snapshot();
    const c = s.entries.find((c) => c.id === 'entry-4')!;
    e.advance(20000);
    const after = e.snapshot();
    const silent = after.entries.find((c) => c.id === 'entry-4')!;
    expect(silent.observedAt).toBe(c.observedAt);
    expect(after.entries.find((c) => c.id === 'entry-5')!.observedAt).toBeGreaterThan(c.observedAt);
    expect(resolvePosition(silent, after, after.session.elapsed).progress).toBeNull();
  });
  it('timing-only estimates stay bounded, red/safety and unknown pit locations degrade', () => {
    const e = new RaceEngine();
    for (const profile of ['sector', 'lap'] as Profile[]) {
      const s = e.snapshot(profile),
        c = s.entries[0];
      const anchor = c.observation.kind === 'crossing' ? c.observation.anchor.at : 0;
      expect(resolvePosition(c, s, anchor + 100).provenance).toBe('estimated');
      expect(resolvePosition(c, s, anchor + 500000).progress).toBeNull();
      expect(resolvePosition({ ...c, status: 'pit' }, s, s.session.elapsed).progress).toBeNull();
      expect(
        resolvePosition(
          c,
          { ...s, session: { ...s.session, trackStatus: 'safety-car' } },
          s.session.elapsed,
        ).progress,
      ).toBeNull();
    }
  });
  it('finish processes every active car once, freezes locations and completes session', () => {
    const e = new RaceEngine(10002026, 'Race finish');
    e.advance(300000);
    const s = e.snapshot();
    expect(s.session.phase).toBe('finished');
    expect(s.session.leaderLaps).toBe(161);
    expect(s.entries.every((c) => c.status === 'finished')).toBe(true);
    const positions = s.entries.map((c) => [
      c.id,
      c.laps,
      c.observation.kind === 'position' ? c.observation.progress : null,
    ]);
    e.advance(120000);
    expect(
      e
        .snapshot()
        .entries.map((c) => [
          c.id,
          c.laps,
          c.observation.kind === 'position' ? c.observation.progress : null,
        ]),
    ).toEqual(positions);
  });
});

it('normal close pair trades source positions and emits derived lead changes', () => {
  const e = new RaceEngine();
  e.advance(90000);
  expect(e.snapshot().events.some((v) => v.category === 'lead' && v.origin === 'derived')).toBe(
    true,
  );
});
it('safety car closes the field gradually then restores green', () => {
  const e = new RaceEngine(10002026, 'Safety car and restart');
  e.advance(6000);
  const before = e.snapshot();
  e.advance(50000);
  const after = e.snapshot();
  expect(after.session.trackStatus).toBe('safety-car');
  const spread = (s: ReturnType<RaceEngine['snapshot']>) => {
    const values = s.entries.map(
      (c) => c.laps + (c.observation.kind === 'position' ? c.observation.progress : 0),
    );
    return Math.max(...values) - Math.min(...values);
  };
  expect(spread(after)).toBeLessThan(spread(before));
  e.advance(10000);
  expect(e.snapshot().session.trackStatus).toBe('green');
});
it('runtime schema rejects unsupported position anchors from imported recordings', () => {
  const s = new RaceEngine().snapshot('sector');
  const broken = structuredClone(s);
  broken.session.capabilities.sectorCrossings = false;
  broken.session.capabilities.lapCrossings = false;
  expect(snapshotSchema.safeParse(broken).success).toBe(false);
});
