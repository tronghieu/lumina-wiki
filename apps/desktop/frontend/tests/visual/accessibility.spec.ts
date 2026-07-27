import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const fixturePath = '/tests/visual/fixture.html';

test.beforeEach(async ({ page }) => {
  await page.goto(fixturePath);
  await page.evaluate(() => document.fonts.ready);
});

test('loaded desktop shell has no WCAG A or AA axe violations', async ({ page }) => {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('dimmed graph labels retain AA contrast', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Search graph nodes' }).fill('research');
  await expect(page.locator('.flow-node.dim .graph-node-label')).toHaveCount(1);
  const results = await new AxeBuilder({ page })
    .include('.graph-canvas')
    .withRules(['color-contrast'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('artifact tabs support arrow keys and expose the active panel', async ({ page }) => {
  const graphTab = page.getByRole('tab', { name: 'Graph' });
  await graphTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Note' })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'artifact-tab-note');
  await page.keyboard.press('ArrowRight');
  await expect(graphTab).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Note' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Note' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(graphTab).toBeFocused();
});

test('settings traps focus, closes with Escape, and restores its trigger', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Settings' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'AI Settings' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AI Settings' })).toBeFocused();

  await page.getByRole('button', { name: 'Close settings' }).focus();
  await page.keyboard.press('Shift+Tab');
  const focusedElement = await page.evaluate(() => document.activeElement?.outerHTML ?? 'none');
  expect(
    await page.locator(':focus').evaluate((element) => Boolean(element.closest('[role="dialog"]'))),
    `focus escaped to ${focusedElement}`,
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('composer keyboard behavior and reduced motion remain deterministic', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const composer = page.getByRole('textbox', { name: 'Chat input' });
  await composer.fill('A line');
  await page.keyboard.press('Shift+Enter');
  await expect(composer).toHaveValue('A line\n');

  const graphButton = page.getByRole('button', { name: 'Graph view' });
  const duration = await graphButton
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(duration.split(',').every((value) => Number.parseFloat(value) <= 0.01)).toBe(true);
  await graphButton.hover();
  await page.mouse.down();
  expect(await graphButton.evaluate((element) => getComputedStyle(element).transform)).toBe('none');
  await page.mouse.up();
});
