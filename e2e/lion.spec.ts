import { expect, test } from '@playwright/test';

/** Render budgets from the graphics guide: desktop presets, and Low for phones. */
const BUDGETS: Record<string, { drawCalls: number; triangles: number }> = {
  low: { drawCalls: 150, triangles: 300_000 },
  medium: { drawCalls: 300, triangles: 750_000 },
  high: { drawCalls: 300, triangles: 750_000 },
  ultra: { drawCalls: 400, triangles: 1_200_000 },
};

interface RenderInfo {
  preset: string;
  drawCalls: number;
  triangles: number;
  fps: number;
}

test('opens the Lion level from the home screen and leaves it again', async ({ page }) => {
  await page.request.put('/api/settings', { data: { language: 'en', graphics: 'auto' } });
  await page.goto('/');
  await page.getByTestId('open-lion').click();
  await expect(page.getByTestId('level-canvas')).toHaveAttribute('data-rendered', 'true', {
    timeout: 30_000,
  });
  await expect(page.locator('.level-title')).toContainText('Lion');
  await page.getByTestId('level-back').click();
  await expect(page.getByTestId('open-lion')).toBeVisible();
});

test('renders the Lion level with routes, labels and a live demo match within budget', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.request.put('/api/settings', { data: { language: 'en', graphics: 'auto' } });
  await page.goto('/?debug#lion');
  await expect(page.getByTestId('level-canvas')).toHaveAttribute('data-rendered', 'true', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('label-landmark')).toHaveCount(5);
  await expect(page.getByTestId('label-route')).toHaveCount(2);
  await expect(page.locator('.world-label.landmark', { hasText: 'Lion Waterhole' })).toBeVisible();
  await expect(page.getByTestId('match-status')).toContainText('Time left');
  // The first attacker group leaves the entrance after a few seconds.
  await expect(page.getByTestId('match-status')).toContainText(/[1-9]\d* group/, { timeout: 20_000 });
  await page.waitForTimeout(4000);

  const info = await page.evaluate(
    () => (window as unknown as { __gtdRenderInfo?: RenderInfo }).__gtdRenderInfo,
  );
  expect(info).toBeDefined();
  const budget = BUDGETS[info!.preset];
  expect(budget, `preset ${info!.preset}`).toBeDefined();
  expect(info!.drawCalls).toBeLessThanOrEqual(budget!.drawCalls);
  expect(info!.triangles).toBeLessThanOrEqual(budget!.triangles);
  if (testInfo.project.name === 'phone') expect(info!.preset).toBe('low');
  await testInfo.attach('render-info', {
    body: JSON.stringify(info, null, 2),
    contentType: 'application/json',
  });

  const shot = testInfo.outputPath(`lion-${testInfo.project.name}.png`);
  await page.screenshot({ path: shot });
  await testInfo.attach(`lion-${testInfo.project.name}`, { path: shot, contentType: 'image/png' });
});

test('camera pans with a drag and zooms with the wheel', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'mouse controls are covered on desktop and tablet');
  await page.request.put('/api/settings', { data: { language: 'en', graphics: 'low' } });
  await page.goto('/#lion');
  const canvas = page.getByTestId('level-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true', { timeout: 30_000 });
  const label = page.locator('.world-label.landmark', { hasText: 'Rocky Ridge' });
  const before = await label.boundingBox();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const after = await label.boundingBox();
  expect(Math.abs(after!.x - before!.x)).toBeGreaterThan(60);

  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(800);
  const zoomed = await page
    .locator('.world-label')
    .evaluateAll(
      (elements) => elements.filter((e) => (e as HTMLElement).style.visibility !== 'hidden').length,
    );
  expect(zoomed).toBeLessThan(7);
});
