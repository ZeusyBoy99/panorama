/**
 * Dead reckoning for coarse live position reports.
 *
 * The timing feed reports which track segment each car is in — it never says
 * where inside the segment a car is, or how fast it is going. Holding the
 * marker at the segment midpoint until the next report reads as a broken
 * snap. Instead the renderer glides forward from each report at the pace the
 * field is actually setting:
 *
 * - each car's rate is learned from its own recent report intervals
 *   (progress gained per millisecond of race clock);
 * - cars with no history yet borrow the fleet median;
 * - extrapolation never runs past one full segment length, then holds;
 * - implausible jumps (> 35% of a lap), duplicates and over-long gaps such
 *   as pit dwells re-anchor without teaching a bogus pace;
 * - everything runs on the race clock, so pause, caching, replay speed and
 *   seeking all behave.
 *
 * This is explicitly motion between measurements, not a measurement — the
 * map note says so.
 */

export interface MotionState {
  /** Ever-increasing unwrapped progress at the last report. */
  anchorU: number;
  /** Race-clock ms of the last report. */
  atRace: number;
  /** Learned progress per race-clock ms. */
  rate: number;
  /** Maximum forward extrapolation past the anchor (one segment). */
  maxExtra: number;
}

export interface LegStats {
  delta: number;
  dur: number;
}

/** One lap per 3 minutes of race time, used before anything is measured. */
export const FALLBACK_RATE = 1 / 180000;
const FALLBACK_EXTRA = 0.15;
/** Larger forward jumps are data glitches, not motion. */
export const MAX_LEG_JUMP = 0.35;
/** Intervals outside this window never teach pace (duplicates, pit dwells). */
const MIN_LEG_MS = 2000;
const MAX_LEG_MS = 120000;

function mod1(value: number): number {
  return ((value % 1) + 1) % 1;
}

/** Forward distance from one raw [0,1) progress to another. */
export function forwardDelta(fromRaw: number, toRaw: number): number {
  return mod1(toRaw - fromRaw);
}

/** Median learned pace across recent legs, or the fallback rate. */
export function medianRate(legs: readonly LegStats[]): number {
  const rates = legs
    .filter((l) => l.dur > 0 && l.delta > 0)
    .map((l) => l.delta / l.dur)
    .sort((a, b) => a - b);
  if (!rates.length) return FALLBACK_RATE;
  const mid = Math.floor(rates.length / 2);
  return rates.length % 2 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2;
}

/**
 * Fold a new segment report into motion state. `fleet` collects recent leg
 * statistics across cars (bounded by the caller, ~24 entries) so cars with
 * no history can borrow the field's pace.
 */
export function observeReport(
  prev: MotionState | null,
  raw: number,
  atRace: number,
  fleet: LegStats[],
): MotionState {
  if (!prev) return { anchorU: raw, atRace, rate: medianRate(fleet), maxExtra: FALLBACK_EXTRA };
  const delta = forwardDelta(mod1(prev.anchorU), raw);
  const dur = atRace - prev.atRace;
  if (dur > MIN_LEG_MS && dur <= MAX_LEG_MS && delta > 0 && delta <= MAX_LEG_JUMP) {
    fleet.push({ delta, dur });
    if (fleet.length > 24) fleet.shift();
    return { anchorU: prev.anchorU + delta, atRace, rate: delta / dur, maxExtra: delta };
  }
  if (delta > MAX_LEG_JUMP || delta <= 0 || dur <= 0) {
    return { anchorU: raw, atRace, rate: prev.rate, maxExtra: prev.maxExtra };
  }
  return {
    anchorU: prev.anchorU + delta,
    atRace,
    rate: prev.rate,
    maxExtra: Math.max(prev.maxExtra, delta),
  };
}

/** Render progress for the current race-clock time. */
export function renderProgress(m: MotionState, timeRace: number): number {
  const ahead = Math.min(m.rate * Math.max(0, timeRace - m.atRace), m.maxExtra);
  return mod1(m.anchorU + Math.max(0, ahead));
}
