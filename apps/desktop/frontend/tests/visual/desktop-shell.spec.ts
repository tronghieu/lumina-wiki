import { expect, test } from '@playwright/test';

const fixturePath = '/tests/visual/fixture.html';

test.beforeEach(async ({ page }) => {
  await page.goto(fixturePath);
  await page.evaluate(() => document.fonts.ready);
});

test('dark and light desktop references stay within the approved threshold', async ({ page }) => {
  await expect(page).toHaveScreenshot('reference-dark-1480x920.png', { fullPage: true });

  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page).toHaveScreenshot('reference-light-1480x920.png', { fullPage: true });
});

test('desktop and responsive panels remain measurable and reopenable', async ({ page }) => {
  const artifact = page.getByLabel('Workspace artifact');
  await expect(artifact).toBeVisible();
  expect((await artifact.boundingBox())?.width).toBeGreaterThan(500);

  await page.setViewportSize({ width: 1180, height: 820 });
  await expect(page.getByLabel('Workspace navigation')).toBeVisible();
  const openAgent = page.getByRole('button', { name: 'Open Agent panel' });
  await openAgent.click();
  await expect(page.getByRole('button', { name: 'Close Agent panel' })).toBeFocused();
  await expect(page.getByRole('complementary', { name: 'Agent panel' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(openAgent).toBeFocused();

  await page.setViewportSize({ width: 760, height: 780 });
  for (const name of ['Open', 'Refresh', 'Source', 'Check', 'Import']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(760);
});

test('local fonts finish loading before visual capture', async ({ page }) => {
  expect(await page.evaluate(() => document.fonts.status)).toBe('loaded');
  const bodyFont = await page.locator('body').evaluate((element) => getComputedStyle(element).fontFamily);
  expect(bodyFont).toContain('Inter');
  for (const family of ['Inter', 'Source Serif 4', 'JetBrains Mono', 'Be Vietnam Pro']) {
    await page.evaluate((font) => document.fonts.load(`12px "${font}"`), family);
    expect(await page.evaluate((font) => document.fonts.check(`12px "${font}"`), family)).toBe(true);
  }
});

test('graph edges render through non-interactive custom-node handles', async ({ page }) => {
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
});
