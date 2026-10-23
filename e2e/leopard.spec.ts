import { expect, test, type Page } from '@playwright/test';

/** The engine's first-time hints; Leopard's own hints stay unseen so the tests meet them. */
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

/** A save that has (or has not yet) won Lion once. */
function save(lionWon: boolean) {
  return {
    version: 2,
    settings: SETTINGS,
    unlocks: { stages: { 'stage-01-big-five': { completedLevels: lionWon ? ['lion'] : [] } } },
    updatedAt: '2026-10-23T08:00:00.000Z',
  };
}

async function withSave(page: Page, lionWon: boolean, run: () => Promise<void>) {
  const before = await (await page.request.get('/api/save/export')).text();
  const response = await page.request.post('/api/save/import', { data: save(lionWon) });
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

async function startLeopard(page: Page, side: 'attacker' | 'defender') {
  await openSetup(page);
  await page.getByTestId('level-leopard').click();
  await page.getByTestId(`side-${side}`).click();
  await page.getByTestId('to-briefing').click();
  await expect(page.getByTestId('briefing-text')).toContainText('leopard');
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

/** Parts of the view-area overlay drawn on the map (fill and outline while one is shown). */
async function viewAreaParts(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __gtdScene?: { getObjectByName(name: string): { children: unknown[] } | undefined };
        }
      ).__gtdScene?.getObjectByName('view-area')?.children.length ?? -1,
  );
}

test('opens Leopard only once Lion has been won', async ({ page }) => {
  await withSave(page, false, async () => {
    await openSetup(page);
    await expect(page.getByTestId('level-lion')).toBeEnabled();
    await expect(page.getByTestId('level-leopard')).toBeDisabled();
  });
  await withSave(page, true, async () => {
    await openSetup(page);
    await expect(page.getByTestId('level-leopard')).toBeEnabled();
    await page.getByTestId('level-leopard').click();
    await expect(page.getByTestId('level-leopard')).toHaveAttribute('aria-pressed', 'true');
  });
});

test('plays the Defender on Leopard: Concealment Zones hint, a post on the ledge and its view area', async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const touch = testInfo.project.name !== 'desktop';
  await withSave(page, true, async () => {
    await startLeopard(page, 'defender');
    await expect(page.getByTestId('hint')).toContainText('Concealment Zones');
    await page.getByTestId('hint-ok').click();
    await expect(page.locator('.minimap-zone')).toHaveCount(8);

    // While placing, the site under the pointer shows what a post there would see.
    await page.getByTestId('build-observation-post').click();
    if (!touch) {
      const point = await page.evaluate(
        () =>
          (
            window as unknown as {
              __gtdView?: { screenPoint(x: number, z: number): { x: number; y: number } | null };
            }
          ).__gtdView?.screenPoint(-15, -12) ?? null,
      );
      await page.mouse.move(point!.x, point!.y);
      await expect.poll(() => viewAreaParts(page)).toBe(2);
    }
    await tapMap(page, -15, -12, touch);
    await expect(page.locator('.minimap-defense')).toHaveCount(1);
    await expect(page.getByTestId('hint')).toContainText('stands on a ledge');
    await page.getByTestId('hint-ok').click();

    await tapMap(page, -15, -12, touch);
    await expect(page.getByTestId('asset-orders')).toBeVisible();
    await expect.poll(() => viewAreaParts(page)).toBe(2);
    await page.screenshot({ path: testInfo.outputPath(`leopard-defender-${testInfo.project.name}.png`) });
    await page.keyboard.press('Escape');
    await expect.poll(() => viewAreaParts(page)).toBe(0);
  });
});

test('plays the Attacker on Leopard with its three routes', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await withSave(page, true, async () => {
    await startLeopard(page, 'attacker');
    await expect(page.getByTestId('hint')).toContainText('Concealment Zones');
    await page.getByTestId('hint-ok').click();
    for (const route of ['woodland', 'rocky', 'ravine'])
      await expect(page.getByTestId(`route-${route}`)).toBeAttached();
    await page.screenshot({ path: testInfo.outputPath(`leopard-attacker-${testInfo.project.name}.png`) });
  });
});
