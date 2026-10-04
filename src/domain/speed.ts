import { sectorAnchors } from '../assets/track';
// Time-to-distance model: each sector integrates exactly to its demo boundary.
export const timeAnchors = [0, 0.29, 0.65, 1] as const;
export const distanceAnchors = [
  0,
  sectorAnchors[0].progress,
  sectorAnchors[1].progress,
  1,
] as const;
const shape = [
  [0, 0],
  [0.22, 0.14],
  [0.58, 0.72],
  [1, 1],
] as const;
function interpolate(points: readonly (readonly [number, number])[], value: number) {
  let i = 1;
  while (i < points.length - 1 && value > points[i][0]) i++;
  const a = points[i - 1],
    b = points[i];
  return a[1] + (b[1] - a[1]) * Math.max(0, Math.min(1, (value - a[0]) / (b[0] - a[0])));
}
export function sectorProgress(sector: number, fraction: number) {
  const p = interpolate(shape, Math.max(0, Math.min(1, fraction)));
  return distanceAnchors[sector] + (distanceAnchors[sector + 1] - distanceAnchors[sector]) * p;
}
export function lapProgress(fraction: number) {
  const f = Math.max(0, Math.min(1, fraction));
  const i = f < 0.29 ? 0 : f < 0.65 ? 1 : 2;
  return sectorProgress(i, (f - timeAnchors[i]) / (timeAnchors[i + 1] - timeAnchors[i]));
}
export function timeFraction(progress: number) {
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (lapProgress(m) < progress) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}
export function unwrapForward(previous: number, next: number) {
  const diff = next - previous;
  return diff < -0.5 ? next + 1 : next;
}
