import { expect, test, type Page } from '@playwright/test';

const ALL_HINTS = [
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

/** English, no tutorial offer, and (unless a test wants them) no first-time hints in the way. */
async function prepare(page: Page, hintsSeen: string[] = ALL_HINTS) {
  const response = await page.request.put('/api/settings', {
    data: {
      language: 'en',
      graphics: 'low',
      keyBindings: {},
      onboarding: { tutorialOffered: true, hintsSeen },
    },
  });
  expect(response.ok()).toBe(true);
}

async function startSinglePlayer(page: Page, side: 'attacker' | 'defender') {
  await page.goto('/?debug');
  await page.getByTestId('menu-single').click();
  await expect(page.getByTestId('setup')).toBeVisible();
  await page.getByTestId(`side-${side}`).click();
  await page.getByTestId('to-briefing').click();
  await expect(page.getByTestId('briefing-text')).not.toBeEmpty();
  await page.getByTestId('start-match').click();
  await expect(page.getByTestId('level-canvas')).toHaveAttribute('data-rendered', 'true', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('phase')).toContainText('Preparation', { timeout: 15_000 });
}

/** Clicks (or taps, on touch devices) a map point of the Lion level. */
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
  // Two taps in a row would be a double tap (camera focus).
  await page.waitForTimeout(400);
}

async function openDrawer(page: Page) {
  const handle = page.getByTestId('drawer-handle');
  if ((await handle.count()) && (await handle.getAttribute('aria-expanded')) === 'false')
    await handle.click();
}

test('plays the Defender against the computer: builds on the map, upgrades, pauses and speeds up', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const touch = testInfo.project.name !== 'desktop';
  await prepare(page);
  await startSinglePlayer(page, 'defender');
  if (testInfo.project.name !== 'phone')
    await expect(page.getByTestId('computer-badge')).toContainText('Easy');

  // Build an observation post by choosing it and tapping a glowing place on the map.
  const supplies = Number(await page.getByTestId('defender-supplies').textContent());
  await page.getByTestId('build-observation-post').click();
  await expect(page.getByTestId('mode-hint')).toBeVisible();
  await tapMap(page, -16, 19, touch);
  await expect(page.getByTestId('mode-hint')).toBeHidden();
  await expect(page.locator('.minimap-defense')).toHaveCount(1);
  await expect
    .poll(async () => Number(await page.getByTestId('defender-supplies').textContent()))
    .toBeLessThan(supplies);

  // Tap it on the map to select it, then upgrade it.
  await tapMap(page, -16, 19, touch);
  await expect(page.getByTestId('asset-orders')).toBeVisible();
  await page.getByTestId('order-upgrade').click();
  await expect(page.getByTestId('asset-orders')).toContainText('Level 2');
  await page.screenshot({ path: testInfo.outputPath(`defender-hud-${testInfo.project.name}.png`) });

  // Pause holds the clock; 2× speed is a toggle.
  await page.getByTestId('pause').click();
  await expect(page.getByTestId('paused-banner')).toBeVisible();
  const frozen = await page.getByTestId('phase').textContent();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('phase')).toHaveText(frozen ?? '');
  await page.getByTestId('pause').click();
  await expect(page.getByTestId('paused-banner')).toBeHidden();
  await page.getByTestId('speed').click();
  await expect(page.getByTestId('speed')).toHaveAttribute('aria-pressed', 'true');

  // Esc first clears the selection; F10 opens the menu, which pauses single player.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('asset-orders')).toHaveCount(0);
  await page.keyboard.press('F10');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  await expect(page.getByTestId('pause-menu')).toContainText('Paused');
  await page.getByTestId('quit').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();
});

test('plays the Attacker: picks a route on the map, launches with the keyboard and gives orders', async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const touch = testInfo.project.name !== 'desktop';
  await prepare(page);
  await startSinglePlayer(page, 'attacker');

  // Tapping the riverbed on the map makes it the route of the wave being built.
  await expect(page.getByTestId('route-riverbed')).toHaveAttribute('aria-checked', 'false');
  await tapMap(page, -13, 27, touch);
  await expect(page.getByTestId('route-riverbed')).toHaveAttribute('aria-checked', 'true');
  // Key 3 picks the third unit (Scout, Guide, Expedition Team …), T the first route.
  await page.keyboard.press('Digit3');
  await expect(page.getByTestId('unit-expedition-team')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('KeyT');
  await expect(page.getByTestId('route-ridge')).toHaveAttribute('aria-checked', 'true');

  // Speed up through preparation, back to normal speed, then launch with Space.
  await page.getByTestId('speed').click();
  await expect(page.getByTestId('launch-status')).toHaveClass(/ready/, { timeout: 40_000 });
  await page.keyboard.press('KeyQ');
  await expect(page.getByTestId('speed')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Space');
  await expect(page.locator('.minimap-group').first()).toBeAttached({ timeout: 10_000 });
  // Pause so the group is still short of the junction when the order arrives (slow test machines).
  await page.keyboard.press('KeyP');
  await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'true');

  await openDrawer(page);
  await page.getByTestId('group-row').first().click();
  await expect(page.getByTestId('group-orders')).toBeVisible();
  await page.getByTestId('order-hold').click();
  await page.keyboard.press('KeyP');
  await expect(page.getByTestId('group-orders')).toContainText(/holding|stops at the next junction/);
  await page.screenshot({ path: testInfo.outputPath(`attacker-hud-${testInfo.project.name}.png`) });
});

test('guides a new Defender through the tutorial, holding the clock while Guo talks', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one device is enough for the tutorial flow');
  test.setTimeout(90_000);
  await page.request.put('/api/settings', {
    data: { language: 'en', graphics: 'low', onboarding: { tutorialOffered: false, tutorialsDone: [] } },
  });
  await page.goto('/?debug');
  await expect(page.getByTestId('tutorial-offer')).toBeVisible();
  await page.getByTestId('offer-defender').click();
  await expect(page.getByTestId('level-canvas')).toHaveAttribute('data-rendered', 'true', {
    timeout: 30_000,
  });

  const tutorial = page.getByTestId('tutorial');
  await expect(tutorial).toContainText('Step 1 of 11');
  await expect(page.locator('[data-tutorial="objective"]')).toHaveClass(/tutorial-highlight/);
  const clock = await page.getByTestId('phase').textContent();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('phase')).toHaveText(clock ?? '');

  await page.getByTestId('tutorial-next').click();
  await expect(tutorial).toContainText('Step 2 of 11');
  await page.getByTestId('tutorial-next').click();
  await expect(tutorial).toContainText('Step 3 of 11');
  await expect(page.getByTestId('tutorial-next')).toHaveCount(0);
  await expect(page.locator('[data-tutorial="build-bar"]')).toHaveClass(/tutorial-highlight/);

  await page.getByTestId('build-observation-post').click();
  await tapMap(page, -16, 19, false);
  await expect(tutorial).toContainText('Step 4 of 11');

  await page.getByTestId('tutorial-skip').click();
  await expect(tutorial).toBeHidden();
  const settings = await (await page.request.get('/api/settings')).json();
  expect(settings.onboarding.tutorialsDone).toContain('defender');
  expect(settings.onboarding.tutorialOffered).toBe(true);
});

test('shows a first-time hint once and remembers it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'hints work the same on every device');
  await prepare(page, []);
  await startSinglePlayer(page, 'defender');
  await expect(page.getByTestId('hint')).toContainText('Pick something to build');
  await page.getByTestId('hint-ok').click();
  await expect(page.getByTestId('hint')).toBeHidden();
  await expect
    .poll(async () => (await (await page.request.get('/api/settings')).json()).onboarding.hintsSeen)
    .toContain('startDefender');
});

test('changes a key binding, warns about a clash and resets', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'key bindings are a keyboard feature');
  await prepare(page);
  await page.goto('/');
  await page.getByTestId('menu-settings').click();
  await page.getByTestId('settings-tab-controls').click();

  await page.getByTestId('bind-match.pause').click();
  await page.keyboard.press('KeyO');
  await expect(page.getByTestId('bind-match.pause')).toHaveText('O');
  await page.getByTestId('bind-match.speed').click();
  await page.keyboard.press('KeyO');
  await expect(page.getByTestId('key-conflicts')).toBeVisible();

  await page.getByTestId('reset-keys').click();
  await expect(page.getByTestId('bind-match.pause')).toHaveText('P');
  await expect(page.getByTestId('key-conflicts')).toBeHidden();

  await page.getByTestId('settings-tab-accessibility').click();
  await page.getByTestId('access-highContrastRoutes').check();
  await expect
    .poll(
      async () => (await (await page.request.get('/api/settings')).json()).accessibility.highContrastRoutes,
    )
    .toBe(true);
  await page.getByTestId('access-highContrastRoutes').uncheck();
  await page.getByRole('button', { name: 'Close' }).click();
});

test('opens the manual with a page for each profile', async ({ page }) => {
  await prepare(page);
  await page.goto('/');
  await page.getByTestId('menu-manual').click();
  await expect(page.getByTestId('manual-page')).toContainText('How a match works');
  await page.getByTestId('manual-profile-ranger').click();
  await expect(page.getByTestId('manual-page')).toContainText('Observation Post');
  await page.getByTestId('manual-controls').click();
  await expect(page.getByTestId('manual-page')).toContainText('Launch wave');
  await page.getByTestId('manual-back').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();
});
