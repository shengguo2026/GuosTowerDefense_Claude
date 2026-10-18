import { expect, test, type Page } from '@playwright/test';

/** Puts the save back into the first-launch state (no language chosen yet). */
async function resetLanguage(page: Page) {
  const response = await page.request.put('/api/settings', { data: { language: null } });
  expect(response.ok()).toBe(true);
}

test.describe('first launch', () => {
  test.use({ locale: 'de-DE' });

  test('suggests the browser language, remembers the choice after a reload', async ({ page }) => {
    await resetLanguage(page);
    await page.goto('/');
    const picker = page.getByRole('dialog');
    await expect(picker.getByRole('heading')).toHaveText('Wähle deine Sprache');
    await expect(picker.getByRole('radio', { name: 'Deutsch' })).toHaveAttribute('aria-checked', 'true');

    await picker.getByRole('radio', { name: '简体中文' }).click();
    await picker.getByRole('button', { name: '继续' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('app-title')).toHaveText('盛国的塔防游戏');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');

    await page.reload();
    await expect(page.getByTestId('app-title')).toHaveText('盛国的塔防游戏');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test('connects to the game server', async ({ page }) => {
  await page.request.put('/api/settings', { data: { language: 'en' } });
  await page.goto('/');
  await expect(page.getByTestId('connection')).toHaveText('Connected');
  await expect(page.getByTestId('server-info')).toContainText('Server version');
});

test('switches between English, German and Chinese in Settings', async ({ page }) => {
  await page.request.put('/api/settings', { data: { language: 'en' } });
  await page.goto('/');
  await expect(page.getByTestId('app-title')).toHaveText("Guo's Tower Defense");

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByTestId('language-select').selectOption('de');
  await expect(page.getByTestId('app-title')).toHaveText('Guos Tower Defense');
  await page.getByTestId('language-select').selectOption('zh-CN');
  await expect(page.getByTestId('app-title')).toHaveText('盛国的塔防游戏');
  await page.getByTestId('language-select').selectOption('en');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveTitle("Guo's Tower Defense");
});

test('renders the 3D scene and takes a layout screenshot', async ({ page }, testInfo) => {
  await page.request.put('/api/settings', { data: { language: 'en' } });
  await page.goto('/');
  await expect(page.getByTestId('world-canvas')).toHaveAttribute('data-rendered', 'true', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('connection')).toHaveText('Connected');
  await page.screenshot({ path: testInfo.outputPath(`foundation-${testInfo.project.name}.png`) });
  await testInfo.attach(`foundation-${testInfo.project.name}`, {
    path: testInfo.outputPath(`foundation-${testInfo.project.name}.png`),
    contentType: 'image/png',
  });

  // The card and the top bar must fit inside the viewport on every device class.
  const viewport = page.viewportSize();
  for (const box of [
    await page.locator('.home-card').boundingBox(),
    await page.locator('.top-bar').boundingBox(),
  ]) {
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
  }
});
