import { expect, test, type Page } from '@playwright/test';

/** The engine's first-time hints; Rhinoceros' own hints stay unseen so the tests meet them. */
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

async function startRhinoceros(page: Page, side: 'attacker' | 'defender') {
  await openSetup(page);
  await page.getByTestId('level-rhinoceros').click();
  await page.getByTestId(`side-${side}`).click();
  await page.getByTestId('to-briefing').click();
  await expect(page.getByTestId('briefing-text')).toContainText('rhino');
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

test('opens Rhinoceros only once Elephant has been won', async ({ page }) => {
  await withSave(page, ['lion', 'leopard'], async () => {
    await openSetup(page);
    await expect(page.getByTestId('level-elephant')).toBeEnabled();
    await expect(page.getByTestId('level-rhinoceros')).toBeDisabled();
  });
  await withSave(page, ['lion', 'leopard', 'elephant'], async () => {
    await openSetup(page);
    await expect(page.getByTestId('level-rhinoceros')).toBeEnabled();
    await page.getByTestId('level-rhinoceros').click();
    await expect(page.getByTestId('level-rhinoceros')).toHaveAttribute('aria-pressed', 'true');
  });
});

test('plays the Attacker on Rhinoceros: Close Contact and ambush thickets on the routes', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await withSave(page, ['lion', 'leopard', 'elephant'], async () => {
    await startRhinoceros(page, 'attacker');
    await expect(page.getByTestId('hint')).toContainText('Close Contact');
    await page.getByTestId('hint-ok').click();
    for (const route of ['thorn-track', 'dry-gully', 'open-scrub'])
      await expect(page.getByTestId(`route-${route}`)).toBeAttached();
    await expect(page.locator('.minimap-zone.thicket')).toHaveCount(4);

    await page.getByTestId('route-thorn-track').click();
    await expect(page.getByTestId('route-notes')).toContainText('Ambush thickets on the way: 2');
    await page.getByTestId('route-dry-gully').click();
    await expect(page.getByTestId('route-notes')).toContainText('Ambush thickets on the way: 1');
    await page.screenshot({ path: testInfo.outputPath(`rhinoceros-attacker-${testInfo.project.name}.png`) });
  });
});

test('plays the Defender on Rhinoceros: a post hidden in the Acacia Thicket', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const touch = testInfo.project.name !== 'desktop';
  await withSave(page, ['lion', 'leopard', 'elephant'], async () => {
    await startRhinoceros(page, 'defender');
    await expect(page.getByTestId('hint')).toContainText('Close Contact');
    await page.getByTestId('hint-ok').click();
    await page.getByTestId('build-observation-post').click();
    await tapMap(page, -15, -11, touch);
    await expect(page.locator('.minimap-defense')).toHaveCount(1);
    await expect(page.getByTestId('hint')).toContainText('ambush thicket');
    await page.getByTestId('hint-ok').click();
    await tapMap(page, -15, -11, touch);
    await expect(page.locator('[data-status="hidden"]').first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`rhinoceros-defender-${testInfo.project.name}.png`) });
  });
});
