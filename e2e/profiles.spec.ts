import { expect, test, type Page } from '@playwright/test';

/** English, no tutorial offer and no first-time hints in the way. */
async function prepare(page: Page) {
  const response = await page.request.put('/api/settings', {
    data: {
      language: 'en',
      graphics: 'low',
      keyBindings: {},
      onboarding: {
        tutorialOffered: true,
        hintsSeen: [
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
        ],
      },
    },
  });
  expect(response.ok()).toBe(true);
}

async function startAs(page: Page, side: 'attacker' | 'defender', profileId: string) {
  await page.goto('/?debug');
  await page.getByTestId('menu-single').click();
  await expect(page.getByTestId('setup')).toBeVisible();
  await page.getByTestId(`side-${side}`).click();
  await page.getByTestId(`profile-${profileId}`).click();
  await expect(page.getByTestId(`profile-${profileId}`)).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('to-briefing').click();
  await page.getByTestId('start-match').click();
  await expect(page.getByTestId('level-canvas')).toHaveAttribute('data-rendered', 'true', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('phase')).toContainText('Preparation', { timeout: 15_000 });
}

async function openDrawer(page: Page) {
  const handle = page.getByTestId('drawer-handle');
  if ((await handle.count()) && (await handle.getAttribute('aria-expanded')) === 'false')
    await handle.click();
}

test('plays the Hunter: its own command slots sit next to the base orders', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await prepare(page);
  await startAs(page, 'attacker', 'hunter');
  await expect(page.getByTestId('unit-hunter-team')).toBeVisible();

  await page.getByTestId('unit-hunter-team').click();
  await page.getByTestId('speed').click();
  await expect(page.getByTestId('launch-status')).toHaveClass(/ready/, { timeout: 40_000 });
  await page.getByTestId('speed').click();
  await page.getByTestId('launch-wave').click();
  await expect(page.locator('.minimap-group').first()).toBeAttached({ timeout: 10_000 });
  await page.getByTestId('pause').click();

  await openDrawer(page);
  await page.getByTestId('group-row').first().click();
  const orders = page.getByTestId('group-orders');
  await expect(orders).toBeVisible();
  // Hunter slots: hold advance retreat reroute focus-defense rush; formation is a base order without a key.
  await expect(page.getByTestId('slot-focus-defense')).toContainText('Focus Defense');
  await expect(page.getByTestId('slot-rush')).toBeVisible();
  await expect(page.getByTestId('order-formation')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`hunter-orders-${testInfo.project.name}.png`) });

  // Rush: an effect command used from the selected group; the group shows it as a status.
  await page.getByTestId('pause').click();
  await page.getByTestId('slot-rush').click();
  await expect(orders.getByTestId('status-chips')).toContainText('Boosted', { timeout: 10_000 });
});

test('plays the Wildlife Protector: eleven assets, Fortify protects the selected asset', async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const touch = testInfo.project.name !== 'desktop';
  await prepare(page);
  await startAs(page, 'defender', 'wildlife-protector');
  await expect(page.locator('.build-card')).toHaveCount(11);

  // Build a protection tower in a build zone the HUD does not cover on this screen.
  await page.getByTestId('build-protection-tower').click();
  const sites = await page.evaluate(() => {
    const view = (
      window as unknown as {
        __gtdView: {
          options: { level: { map: { nodes: { buildable?: boolean; x: number; z: number }[] } } };
          screenPoint(x: number, z: number): { x: number; y: number } | null;
        };
      }
    ).__gtdView;
    return view.options.level.map.nodes
      .filter((n) => n.buildable)
      .map((n) => view.screenPoint(n.x, n.z))
      .filter((p): p is { x: number; y: number } => p !== null)
      .filter((p) => document.elementFromPoint(p.x, p.y)?.tagName === 'CANVAS');
  });
  expect(sites.length).toBeGreaterThan(0);
  const site = sites[0]!;
  if (touch) await page.touchscreen.tap(site.x, site.y);
  else await page.mouse.click(site.x, site.y);
  await expect(page.getByTestId('mode-hint')).toBeHidden();
  await openDrawer(page);
  await page.getByTestId('asset-row').first().click();
  await expect(page.getByTestId('asset-orders')).toBeVisible();
  await page.getByTestId('slot-fortify').click();
  await expect(page.getByTestId('asset-orders').getByTestId('status-chips')).toContainText('Protected', {
    timeout: 10_000,
  });
  await page.screenshot({ path: testInfo.outputPath(`protector-${testInfo.project.name}.png`) });
});

test('lists each profile’s command slots in the manual', async ({ page }) => {
  await prepare(page);
  await page.goto('/');
  await page.getByTestId('menu-manual').click();
  await page.getByTestId('manual-profile-field-researcher').click();
  await expect(page.getByTestId('manual-page')).toContainText('Command slots');
  await expect(page.getByTestId('manual-page')).toContainText('Sensor Beacon');
  await expect(page.getByTestId('manual-page')).toContainText('spots hidden groups');
});
