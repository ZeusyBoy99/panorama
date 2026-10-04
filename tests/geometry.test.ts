import { it, expect } from 'vitest';
import {
  trackPoints,
  pitPoints,
  pitSourcePoints,
  pitDisplayOffset,
  pitEntryAnchor,
  pitExitAnchor,
  pitServicePoint,
  pitServiceProgress,
  pitFinishProgress,
  startFinish,
  sectorAnchors,
} from '../src/assets/track';
import { pointAt } from '../src/features/map/geometry';
it('bundled geographical outline is closed, keeps real proportions and follows racing direction', () => {
  expect(trackPoints.length).toBeGreaterThan(300);
  expect(trackPoints[0]).toEqual(trackPoints.at(-1));
  expect(pointAt(0).x).toBeCloseTo(startFinish.point[0]);
  expect(pointAt(0).y).toBeCloseTo(startFinish.point[1]);
  const ahead = pointAt(0.02);
  expect(ahead.y).toBeLessThan(pointAt(0).y);
  expect(Math.abs(ahead.x - pointAt(0).x)).toBeLessThan(10);
  const xs = trackPoints.map((p) => p[0]),
    ys = trackPoints.map((p) => p[1]);
  expect((Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys))).toBeCloseTo(
    1.84,
    1,
  );
});
it('pit road joins the circuit and demo sector anchors resolve to their own coordinates', () => {
  expect(pitPoints[0]).toEqual(pitEntryAnchor.point);
  expect(pitPoints.at(-1)).toEqual(pitExitAnchor.point);
  for (const anchor of sectorAnchors.slice(0, 2)) {
    const p = pointAt(anchor.progress);
    expect(p.x).toBeCloseTo(anchor.point[0], 1);
    expect(p.y).toBeCloseTo(anchor.point[1], 1);
  }
  expect(pitEntryAnchor.mainProgress).toBeGreaterThan(0.9);
  expect(pitExitAnchor.mainProgress).toBeLessThan(0.1);
});
it('displayed pit lane is separate from Pit Straight while retaining mapped junctions and timing anchors', () => {
  const distanceToSegment = (
    point: readonly number[],
    a: readonly number[],
    b: readonly number[],
  ) => {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      squaredLength = dx * dx + dy * dy;
    const t = squaredLength
      ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / squaredLength))
      : 0;
    return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
  };
  expect(pitPoints).toHaveLength(pitSourcePoints.length);
  expect(pitPoints[0]).toEqual(pitSourcePoints[0]);
  expect(pitPoints.at(-1)).toEqual(pitSourcePoints.at(-1));
  const lane = pitPoints.filter((p) => p[1] >= 290 && p[1] <= 340);
  expect(lane.length).toBeGreaterThan(2);
  for (const p of lane) {
    const i = pitPoints.indexOf(p);
    expect(pitSourcePoints[i][0] - p[0]).toBeCloseTo(pitDisplayOffset);
    expect(p[1]).toEqual(pitSourcePoints[i][1]);
    const separation = Math.min(
      ...trackPoints.slice(1).map((end, i) => distanceToSegment(p, trackPoints[i], end)),
    );
    // Leaves clear space between the 22-unit road shadow and the 3-unit pit lane.
    expect(separation).toBeGreaterThan(25);
  }
  const service = pointAt(pitServiceProgress, true);
  expect(service.x).toBeCloseTo(pitServicePoint[0]);
  expect(service.y).toBeCloseTo(pitServicePoint[1]);
  const finish = pointAt(pitFinishProgress, true);
  expect(finish.y).toBeCloseTo(startFinish.point[1]);
  expect(finish.x).toBeLessThan(startFinish.point[0] - 25);
  expect(pitServiceProgress).toBeLessThan(pitFinishProgress);
  expect(pointAt(0, true)).toMatchObject({
    x: pitEntryAnchor.point[0],
    y: pitEntryAnchor.point[1],
  });
  expect(pointAt(1, true)).toMatchObject({ x: pitExitAnchor.point[0], y: pitExitAnchor.point[1] });
});
