import type { NetworkInfo } from '@gtd/protocol';
import { devices, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/** English, low graphics and no tutorial offer, so the menus are not covered. */
async function prepare(page: Page) {
  const response = await page.request.put('/api/settings', {
    data: { language: 'en', graphics: 'low', onboarding: { tutorialOffered: true } },
  });
  expect(response.ok()).toBe(true);
}

type Guest = Page & { guestLog: string[] };

/** A phone or tablet in the same Wi-Fi: its own browser, which keeps its storage (and session token) across pages. */
async function guestContext(browser: Browser, kind: 'tablet' | 'phone') {
  return browser.newContext({
    ...devices[kind === 'phone' ? 'Pixel 7' : 'Galaxy Tab S4'],
    viewport: kind === 'phone' ? { width: 844, height: 390 } : { width: 1180, height: 820 },
    screen: kind === 'phone' ? { width: 844, height: 390 } : { width: 1180, height: 820 },
    // Software rendering in the test browser: keep the pixel count of two 3D matches at once manageable.
    deviceScaleFactor: 1,
  });
}

async function openGuest(context: BrowserContext, kind: string, address: string): Promise<Guest> {
  const page = await context.newPage();
  const log: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning')
      log.push(`${kind} console: ${message.text()}`);
  });
  page.on('pageerror', (error) => log.push(`${kind} error: ${error.message}`));
  const started = Date.now();
  page.on('websocket', (ws) => {
    log.push(`${kind} ${Date.now() - started} ms: connection opened`);
    ws.on('close', () => log.push(`${kind} ${Date.now() - started} ms: connection closed`));
  });
  await page.goto(address);
  return Object.assign(page, { guestLog: log });
}

/** Waits for a match to render; on failure says what the page saw and logged. */
async function expectMatch(page: Page, log: string[] = []) {
  try {
    await expect(page.getByTestId('level-canvas')).toHaveAttribute('data-rendered', 'true', {
      timeout: 90_000,
    });
  } catch (error) {
    const screen = await page.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => '?');
    throw new Error(`${(error as Error).message}\nScreen: ${screen}\nLog:\n${log.join('\n')}`);
  }
}

test.describe('Wi-Fi 1v1', () => {
  test('the PC hosts, a phone joins with the QR code, both play, the phone drops out and comes back', async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The PC hosts; the phone joins in this test.');
    test.setTimeout(480_000);
    await prepare(page);
    await page.request.put('/api/network', { data: { sharing: false } });
    const explained = ((await (await page.request.get('/api/network')).json()) as NetworkInfo)
      .firewallExplained;
    await page.goto('/');

    // The PC opens a game: the firewall explainer first (once per save), then the lobby.
    await page.getByTestId('menu-wifi').click();
    await expect(page.getByTestId('wifi-host-card')).toBeVisible();
    await page.getByTestId('wifi-name').fill('Guo');
    await page.screenshot({ path: testInfo.outputPath('wifi-desktop.png') });
    await page.getByTestId('wifi-host').click();
    if (!explained) {
      await expect(page.getByTestId('firewall-explainer')).toBeVisible();
      await page.getByTestId('firewall-continue').click();
    }
    await expect(page.getByTestId('lobby')).toBeVisible();
    test.skip(
      (await page.getByTestId('lobby-no-network').count()) > 0,
      'This machine has no network address.',
    );
    const code = ((await page.getByTestId('lobby-code').locator('strong').textContent()) ?? '').replace(
      ' ',
      '',
    );
    expect(code).toMatch(/^\d{6}$/);
    const joinAddress = (await page.getByTestId('qr-code').getAttribute('data-text')) ?? '';
    const port = new URL(page.url()).port;
    expect(joinAddress).toMatch(new RegExp(`^http://\\d+\\.\\d+\\.\\d+\\.\\d+:${port}/\\?join=${code}$`));
    await expect(page.getByTestId('lobby-address')).toHaveText(
      joinAddress.slice(7, joinAddress.indexOf('/?')),
    );
    await expect(page.getByTestId('slot-A1-name')).toHaveText('Guo');
    await expect(page.getByTestId('lobby-start')).toBeDisabled();

    // A wrong code is refused with a clear message.
    const address = joinAddress.slice(0, joinAddress.indexOf('?'));
    const phoneContext = await guestContext(browser, 'phone');
    const probe = await openGuest(phoneContext, 'phone', address);
    await probe.getByTestId('menu-wifi').tap();
    await expect(probe.getByTestId('wifi-join-card')).toContainText('A game is open on the PC');
    await expect(probe.getByTestId('wifi-host-card')).toHaveCount(0);
    await probe.getByTestId('wifi-code').fill(code === '000000' ? '111111' : '000000');
    await probe.getByTestId('wifi-join').tap();
    await expect(probe.getByTestId('wifi-error')).toContainText('No game with this code');
    await probe.close();

    // The phone scans the QR code: it lands in the lobby on the Defender side.
    const phone = await openGuest(phoneContext, 'phone', joinAddress);
    await expect(phone.getByTestId('lobby')).toBeVisible({ timeout: 20_000 });
    await expect(phone.getByTestId('slot-D1-name')).toHaveText('Guest');
    await expect(page.getByTestId('lobby-status')).toContainText('Waiting for Guest to get ready');
    // A reload keeps the phone's place (its session token is stored on the phone).
    await phone.reload();
    await expect(phone.getByTestId('lobby')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('slot-D1-name')).toHaveText('Guest');
    await phone.getByTestId('slot-D1-profile-field-researcher').tap();
    await expect(page.getByTestId('slot-D1-profile-field-researcher')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await phone.getByTestId('lobby-ready').tap();
    await expect(page.getByTestId('slot-D1-ready')).toHaveText('Ready');
    await expect(phone.getByTestId('lobby-status')).toContainText('Waiting for the host');
    await page.getByTestId('lobby-difficulty-hard').click();
    // A change of the host's choices asks the guest to confirm again.
    await expect(phone.getByTestId('slot-D1-ready')).toHaveText('Not ready');
    await phone.getByTestId('lobby-ready').tap();
    await expect(page.getByTestId('lobby-start')).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('lobby-desktop.png') });
    await phone.screenshot({ path: testInfo.outputPath('lobby-phone.png') });

    // The host starts: the PC plays the Attacker, the phone the Defender.
    await page.getByTestId('lobby-start').click();
    await expectMatch(page);
    await expectMatch(phone, phone.guestLog);
    await expect(page.getByTestId('opponent-badge')).toHaveText('vs Guest');
    await expect(page.getByTestId('speed')).toHaveCount(0);
    await expect(phone.getByTestId('pause')).toHaveCount(0);
    await expect(page.getByTestId('phase')).toContainText('Preparation', { timeout: 15_000 });

    // Only the host pauses; the phone is told who paused.
    await page.getByTestId('pause').click();
    await expect(phone.getByTestId('paused-banner')).toHaveText('Paused by the host');
    await page.screenshot({ path: testInfo.outputPath('match-desktop.png') });
    await phone.screenshot({ path: testInfo.outputPath('match-phone.png') });
    await page.getByTestId('pause').click();
    await expect(phone.getByTestId('paused-banner')).toHaveCount(0);

    // The phone drops out: the computer plays the Defender and the PC says so.
    await phone.close();
    await expect(page.getByTestId('wifi-away')).toContainText('Guest lost the connection', {
      timeout: 15_000,
    });
    await page.screenshot({ path: testInfo.outputPath('away-desktop.png') });

    // The PC's browser goes away too (the computer now plays both sides); its 3D view would only compete with the
    // phone's software rendering here.
    await page.goto('about:blank');

    // The phone opens the game again: its session token brings it back into the match.
    const back = await openGuest(phoneContext, 'phone', address);
    await expectMatch(back, back.guestLog);
    await expect(back.getByTestId('wifi-away')).toContainText('Guo lost the connection', { timeout: 15_000 });
    await expect(back.getByTestId('drawer-handle')).toBeVisible();
    await back.screenshot({ path: testInfo.outputPath('back-phone.png') });

    // So does the PC: it is the host again and can pause.
    await page.goto('/');
    await expectMatch(page);
    await expect(page.getByTestId('pause')).toBeVisible();
    await expect(page.getByTestId('wifi-away')).toHaveCount(0, { timeout: 15_000 });
    await expect(back.getByTestId('wifi-away')).toHaveCount(0, { timeout: 15_000 });

    // The Wi-Fi drops (the PC stops sharing for a moment): the phone keeps trying and is back in the match.
    await page.request.put('/api/network', { data: { sharing: false } });
    await expect(page.getByTestId('wifi-away')).toContainText('Guest lost the connection', {
      timeout: 15_000,
    });
    await expect(back.getByTestId('wifi-away')).toContainText('Connection to the PC lost');
    await back.screenshot({ path: testInfo.outputPath('lost-phone.png') });
    await page.request.put('/api/network', { data: { sharing: true } });
    await expect(page.getByTestId('wifi-away')).toHaveCount(0, { timeout: 30_000 });
    await expect(back.getByTestId('wifi-away')).toHaveCount(0, { timeout: 15_000 });

    // The host closes the game: the phone is told and returns to the Wi-Fi screen.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pause-menu')).toBeVisible();
    await expect(page.getByTestId('restart')).toHaveCount(0);
    await page.getByTestId('quit').click();
    await expect(back.getByTestId('wifi-closed')).toHaveText('The host closed the game.', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('wifi-screen')).toBeVisible();
    await phoneContext.close();
    await page.request.put('/api/network', { data: { sharing: false } });
  });
});
