import { trackPoints, pitPoints, type TrackPoint } from '../../assets/track';
function lookup(source: readonly TrackPoint[]) {
  const points = source.filter(
    (p, i) => !i || p[0] !== source[i - 1][0] || p[1] !== source[i - 1][1],
  );
  const lengths = [0];
  for (let i = 1; i < points.length; i++)
    lengths.push(
      lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]),
    );
  return { points, lengths, total: lengths.at(-1)! };
}
const main = lookup(trackPoints),
  pit = lookup(pitPoints);
export function pointAt(progress: number, isPit = false) {
  const data = isPit ? pit : main;
  const p = isPit ? Math.max(0, Math.min(1, progress)) : ((progress % 1) + 1) % 1;
  const distance = p * data.total;
  let i = 1;
  while (i < data.lengths.length - 1 && distance > data.lengths[i]) i++;
  const a = data.points[i - 1],
    b = data.points[i],
    f = (distance - data.lengths[i - 1]) / (data.lengths[i] - data.lengths[i - 1]);
  return {
    x: a[0] + (b[0] - a[0]) * f,
    y: a[1] + (b[1] - a[1]) * f,
    angle: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI,
  };
}
