import { expect, test, type Page } from '@playwright/test';

type DebugWindow = {
  __gtdView?: { screenPoint(x: number, z: number): { x: number; y: number } | null; hiddenMarks: number };
};

async function mapPoint(page: Page, x: number, z: number) {
  const point = await page.evaluate(
    ([px, pz]) => (window as unknown as DebugWindow).__gtdView?.screenPoint(px, pz) ?? null,
    [x, z],
  );
  expect(point, `map point ${x},${z} is on screen`).not.toBeNull();
  return point!;
}

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'hot-seat is for a PC with keyboard and mouse');
  const response = await page.request.put('/api/settings', {
    data: {
      language: 'en',
      graphics: 'low',
      keyBindings: {},
      onboarding: { tutorialOffered: true, hintsSeen: [] },
    },
  });
  expect(response.ok()).toBe(true);
});

test('two people play at one PC: keyboard Attacker on the left, mouse Defender on the right', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.goto('/?debug');
  await page.getByTestId('menu-two-players').click();
  await expect(page.getByTestId('hotseat-setup')).toBeVisible();
  await page.getByTestId('name-attacker').fill('Lena');
  await page.getByTestId('name-defender').fill('Guo');
  await page.screenshot({ path: testInfo.outputPath('hotseat-setup.png') });
  await page.getByTestId('to-briefing').click();
  await expect(page.getByTestId('briefing-attacker')).toContainText('Lena');
  await expect(page.getByTestId('briefing-defender')).toContainText('Guo');
  await page.screenshot({ path: testInfo.outputPath('hotseat-briefing.png') });
  await page.getByTestId('start-match').click();
  await expect(page.getByTestId('level-canvas')).toHaveAttribute('data-rendered', 'true', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('phase')).toContainText('Preparation', { timeout: 15_000 });
  const attacker = page.getByTestId('attacker-half');
  const defender = page.getByTestId('defender-half');
  // No hint pop-ups in hot-seat, and the Defender's buttons carry no key labels.
  await expect(page.getByTestId('hint')).toHaveCount(0);
  await expect(defender.locator('.key-hint')).toHaveCount(0);
  await expect(attacker.locator('.key-hint').first()).toBeVisible();

  // Defender: build with the mouse, then right-click the post for its command wheel.
  await page.getByTestId('build-observation-post').click();
  let post = await mapPoint(page, -16, 19);
  await page.mouse.click(post.x, post.y);
  await expect(page.locator('.minimap-defense')).toHaveCount(1);
  await page.waitForTimeout(400);
  post = await mapPoint(page, -16, 19);
  await page.mouse.click(post.x, post.y, { button: 'right' });
  await expect(page.getByTestId('command-wheel')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('hotseat-wheel.png') });
  await page.getByTestId('wheel-upgrade').click();
  await expect(page.getByTestId('command-wheel')).toBeHidden();
  await expect(page.getByTestId('asset-orders')).toContainText('Level 2');
  // Sell it again through the wheel, so no defense can spot the wave and the hidden mark below does not race it.
  post = await mapPoint(page, -16, 19);
  await page.mouse.click(post.x, post.y, { button: 'right' });
  await page.getByTestId('wheel-sell').click();
  await expect(page.locator('.minimap-defense')).toHaveCount(0);

  // Attacker: W A S D move the junction cursor; 1 adds a member, Shift+1 takes one away; Y picks route 2.
  const cursor = page.getByTestId('schematic-cursor');
  await expect(cursor).toHaveAttribute('data-node', 'acacia-junction');
  await page.keyboard.press('KeyA');
  await expect(cursor).toHaveAttribute('data-node', 'savanna-entrance');
  await page.keyboard.press('KeyD');
  await expect(cursor).toHaveAttribute('data-node', 'acacia-junction');
  const count = Number(await page.getByTestId('wave-count').inputValue());
  await page.keyboard.press('Digit1');
  await expect(page.getByTestId('wave-count')).toHaveValue(String(count + 1));
  await page.keyboard.press('Shift+Digit1');
  await expect(page.getByTestId('wave-count')).toHaveValue(String(count));
  await page.keyboard.press('KeyY');
  await expect(page.getByTestId('route-riverbed')).toHaveAttribute('aria-checked', 'true');

  // A planning pause stops the clock; the other player can end it early.
  await page.keyboard.press('KeyP');
  await expect(page.getByTestId('paused-banner')).toContainText('Attacker');
  await expect(page.getByTestId('pauses-attacker')).toHaveText('2');
  const frozen = await page.getByTestId('phase').textContent();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('phase')).toHaveText(frozen ?? '');
  await page.getByTestId('pause-defender').click();
  await expect(page.getByTestId('paused-banner')).toBeHidden();
  await expect(page.getByTestId('pauses-defender')).toHaveText('3');

  // Launch with Space once preparation is over, pause to plan, then stop the group at the cursor junction.
  await expect(page.getByTestId('launch-status')).toHaveClass(/ready/, { timeout: 60_000 });
  await page.keyboard.press('Space');
  await expect(page.getByTestId('schematic-group').first()).toBeAttached({ timeout: 10_000 });
  await page.keyboard.press('KeyP');
  await expect(page.getByTestId('pauses-attacker')).toHaveText('1');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('group-orders')).toBeVisible();
  await expect(page.getByTestId('cursor-node')).toContainText('stop here');
  await page.keyboard.press('Enter');
  // Both players see every group; one the Defender has not spotted carries the hidden mark.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as DebugWindow).__gtdView?.hiddenMarks ?? 0))
    .toBeGreaterThan(0);
  await page.keyboard.press('KeyP');
  await expect(page.getByTestId('paused-banner')).toBeHidden();
  await expect(page.getByTestId('group-orders')).toContainText(/holding|stops at the next junction/);
  await expect(page.getByTestId('group-orders')).toContainText('holding', { timeout: 20_000 });
  await page.screenshot({ path: testInfo.outputPath('hotseat-desktop.png') });

  // Esc first lets go of the group, then opens the menu, which does not stop a hot-seat match.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('group-orders')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toContainText('The match goes on');
  await page.getByTestId('quit').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();
});
