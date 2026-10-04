import { it, expect } from 'vitest';
import {
  trackPoints,
  pitPoints,
  pitEntryAnchor,
  pitExitAnchor,
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
