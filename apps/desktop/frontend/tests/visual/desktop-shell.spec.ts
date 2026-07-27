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
  const artifact = page.getByLabel('Library content');
  await expect(artifact).toBeVisible();
  expect((await artifact.boundingBox())?.width).toBeGreaterThan(500);

  await page.setViewportSize({ width: 1180, height: 820 });
  await expect(page.getByLabel('Library navigation')).toBeVisible();
  const openAgent = page.getByRole('button', { name: 'Open Agent panel' });
  await openAgent.click();
  await expect(page.getByRole('button', { name: 'Close Agent panel' })).toBeFocused();
  await expect(page.getByRole('complementary', { name: 'Agent panel' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(openAgent).toBeFocused();

  await page.setViewportSize({ width: 760, height: 780 });
  for (const name of ['Switch library', 'Refresh']) {
    await expect(page.getByRole('button', { name, exact: true }).first()).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(760);
});

test('Welcome, recovery, and an empty library contain no invented content', async ({ page }) => {
  await page.goto(`${fixturePath}?view=welcome`);
  await expect(page.getByRole('heading', { name: 'Welcome to Lumina' })).toBeVisible();
  const createLibrary = page.getByRole('button', { name: 'Create library' });
  await expect(createLibrary).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open existing library' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find again' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear recent activity' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Library name' }).focus();
  await page.keyboard.press('Tab');
  await expect(createLibrary).toBeFocused();

  await page.goto(`${fixturePath}?view=recovery`);
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove from this list' })).toBeVisible();

  await page.goto(`${fixturePath}?view=current-recovery`);
  await expect(page.getByText('Lumina Demo is still open.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Return to current library' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();

  await page.goto(`${fixturePath}?view=empty`);
  await expect(page.getByText('Your graph is ready')).toBeVisible();
  await expect(page.getByText('No notes yet.')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Note' })).toBeDisabled();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
});

test('Welcome and ready states reflow at narrow width and 200% text', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await page.goto(`${fixturePath}?view=welcome`);
  await page.locator('html').evaluate((element) => {
    element.style.fontSize = '200%';
  });
  await expect(page.getByRole('button', { name: 'Create library' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open existing library' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(760);

  await page.goto(`${fixturePath}?view=empty`);
  await page.locator('html').evaluate((element) => {
    element.style.fontSize = '200%';
  });
  await expect(page.getByText('Your graph is ready')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(760);
});

test('activation keeps the prior library veiled and non-interactive', async ({ page }) => {
  await page.goto(`${fixturePath}?view=activation`);
  await expect(page.getByRole('status')).toContainText('Opening your library');
  await expect(page.locator('.desktop-workspace')).toHaveAttribute('inert', '');
  await expect(page.locator('.desktop-workspace')).toHaveAttribute('aria-hidden', 'true');
});

test('restored semantic focus reaches the saved note or chat surface', async ({ page }) => {
  await page.goto(`${fixturePath}?view=focus-note`);
  await expect(page.getByRole('tab', { name: 'Note' })).toBeFocused();
  await expect(page.getByText('A deterministic note used only by the browser test fixture.')).toBeVisible();

  await page.goto(`${fixturePath}?view=focus-chat`);
  await expect(page.getByRole('textbox', { name: 'Chat input' })).toBeFocused();
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
