/**
 * Possible-incident detection for live timing.
 *
 * A normal overtake moves a car one or two places. When a car suddenly falls
 * several places in a short window it has usually gone off, spun, sustained
 * damage or stacked behind an incident — but the timing feed never says which,
 * so every alert is explicitly a *possible* incident, never a crash claim.
 *
 * Rules (tuned for a ~30-car field, documented in docs/live-integration.md):
 * - only race sessions: qualifying/practice orders swing legitimately;
 * - trigger when a car is 5+ places worse than its best position inside a
 *   trailing 90-second window;
 * - the drop must still be there 20 seconds later (confirmation): a car that
 *   pits, or immediately recovers, never alerts. Pit stops in particular show
 *   position losses before their pit flags arrive, so firing instantly would
 *   cry wolf on every stop;
 * - suppress while pitting, while the leader is still on laps 1-2 (start
 *   shuffles), and unless the session is running;
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
const CONFIRM_MS = 20_000;
const COOLDOWN_MS = 180_000;
const DROP_THRESHOLD = 5;

interface Sample {
  pos: number;
  at: number;
}

export class IncidentDetector {
  private history = new Map<string, Sample[]>();
  private pending = new Map<string, { from: number; since: number }>();
  private cooldownUntil = new Map<string, number>();

  /**
   * Feed the latest classified position. Returns an alert once a drop is
   * both observed and confirmed 20 s later, otherwise null. `pitting` covers
   * pit-lane status and pit stop count changes; callers must pass true
   * whenever a stop may explain the loss.
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

    if (options.pitting || !options.running || options.leaderLaps < 2) {
      this.pending.delete(entryId);
      return null;
    }
    if (samples.length < 2) return null;
    if ((this.cooldownUntil.get(entryId) ?? 0) > at) {
      this.pending.delete(entryId);
      return null;
    }

    let best = samples[0];
    for (const s of samples) if (s.pos < best.pos) best = s;
    const drop = pos - best.pos;
    const armed = this.pending.get(entryId);
    if (drop < DROP_THRESHOLD || at - best.at > WINDOW_MS) {
      this.pending.delete(entryId);
      return null;
    }
    if (!armed || armed.from !== best.pos || armed.since !== best.at) {
      // First sighting of this drop: wait for confirmation.
      this.pending.set(entryId, { from: best.pos, since: best.at });
      return null;
    }
    if (at - armed.since < CONFIRM_MS) return null;
    this.pending.delete(entryId);
    this.cooldownUntil.set(entryId, at + COOLDOWN_MS);
    return {
      entryId,
      from: armed.from,
      to: pos,
      drop: pos - armed.from,
      seconds: Math.max(1, Math.round((at - armed.since) / 1000)),
      at,
    };
  }

  reset(): void {
    this.history.clear();
    this.pending.clear();
    this.cooldownUntil.clear();
  }
}
