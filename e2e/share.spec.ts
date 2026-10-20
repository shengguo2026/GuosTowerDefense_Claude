import type { NetworkInfo } from '@gtd/protocol';
import { devices, expect, test, type Browser, type Page } from '@playwright/test';

/** English, low graphics and no tutorial offer, so the menus are not covered. */
async function prepare(page: Page) {
  const response = await page.request.put('/api/settings', {
    data: { language: 'en', graphics: 'low', onboarding: { tutorialOffered: true } },
  });
  expect(response.ok()).toBe(true);
}

/** A tablet or phone in the same network: a separate browser that opens the address from the QR code. */
async function guestPage(browser: Browser, kind: 'tablet' | 'phone', address: string) {
  const context = await browser.newContext({
    ...devices[kind === 'phone' ? 'Pixel 7' : 'Galaxy Tab S4'],
    viewport: kind === 'phone' ? { width: 844, height: 390 } : { width: 1180, height: 820 },
    screen: kind === 'phone' ? { width: 844, height: 390 } : { width: 1180, height: 820 },
    // Software rendering in the test browser: keep the pixel count of two 3D matches at once manageable.
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(address);
  return page;
}

test.describe('play on tablet or phone', () => {
  test('the PC explains the firewall, shares the game, and a tablet and a phone play on it', async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop',
      'The PC shares; the tablet and the phone join in this test.',
    );
    test.setTimeout(240_000);
    await prepare(page);
    await page.request.put('/api/network', { data: { sharing: false } });
    // The explainer comes once per save; every test run starts with a fresh one.
    const explained = ((await (await page.request.get('/api/network')).json()) as NetworkInfo)
      .firewallExplained;
    await page.goto('/');

    await page.getByTestId('menu-share').click();
    await expect(page.getByTestId('share-off')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('share-off.png') });
    await page.getByTestId('share-open').click();

    // Windows: one screen on the firewall question before the game opens to the network.
    if (!explained) {
      await expect(page.getByTestId('firewall-explainer')).toBeVisible();
      await expect(page.getByTestId('firewall-explainer')).toContainText('Private networks');
      await page.screenshot({ path: testInfo.outputPath('firewall-desktop.png') });
      await page.getByTestId('firewall-continue').click();
    }

    await expect(page.getByTestId('share-on')).toBeVisible();
    const qr = page.getByTestId('qr-code');
    test.skip(
      (await page.getByTestId('share-no-network').count()) > 0,
      'This machine has no network address.',
    );
    await expect(qr).toBeVisible();
    const address = (await qr.getAttribute('data-text')) ?? '';
    const port = new URL(page.url()).port;
    expect(address).toMatch(new RegExp(`^http://\\d+\\.\\d+\\.\\d+\\.\\d+:${port}/$`));
    await expect(page.getByTestId('share-address')).toHaveText(address.slice(7, -1));
    await expect(page.getByTestId('share-guests')).toContainText('No tablet or phone');

    // A tablet joins through the network address and starts single player by touch.
    const tablet = await guestPage(browser, 'tablet', address);
    await expect(tablet.getByTestId('guest-info')).toBeVisible();
    await expect(tablet.getByTestId('menu-share')).toHaveCount(0);
    await expect(tablet.getByTestId('menu-two-players')).toBeDisabled();
    await tablet.getByTestId('menu-single').tap();
    await tablet.getByTestId('side-defender').tap();
    await tablet.getByTestId('to-briefing').tap();
    await tablet.getByTestId('start-match').tap();
    await expect(tablet.getByTestId('level-canvas')).toHaveAttribute('data-rendered', 'true', {
      timeout: 30_000,
    });
    await expect(tablet.getByTestId('phase')).toContainText('Preparation', { timeout: 15_000 });
    await tablet.screenshot({ path: testInfo.outputPath('tablet-match.png') });

    // Only the PC can stop sharing; the tablet is told no.
    const refused = await tablet.request.put(`${address}api/network`, { data: { sharing: false } });
    expect(refused.status()).toBe(403);
    await tablet.context().close();

    // A phone joins as well.
    const phone = await guestPage(browser, 'phone', address);
    await expect(phone.getByTestId('guest-info')).toBeVisible();
    await phone.screenshot({ path: testInfo.outputPath('phone-menu.png') });
    await phone.getByTestId('menu-single').tap();
    await phone.getByTestId('side-attacker').tap();
    await phone.getByTestId('to-briefing').tap();
    await phone.getByTestId('start-match').tap();
    await expect(phone.getByTestId('level-canvas')).toHaveAttribute('data-rendered', 'true', {
      timeout: 30_000,
    });
    await phone.screenshot({ path: testInfo.outputPath('phone-match.png') });

    await expect(page.getByTestId('share-guests')).toContainText('connected', { timeout: 10_000 });
    await page.screenshot({ path: testInfo.outputPath('share-desktop.png') });

    // The menu remembers where the game is shared; stopping closes it to the network again.
    await page.getByTestId('share-back').click();
    await expect(page.getByTestId('menu-share')).toContainText(address.slice(7, -1));
    await page.getByTestId('menu-share').click();
    await page.getByTestId('share-stop').click();
    await expect(page.getByTestId('share-off')).toBeVisible();
    await expect(phone.request.get(`${address}api/health`, { timeout: 3000 })).rejects.toThrow();

    // Turning it on again needs no second explanation.
    await page.getByTestId('share-open').click();
    await expect(page.getByTestId('share-on')).toBeVisible();
    await page.getByTestId('share-stop').click();
    await phone.context().close();
  });
});

test('asks to turn a tablet or phone held upright sideways', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Portrait matters on touch devices.');
  await prepare(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const hint = page.getByTestId('rotate-hint');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('Rotate your device for the full game experience.');
  await page.screenshot({ path: testInfo.outputPath('rotate-phone.png') });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(hint).toBeHidden();
});
