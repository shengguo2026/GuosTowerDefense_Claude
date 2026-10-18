import { expect, test, type Page } from '@playwright/test';

async function openControls(page: Page) {
  const drawer = page.getByTestId('match-controls');
  if (!(await drawer.isVisible())) await page.getByTestId('toggle-controls').click();
  await expect(drawer).toBeVisible();
}

async function startMatch(page: Page, seat: 'both' | 'attacker' | 'defender') {
  await page.goto('/#lion-match');
  await expect(page.getByTestId('seat-picker')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`seat-${seat}`).click();
  await expect(page.getByTestId('seat-picker')).toBeHidden();
  await expect(page.getByTestId('level-canvas')).toHaveAttribute('data-rendered', 'true', {
    timeout: 30_000,
  });
}

test.beforeEach(async ({ page }) => {
  await page.request.put('/api/settings', { data: { language: 'en', graphics: 'auto' } });
});

test('plays both sides on one screen through the debug controls', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await startMatch(page, 'both');
  await expect(page.getByTestId('phase')).toContainText('Preparation');
  await openControls(page);

  await page.getByTestId('tab-defender').click();
  await page.getByTestId('build-type').selectOption('observation-post');
  await page.getByTestId('build-place').selectOption('junction-hill');
  await page.getByTestId('build').click();
  await expect(page.getByTestId('asset-row')).toHaveCount(1);
  await expect(page.getByTestId('asset-row')).toContainText('Observation Post');

  await page.getByTestId('tab-attacker').click();
  await page.getByTestId('launch-wave').click();
  await expect(page.getByTestId('notice')).toContainText('once preparation is over');
  await page.screenshot({ path: testInfo.outputPath(`match-${testInfo.project.name}.png`) });
});

test('two people play a full match from separate screens', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one full match is enough; it runs in real time');
  test.setTimeout(600_000);
  const attacker = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
  const defender = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
  await attacker.request.put('/api/settings', { data: { language: 'en', graphics: 'low' } });

  await startMatch(attacker, 'attacker');
  await defender.goto('/#lion-match');
  await defender.getByTestId('open-match').getByTestId('join-defender').click();
  await expect(defender.getByTestId('seat-picker')).toBeHidden();
  await openControls(defender);
  await expect(defender.getByTestId('tab-attacker')).toHaveCount(0);
  await defender.getByTestId('build-type').selectOption('observation-post');
  await defender.getByTestId('build-place').selectOption('waterhole-east');
  await defender.getByTestId('build').click();
  await expect(defender.getByTestId('asset-row')).toHaveCount(1);

  // The Attacker has not seen the post, and cannot command the Defender's side.
  await openControls(attacker);
  await expect(attacker.getByTestId('build')).toHaveCount(0);

  // After preparation, one large wave on the ridge reaches the waterhole and holds it.
  await expect(attacker.getByTestId('phase')).toHaveText('Match running', { timeout: 40_000 });
  await attacker.getByTestId('wave-count').fill('24');
  await attacker.getByTestId('wave-route').selectOption('ridge');
  await attacker.getByTestId('launch-wave').click();
  await expect(attacker.getByTestId('group-row')).toHaveCount(1);

  await expect(attacker.getByTestId('result-screen')).toBeVisible({ timeout: 90_000 });
  await expect(attacker.getByTestId('result-attacker')).toHaveClass(/won/);
  await expect(attacker.getByTestId('result-attacker')).toContainText('Victory');
  await expect(defender.getByTestId('result-screen')).toBeVisible();
  await expect(defender.getByTestId('result-defender')).toContainText('Defeat');
  await attacker.screenshot({ path: testInfo.outputPath('result-attacker.png') });
  await defender.screenshot({ path: testInfo.outputPath('result-defender.png') });
});
