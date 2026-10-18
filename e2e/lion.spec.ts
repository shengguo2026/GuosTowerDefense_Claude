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
  await page.request.put('/api/settings', {
    data: { onboarding: { tutorialOffered: true }, language: 'en', graphics: 'auto' },
  });
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
  await page.request.put('/api/settings', {
    data: { onboarding: { tutorialOffered: true }, language: 'en', graphics: 'auto' },
  });
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
  // Software rendering on CI can take most of a second per frame, and input waits for frames.
  test.setTimeout(120_000);
  await page.request.put('/api/settings', {
    data: { onboarding: { tutorialOffered: true }, language: 'en', graphics: 'low' },
  });
  await page.goto('/#lion');
  const canvas = page.getByTestId('level-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true', { timeout: 30_000 });
  const ridge = page.locator('.world-label.landmark', { hasText: 'Rocky Ridge' });
  const junction = page.locator('.world-label.landmark', { hasText: 'Acacia Junction' });
  const x = async () => (await ridge.boundingBox())!.x;
  const spread = async () => Math.abs((await junction.boundingBox())!.y - (await ridge.boundingBox())!.y);
  const before = await x();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2 + 60, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await x()) - before), { timeout: 20_000 }).toBeGreaterThan(60);

  // Zooming in pushes the two landmarks further apart on screen.
  const far = await spread();
  await page.mouse.wheel(0, -600);
  await expect.poll(spread, { timeout: 20_000 }).toBeGreaterThan(far * 1.1);
});
