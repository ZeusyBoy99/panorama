import { describe, it, expect } from 'vitest';
import {
  FALLBACK_RATE,
  MAX_LEG_JUMP,
  forwardDelta,
  medianRate,
  observeReport,
  renderProgress,
  type LegStats,
} from '../src/features/map/liveMotion';

describe('live dead reckoning', () => {
  it('advances between reports at the learned pace and holds at one segment', () => {
    const fleet: LegStats[] = [];
    // Two reports 1/7 of a lap apart over 21 s of race time.
    let m = observeReport(null, 0.5 / 7, 0, fleet);
    m = observeReport(m, 1.5 / 7, 21_000, fleet);
    expect(m.rate).toBeCloseTo(1 / 7 / 21_000, 10);
    // Half a leg after the second report: halfway to the next midpoint.
    expect(renderProgress(m, 31_500)).toBeCloseTo(2 / 7, 5);
    // Far future: clamped one segment past the anchor, never runaway.
    expect(renderProgress(m, 1_000_000)).toBeCloseTo(2.5 / 7, 5);
    // Before the report: holds at the anchor.
    expect(renderProgress(m, -5_000)).toBeCloseTo(1.5 / 7, 5);
  });
  it('wraps across start/finish', () => {
    expect(forwardDelta(0.95, 0.05)).toBeCloseTo(0.1, 10);
    const fleet: LegStats[] = [];
    let m = observeReport(null, 0.95, 0, fleet);
    m = observeReport(m, 0.05, 10_000, fleet);
    // Half a leg after the report: 0.05 + 0.05 = 0.10.
    expect(renderProgress(m, 15_000)).toBeCloseTo(0.1, 5);
  });
  it('re-anchors on implausible jumps without learning a bogus pace', () => {
    const fleet: LegStats[] = [];
    let m = observeReport(null, 0.2, 0, fleet);
    m = observeReport(m, 0.3, 10_000, fleet);
    const rate = m.rate;
    expect(rate).toBeGreaterThan(0);
    // A >35% jump: snap, keep the old pace, learn nothing.
    m = observeReport(m, 0.3 + MAX_LEG_JUMP + 0.1, 20_000, fleet);
    expect(renderProgress(m, 20_000)).toBeCloseTo(0.3 + MAX_LEG_JUMP + 0.1, 5);
    expect(m.rate).toBe(rate);
    expect(fleet).toHaveLength(1);
  });
  it('ignores duplicates and pit-dwell gaps when learning pace', () => {
    const fleet: LegStats[] = [];
    let m = observeReport(null, 0.2, 0, fleet);
    m = observeReport(m, 0.3, 10_000, fleet);
    expect(fleet).toHaveLength(1);
    // Same timestamp again: no new leg learned.
    m = observeReport(m, 0.4, 10_000, fleet);
    expect(fleet).toHaveLength(1);
    // Three-minute gap (e.g. pit dwell): re-anchored, pace untouched.
    const rate = m.rate;
    m = observeReport(m, 0.45, 200_000, fleet);
    expect(fleet).toHaveLength(1);
    expect(m.rate).toBe(rate);
  });
  it('lends the fleet pace to cars with no history yet', () => {    const fleet: LegStats[] = [{ delta: 1 / 7, dur: 21_000 }];
    const m = observeReport(null, 0.5, 0, fleet);
    expect(m.rate).toBeCloseTo(1 / 7 / 21_000, 10);
    const fresh = observeReport(null, 0.5, 0, []);
    expect(fresh.rate).toBe(FALLBACK_RATE);
    expect(medianRate([])).toBe(FALLBACK_RATE);
  });
});
