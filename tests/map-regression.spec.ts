import { test, expect, type Page } from '@playwright/test';

async function speed(page: Page, value: '5×' | '20×', scenario?: string) {
  await page.getByRole('button', { name: 'Demo controls', exact: true }).click();
  if (scenario) await page.getByLabel('Scenario', { exact: true }).selectOption(scenario);
  await page.getByRole('button', { name: value, exact: true }).click();
  await page.getByRole('button', { name: 'Close demo controls', exact: true }).click();
}

test('new visitors follow system appearance, while an explicit preference persists', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/settings');
  await expect(page.getByLabel('Theme', { exact: true })).toHaveValue('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.reload();
  await expect(page.getByLabel('Theme', { exact: true })).toHaveValue('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('repeated map selection leaves the cars moving smoothly', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/map');
  await speed(page, '5×');
  await expect(page.locator('.car-marker:visible')).toHaveCount(24);
  const motion = await page.evaluate(async () => {
    const probe = document.querySelector<SVGGElement>('.car-marker[data-entry="entry-1"]')!;
    const choices = ['entry-1', 'entry-2'].map((id) =>
      document.querySelector<SVGGElement>('.car-marker[data-entry="' + id + '"]')!,
    );
    const points: { x: number; y: number; at: number }[] = [];
    const begun = performance.now();
    let nextSelection = begun + 650;
    let selections = 0;
    await new Promise<void>((done) => {
      const sample = (at: number) => {
        if (at >= nextSelection) {
          choices[selections % choices.length].dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
          );
          selections++;
          nextSelection = at + 90;
        }
        // Let the initial provider change settle before measuring selection.
        if (at - begun >= 650) {
          const matrix = probe.transform.baseVal.consolidate()!.matrix;
          points.push({ x: matrix.e, y: matrix.f, at });
        }
        if (at - begun < 2450) requestAnimationFrame(sample);
        else done();
      };
      requestAnimationFrame(sample);
    });
    const displacements = points.slice(1).map((point, index) => {
      const prior = points[index];
      return {
        distance: Math.hypot(point.x - prior.x, point.y - prior.y),
        elapsed: point.at - prior.at,
      };
    });
    // A slow CI frame is permitted proportionally more travel. At 5x, normal
    // movement is far below this bound; snapping to the next 500ms sample is not.
    return {
      selections,
      frames: displacements.length,
      movingFraction:
        displacements.filter((frame) => frame.distance > 0.01).length / displacements.length,
      largestFrameTravel: Math.max(
        ...displacements.map((frame) => frame.distance / Math.max(1, frame.elapsed / 16.67)),
      ),
    };
  });
  expect(motion.selections).toBeGreaterThan(10);
  expect(motion.frames).toBeGreaterThan(20);
  expect(motion.movingFraction).toBeGreaterThan(0.45);
  expect(motion.largestFrameTravel).toBeLessThan(5);
  await expect(page.locator('.selected-panel .large-number')).not.toHaveText('—');
});

test('car position dots stay on the track or pit path through a pit cycle', async ({ page }) => {
  await page.goto('/map');
  await speed(page, '20×', 'Pit cycle');
  await expect(page.locator('.car-marker[data-path="pit"]:visible').first()).toBeVisible();
  const distances = await page.evaluate(async () => {
    const samplePath = (selector: string) => {
      const path = document.querySelector<SVGPathElement>(selector)!;
      const length = path.getTotalLength();
      const points: DOMPoint[] = [];
      for (let distance = 0; distance <= length; distance += 1)
        points.push(path.getPointAtLength(distance));
      points.push(path.getPointAtLength(length));
      return points;
    };
    const track = samplePath('.track-core');
    const pit = samplePath('.pit-path');
    const distances: number[] = [];
    for (let frame = 0; frame < 8; frame++) {
      await new Promise<void>((done) => requestAnimationFrame(() => done()));
      for (const marker of document.querySelectorAll<SVGGElement>('.car-marker')) {
        if (getComputedStyle(marker).display === 'none') continue;
        const matrix = marker.transform.baseVal.consolidate()!.matrix;
        const path = marker.dataset.path === 'pit' ? pit : track;
        distances.push(
          Math.min(...path.map((point) => Math.hypot(matrix.e - point.x, matrix.f - point.y))),
        );
      }
    }
    return distances;
  });
  expect(distances.length).toBeGreaterThan(100);
  expect(Math.max(...distances)).toBeLessThan(0.8);
});

test('pit lane is visually separate and the map title does not cover Griffin’s Bend', async ({
  page,
}) => {
  await page.goto('/map');
  const geometry = await page.evaluate(() => {
    const main = document.querySelector<SVGPathElement>('.track-core')!;
    const pit = document.querySelector<SVGPathElement>('.pit-path')!;
    const length = main.getTotalLength();
    const mainPoints = Array.from({ length: Math.ceil(length) + 1 }, (_, distance) =>
      main.getPointAtLength(Math.min(distance, length)),
    );
    const pitLength = pit.getTotalLength();
    const separation = [0.35, 0.5, 0.65].map((fraction) => {
      const point = pit.getPointAtLength(pitLength * fraction);
      return Math.min(...mainPoints.map((p) => Math.hypot(point.x - p.x, point.y - p.y)));
    });
    const title = document.querySelector<SVGTextElement>('.map-watermark')!.getBBox();
    const bend = [...document.querySelectorAll<SVGTextElement>('.track-label')]
      .find((label) => label.textContent?.includes('Griffin'))!
      .getBBox();
    return {
      separation,
      overlap:
        title.x < bend.x + bend.width &&
        title.x + title.width > bend.x &&
        title.y < bend.y + bend.height &&
        title.y + title.height > bend.y,
    };
  });
  expect(Math.min(...geometry.separation)).toBeGreaterThan(10);
  expect(geometry.overlap).toBe(false);
});
