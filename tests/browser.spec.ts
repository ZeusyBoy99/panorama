import { test, expect, type Page } from '@playwright/test';
async function lab(page: Page) {
  await page.getByRole('button', { name: 'Demo controls', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}
async function closeLab(page: Page) {
  await page.getByRole('button', { name: 'Close demo controls' }).click();
}
async function scenario(page: Page, name: string) {
  await lab(page);
  await page.getByLabel('Scenario', { exact: true }).selectOption(name);
  await page.getByRole('button', { name: '20×', exact: true }).click();
  await closeLab(page);
}
test('working demo, filters, favourite persistence, shared selection and deep links', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.timing-table tbody tr')).toHaveCount(24);
  await expect(page.locator('.source-badge').first()).toHaveText('DEMO — SIMULATED DATA');
  await page.getByLabel('Search cars, drivers or teams').fill('Blake Mercer');
  await expect(page.locator('.timing-table tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Favourite car 07', exact: true }).click();
  await page.getByRole('button', { name: 'View car 07, Alex Rowan', exact: true }).click();
  await expect(page.locator('.selected-panel .large-number')).toHaveText('07');
  await page.getByLabel('Search cars, drivers or teams').fill('');
  await expect(page.locator('.timing-table tbody tr')).toHaveCount(24);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Unfavourite car 07', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/map?car=entry-2');
  await expect(page.locator('.selected-panel .large-number')).toHaveText('12');
  await page.getByRole('link', { name: 'Standings', exact: true }).click();
  await expect(page.locator('.selected-panel .large-number')).toHaveText('12');
  await page.getByRole('button', { name: 'Select car 08 on map' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.selected-panel .large-number')).toHaveText('08');
  await expect(page).toHaveURL(/car=entry-1/);
  await page.getByRole('link', { name: 'Race updates', exact: true }).click();
  await page
    .getByRole('region', { name: 'Race events', exact: true })
    .getByRole('button', { name: 'Favourites', exact: true })
    .click();
  await expect(page.locator('.source-badge').first()).toHaveText('DEMO — SIMULATED DATA');
  expect(errors).toEqual([]);
});
test('all capability profiles, pause, keyboard dialog and reduced motion', async ({ page }) => {
  await page.goto('/map');
  await lab(page);
  for (const [profile, label] of [
    ['sector', 'ESTIMATED · SECTOR'],
    ['lap', 'ESTIMATED · LAP'],
    ['classification', 'POSITIONS UNAVAILABLE'],
    ['position', 'SIMULATED POSITIONS'],
  ]) {
    await page.getByLabel('Map capability profile').selectOption(profile);
    await expect(page.locator('.source-chip')).toHaveText(label);
    if (profile === 'classification') {
      await expect(page.getByText('Classification only', { exact: true })).toBeVisible();
      await expect(page.locator('.car-marker:visible')).toHaveCount(0);
    }
  }
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('.connection')).toContainText('Playback paused');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Interface style', { exact: true }).selectOption('hacker');
  await expect(page.locator('html')).toHaveAttribute('data-ui', 'hacker');
  await expect(page.getByRole('link', { name: 'Timing', exact: true })).toBeVisible();
  await page.getByLabel('Interface style', { exact: true }).selectOption('fan');
  await expect(page.locator('html')).toHaveAttribute('data-ui', 'fan');
  await page.getByLabel('Motion', { exact: true }).selectOption('reduced');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
test('pit cycle and finish checkpoints produce events and stable entries', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Favourite car 07', exact: true }).click();
  await scenario(page, 'Pit cycle');
  await expect(
    page.getByRole('button', { name: 'View car 07, Blake Mercer', exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Unfavourite car 07', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Race updates', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '#07 · Blake Mercer takes over', exact: true }),
  ).toBeVisible();
  await scenario(page, 'Race finish');
  await expect(page.locator('.track-status')).toContainText('Race complete', { timeout: 15000 });
  await expect(page.locator('.track-status')).toContainText('RACE FINISHED', { timeout: 20000 });
});
test('15 real second outage, invalid schema, duplicate rejection and recovery', async ({
  page,
}) => {
  await page.goto('/');
  await lab(page);
  await page.getByRole('button', { name: '20×', exact: true }).click();
  await page.getByText('Advanced demo options', { exact: true }).click();
  await page.getByRole('button', { name: '15s feed outage', exact: true }).click();
  await closeLab(page);
  await expect(page.locator('.connection')).toContainText('Reconnecting');
  await expect(page.locator('.state-notice')).toContainText('15 real seconds');
  await expect(page.locator('.connection')).toContainText('Feed connected', { timeout: 22000 });
  await lab(page);
  if (!(await page.getByRole('button', { name: 'Malformed schema', exact: true }).isVisible()))
    await page.getByText('Advanced demo options', { exact: true }).click();
  await page.getByRole('button', { name: 'Malformed schema', exact: true }).click();
  await expect(page.locator('.state-notice')).toContainText('Rejected malformed feed');
  await expect(page.locator('.timing-table tbody tr')).toHaveCount(24);
  await page.getByRole('button', { name: 'Old / duplicate data', exact: true }).click();
  await expect(page.getByText(/Rejected messages:/)).toContainText('3');
  await closeLab(page);
});
test('sample replay, seek, export/import, invalid files and inert timing URL', async ({ page }) => {
  const arbitrary: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('example.net')) arbitrary.push(r.url());
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Load sample replay', exact: true }).click();
  await expect(page.locator('.source-badge').first()).toHaveText('REPLAY — SIMULATED DATA');
  await lab(page);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByLabel('Replay position', { exact: true }).press('End');
  for (let i = 0; i < 10; i++)
    await page.getByLabel('Replay position', { exact: true }).press('ArrowLeft');
  await expect(page.getByText('00:00:50 / 00:01:00', { exact: true })).toBeVisible();
  await page.getByLabel('Replay position', { exact: true }).press('Home');
  for (let i = 0; i < 10; i++)
    await page.getByLabel('Replay position', { exact: true }).press('ArrowRight');
  await expect(page.getByText('00:00:10 / 00:01:00', { exact: true })).toBeVisible();
  await closeLab(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export recording', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  await page.getByLabel('Import replay file').setInputFiles(path!);
  await expect(
    page.getByRole('status').filter({ hasText: 'Loaded Panorama short recording' }),
  ).toBeVisible();
  await page.getByLabel('Import replay file').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"version":99}'),
  });
  await expect(page.getByRole('alert')).toContainText('Invalid replay');
  await page
    .getByLabel('Timing URL', { exact: true })
    .fill('https://example.net/timing?secret=never-save');
  await page.getByRole('button', { name: 'Check URL format', exact: true }).click();
  await expect(
    page.getByText('Valid URL format. Live provider integration is not available yet.'),
  ).toBeVisible();
  expect(arbitrary).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('never-save');
});
test('required viewports, direct reload, mobile tap detail and console health', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const size of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.locator('.timing-table tbody tr')).toHaveCount(24);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
    await page
      .getByRole('button', { name: 'Demo controls', exact: true })
      .evaluate(async (element) => {
        await Promise.all(element.getAnimations().map((animation) => animation.finished));
      });
    await page.screenshot({
      path: 'docs/screenshots/' + testInfo.project.name + '-' + size.width + '.png',
    });
    if (size.width === 390) {
      await page.getByRole('button', { name: 'View car 07, Alex Rowan', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Sector timing', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await page.getByRole('link', { name: 'Track map', exact: true }).click();
    await page.reload();
    await expect(page.locator('.circuit-svg')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});
test('production manifest and service worker; Chromium offline reload', async ({
  page,
  context,
  browserName,
}) => {
  await page.goto('/settings');
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) {
    const response = await page.request.get(icon.src);
    expect(response.ok()).toBe(true);
  }
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  if (browserName === 'webkit') return;
  await page.getByRole('link', { name: 'Track map', exact: true }).click();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.source-badge').first()).toHaveText('DEMO — SIMULATED DATA');
  await expect(page.locator('.state-notice')).toContainText('Offline demo operation');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Load sample replay', exact: true }).click();
  await expect(page.locator('.source-badge').first()).toHaveText('REPLAY — SIMULATED DATA');
  if (browserName === 'chromium') {
    const registrations = await page.evaluate(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      return registrations.map((r) => r.active?.scriptURL);
    });
    expect(registrations.some((u) => u?.endsWith('/sw.js'))).toBe(true);
  }
  await context.setOffline(false);
});
