import type { Entry, Snapshot } from '../../domain/schema';
import { lapProgress, sectorProgress } from '../../domain/speed';
export interface MapPosition {
  progress: number | null;
  pitProgress: number | null;
  provenance: 'simulated' | 'reported' | 'estimated' | 'unavailable';
  confidence: 'high' | 'low' | 'stale' | 'unavailable';
  age: number;
  reason: string;
}
export function resolvePosition(entry: Entry, snapshot: Snapshot, elapsed: number): MapPosition {
  const base = {
    progress: null,
    pitProgress: null,
    provenance: 'unavailable' as const,
    confidence: 'unavailable' as const,
    age: Math.max(0, elapsed - entry.observedAt),
    reason: 'No position observations',
  };
  const observation = entry.observation,
    caps = snapshot.session.capabilities;
  if (
    snapshot.profile === 'classification' ||
    (entry.observation.kind === 'position' && !caps.positionSamples) ||
    (entry.observation.kind === 'crossing' &&
      (entry.observation.anchor.kind === 'lap' ? !caps.lapCrossings : !caps.sectorCrossings))
  )
    return { ...base, reason: 'Position capability unavailable' };
  if (observation.kind === 'unavailable') return base;
  if (observation.kind === 'position') {
    const age = Math.max(0, elapsed - observation.at);
    const reported = observation.provenance === 'reported';
    // Live segment reports never vanish: the marker holds its last honest
    // spot (gliding at most ~2 segments past it in the renderer) and fades
    // stale instead of inventing a disappearance.
    if (reported) {
      return {
        progress: observation.progress,
        pitProgress: observation.pitProgress,
        provenance: observation.provenance,
        confidence: age > 3000 ? 'stale' : 'high',
        age,
        reason: 'Reported track segment · marker glides between reports',
      };
    }
    const stale = age > 3000;
    return {
      progress: age > 15000 ? null : observation.progress,
      pitProgress: observation.pitProgress,
      provenance: observation.provenance,
      confidence: stale ? 'stale' : 'high',
      age,
      reason: stale ? 'Position sample is stale' : 'Timestamped simulated position sample',
    };
  }
  if (['pit', 'retired', 'stopped', 'finished'].includes(entry.status))
    return {
      ...base,
      reason:
        entry.status === 'pit'
          ? 'Pit status known; location unavailable'
          : 'Stopped position unavailable in timing feed',
    };
  if (['red', 'safety-car', 'yellow', 'unknown'].includes(snapshot.session.trackStatus))
    return { ...base, reason: 'Track status limits timing estimates' };
  const anchor = observation.anchor,
    age = Math.max(0, elapsed - anchor.at);
  const sector = snapshot.profile === 'sector' ? anchor.sector : 0;
  const expected = snapshot.profile === 'sector' ? entry.previousSectors[sector] : entry.lastLap;
  if (expected === null || expected <= 0)
    return { ...base, reason: 'No comparable duration for estimate' };
  const grace = Math.max(3000, expected * 0.15);
  if (age > expected + grace * 2)
    return { ...base, age, reason: 'Crossing overdue; estimate unavailable' };
  const fraction = Math.min(1, age / expected);
  const progress =
    snapshot.profile === 'sector' ? sectorProgress(sector, fraction) : lapProgress(fraction);
  return {
    progress: progress === 1 ? 0.9999 : progress,
    pitProgress: null,
    provenance: 'estimated',
    confidence: snapshot.profile === 'lap' || age > expected + grace ? 'low' : 'high',
    age,
    reason:
      age > expected
        ? 'Crossing overdue · estimate frozen at boundary'
        : snapshot.profile === 'lap'
          ? 'Lap-only model · lower confidence'
          : 'Anchored to confirmed sector crossing',
  };
}
