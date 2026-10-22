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

/** Single player against a Hard computer with its reasoning shown: the person's profile, then the computer's. */
async function startAgainst(page: Page, side: 'attacker' | 'defender', own: string, computer: string) {
  await page.goto('/?debug');
  await page.getByTestId('menu-single').click();
  await expect(page.getByTestId('setup')).toBeVisible();
  const other = side === 'attacker' ? 'defender' : 'attacker';
  await page.getByTestId(`side-${other}`).click();
  await page.getByTestId(`profile-${computer}`).click();
  await page.getByTestId(`side-${side}`).click();
  await page.getByTestId(`profile-${own}`).click();
  await page.getByTestId('difficulty-hard').click();
  await page.getByTestId('show-ai-reasoning').check();
  await page.getByTestId('to-briefing').click();
  await page.getByTestId('start-match').click();
  await expect(page.getByTestId('level-canvas')).toHaveAttribute('data-rendered', 'true', {
    timeout: 30_000,
  });
  // The phone's compact top bar has no room for the computer badge; the reasoning panel shows it is there.
  await expect(page.getByTestId('ai-reasoning')).toBeVisible();
}

/** The reasoning panel starts folded on small screens (it would cover the action bar). */
async function unfoldReasoning(page: Page) {
  const unfold = page.getByTestId('ai-reasoning').getByRole('button');
  if ((await unfold.getAttribute('aria-expanded')) === 'false') await unfold.click();
}

test('the computer Wildlife Protector uses its own tools against a group', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await prepare(page);
  await startAgainst(page, 'attacker', 'explorer', 'wildlife-protector');

  // A wave on its way: the computer protects the assets the group comes close to (Fortify, a command slot) or
  // slows it with a Protected Zone.
  await page.getByTestId('unit-expedition-team').click();
  await page.getByTestId('speed').click();
  await expect(page.getByTestId('launch-status')).toHaveClass(/ready/, { timeout: 40_000 });
  await page.getByTestId('launch-wave').click();
  await expect(page.locator('.minimap-group').first()).toBeAttached({ timeout: 10_000 });
  await unfoldReasoning(page);
  // It built from the start and said why.
  await expect(page.getByTestId('ai-reasoning')).toContainText('Build');
  await expect(page.getByTestId('ai-reasoning')).toContainText(/fortify on|protected-zone at/, {
    timeout: 90_000,
  });
  await page.getByTestId('pause').click();
  await page.screenshot({ path: testInfo.outputPath(`ai-protector-${testInfo.project.name}.png`) });
});

test('the computer Hunter plans its waves against what it has seen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the Hunter view is the same on every screen size');
  test.setTimeout(180_000);
  await prepare(page);
  await startAgainst(page, 'defender', 'ranger', 'hunter');
  await unfoldReasoning(page);
  await page.getByTestId('speed').click();
  // Hard Hunter: it saves up or launches, and names its plan of attack.
  await expect(page.getByTestId('ai-reasoning')).toContainText(/Launch \d+|attack\)/, { timeout: 60_000 });
  await page.getByTestId('pause').click();
  await page.screenshot({ path: testInfo.outputPath(`ai-hunter-${testInfo.project.name}.png`) });
});
