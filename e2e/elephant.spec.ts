import { expect, test, type Page } from '@playwright/test';

/** The engine's first-time hints; Elephant's own hints stay unseen so the tests meet them. */
const ENGINE_HINTS = [
  'startAttacker',
  'startDefender',
  'combat',
  'spottedAttacker',
  'spottedDefender',
  'objectiveAttacker',
  'objectiveDefender',
  'blocked',
  'disrupted',
  'abilityReady',
];

const SETTINGS = {
  language: 'en',
  graphics: 'low',
  keyBindings: {},
  playerName: 'Guo',
  onboarding: { tutorialOffered: true, hintsSeen: ENGINE_HINTS },
};

/** A save that has won the levels given. */
function save(completedLevels: string[]) {
  return {
    version: 2,
    settings: SETTINGS,
    unlocks: { stages: { 'stage-01-big-five': { completedLevels } } },
    updatedAt: '2026-10-23T12:00:00.000Z',
  };
}

async function withSave(page: Page, completedLevels: string[], run: () => Promise<void>) {
  const before = await (await page.request.get('/api/save/export')).text();
  const response = await page.request.post('/api/save/import', { data: save(completedLevels) });
  expect(response.ok()).toBe(true);
  try {
    await run();
  } finally {
    await page.request.post('/api/save/import', {
      data: before,
      headers: { 'content-type': 'application/json' },
    });
  }
}

async function openSetup(page: Page) {
  await page.goto('/?debug');
  await page.getByTestId('menu-single').click();
  await expect(page.getByTestId('setup')).toBeVisible();
}

async function startElephant(page: Page, side: 'attacker' | 'defender') {
  await openSetup(page);
  await page.getByTestId('level-elephant').click();
  await page.getByTestId(`side-${side}`).click();
  await page.getByTestId('to-briefing').click();
  await expect(page.getByTestId('briefing-text')).toContainText('elephant');
  await page.getByTestId('start-match').click();
  await expect(page.getByTestId('level-canvas')).toHaveAttribute('data-rendered', 'true', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('phase')).toContainText('Preparation', { timeout: 15_000 });
}

/** Clicks (or taps, on touch devices) a map point. */
async function tapMap(page: Page, x: number, z: number, touch: boolean) {
  const point = await page.evaluate(
    ([px, pz]) =>
      (
        window as unknown as {
          __gtdView?: { screenPoint(x: number, z: number): { x: number; y: number } | null };
        }
      ).__gtdView?.screenPoint(px, pz) ?? null,
    [x, z],
  );
  expect(point, `map point ${x},${z} is on screen`).not.toBeNull();
  if (touch) await page.touchscreen.tap(point!.x, point!.y);
  else await page.mouse.click(point!.x, point!.y);
  await page.waitForTimeout(400);
}

test('opens Elephant only once Leopard has been won', async ({ page }) => {
  await withSave(page, ['lion'], async () => {
    await openSetup(page);
    await expect(page.getByTestId('level-leopard')).toBeEnabled();
    await expect(page.getByTestId('level-elephant')).toBeDisabled();
  });
  await withSave(page, ['lion', 'leopard'], async () => {
    await openSetup(page);
    await expect(page.getByTestId('level-elephant')).toBeEnabled();
    await page.getByTestId('level-elephant').click();
    await expect(page.getByTestId('level-elephant')).toHaveAttribute('aria-pressed', 'true');
  });
});

test('plays the Attacker on Elephant: route notes and a group too wide for the Elephant Ford', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await withSave(page, ['lion', 'leopard'], async () => {
    await startElephant(page, 'attacker');
    await expect(page.getByTestId('hint')).toContainText('Terrain Weight');
    await page.getByTestId('hint-ok').click();
    for (const route of ['dry-ridge', 'mud-flats', 'river-crossing'])
      await expect(page.getByTestId(`route-${route}`)).toBeAttached();
    await expect(page.locator('.minimap-river')).toHaveCount(1);
    await expect(page.locator('.minimap-crossing')).toHaveCount(2);

    await page.getByTestId('route-mud-flats').click();
    await expect(page.getByTestId('route-notes')).toContainText('Mud');
    await expect(page.getByTestId('route-notes')).toContainText('Elephant Ford: room for 6');
    await page.getByTestId('unit-expedition-team').click();
    await page.getByTestId('wave-count').fill('5');
    await expect(page.getByTestId('route-notes')).toContainText('squeeze through slowly');
    await page.getByTestId('route-dry-ridge').click();
    await expect(page.getByTestId('route-notes')).toContainText('Upper Ford: room for 12');
    await page.screenshot({ path: testInfo.outputPath(`elephant-attacker-${testInfo.project.name}.png`) });
  });
});

test('plays the Defender on Elephant: a post by the Elephant Ford', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const touch = testInfo.project.name !== 'desktop';
  await withSave(page, ['lion', 'leopard'], async () => {
    await startElephant(page, 'defender');
    await expect(page.getByTestId('hint')).toContainText('Terrain Weight');
    await page.getByTestId('hint-ok').click();
    await page.getByTestId('build-observation-post').click();
    await tapMap(page, 24, 15, touch);
    await expect(page.locator('.minimap-defense')).toHaveCount(1);
    await expect(page.getByTestId('hint')).toContainText('covers a crossing');
    await page.screenshot({ path: testInfo.outputPath(`elephant-defender-${testInfo.project.name}.png`) });
  });
});
