/**
 * Possible-incident detection for live timing.
 *
 * A normal overtake moves a car one or two places. When a car suddenly falls
 * several places in a short window it has usually gone off, spun, sustained
 * damage or stacked behind an incident — but the timing feed never says which,
 * so every alert is explicitly a *possible* incident, never a crash claim.
 *
 * Rules (tuned for a ~30-car field, documented in docs/live-integration.md):
 * - trigger when a car is 5+ places worse than its best position inside a
 *   trailing 90-second window;
 * - suppress while pitting (position losses across pit stops are routine),
 *   while the leader is still on laps 1-2 (start shuffles), and unless the
 *   session is running;
 * - one alert per car per 3 minutes so a long recovery does not spam.
 */

export interface IncidentAlert {
  entryId: string;
  from: number;
  to: number;
  drop: number;
  seconds: number;
  at: number;
}

const WINDOW_MS = 90_000;
const COOLDOWN_MS = 180_000;
const DROP_THRESHOLD = 5;

interface Sample {
  pos: number;
  at: number;
}

export class IncidentDetector {
  private history = new Map<string, Sample[]>();
  private cooldownUntil = new Map<string, number>();

  /**
   * Feed the latest classified position. Returns an alert the first time the
   * drop rule trips, otherwise null. `pitting` covers pit-lane status and pit
   * stop count changes; callers must pass true whenever a stop may explain
   * the loss.
   */
  check(
    entryId: string,
    pos: number,
    at: number,
    options: { pitting: boolean; leaderLaps: number; running: boolean },
  ): IncidentAlert | null {
    if (!Number.isFinite(pos) || pos < 1) return null;
    let samples = this.history.get(entryId) ?? [];
    samples.push({ pos, at });
    const cutoff = at - WINDOW_MS;
    samples = samples.filter((s) => s.at >= cutoff);
    this.history.set(entryId, samples.slice(-40));

    if (options.pitting || !options.running || options.leaderLaps < 2) return null;
    if (samples.length < 2) return null;
    if ((this.cooldownUntil.get(entryId) ?? 0) > at) return null;

    let best = samples[0];
    for (const s of samples) if (s.pos < best.pos) best = s;
    const drop = pos - best.pos;
    if (drop < DROP_THRESHOLD) return null;
    if (at - best.at > WINDOW_MS) return null;

    this.cooldownUntil.set(entryId, at + COOLDOWN_MS);
    return {
      entryId,
      from: best.pos,
      to: pos,
      drop,
      seconds: Math.max(1, Math.round((at - best.at) / 1000)),
      at,
    };
  }

  reset(): void {
    this.history.clear();
    this.cooldownUntil.clear();
  }
}
