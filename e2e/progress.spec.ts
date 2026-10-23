import { expect, test, type Page } from '@playwright/test';

/** English, no tutorial offer and no first-time hints in the way. */
const SETTINGS = {
  language: 'en',
  graphics: 'low',
  keyBindings: {},
  playerName: 'Guo',
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
};

/** A save with some progress: Explorer at level 3, Ranger at level 2, a few high scores and statistics. */
function seededSave() {
  const score = (
    score: number,
    side: string,
    opponent: string,
    won: boolean,
    name: string,
    profileId: string,
  ) => ({
    stageId: 'stage-01-big-five',
    levelId: 'lion',
    side,
    opponent,
    teamSize: 1,
    score,
    players: [{ name, profileId, controller: 'human' }],
    mode: opponent === 'human' ? 'wifi' : 'single',
    won,
    date: '2026-10-22T18:30:00.000Z',
  });
  return {
    version: 2,
    settings: SETTINGS,
    unlocks: { stages: { 'stage-01-big-five': { completedLevels: ['lion'] } } },
    records: { 'stage-01-big-five': { lion: { attacker: ['easy', 'medium'], defender: ['easy'] } } },
    profiles: { 'stage-01-big-five': { explorer: { xp: 1240 }, ranger: { xp: 520 }, hunter: { xp: 180 } } },
    highScores: [
      score(4120, 'attacker', 'medium', true, 'Guo', 'explorer'),
      score(3310, 'attacker', 'easy', true, 'Guo', 'explorer'),
      score(1890, 'attacker', 'medium', false, 'Guo', 'hunter'),
      score(2675, 'defender', 'easy', true, 'Guo', 'ranger'),
      score(2950, 'attacker', 'human', true, 'Mia', 'explorer'),
    ],
    statistics: {
      matchesPlayed: 7,
      wins: 5,
      losses: 3,
      attackerWins: 4,
      defenderWins: 1,
      matches1v1: 7,
      singlePlayerMatches: 5,
      hotSeatMatches: 1,
      wifiMatches: 1,
      profileUsage: { explorer: 4, hunter: 1, ranger: 3 },
      wavesLaunched: 38,
      reroutes: 11,
      defensesDisrupted: 6,
      defensesDismantled: 2,
      attackersStopped: 64,
      patrolInterceptions: 21,
      detections: 30,
      defensesBuilt: 19,
      abilitiesUsed: 27,
      playSeconds: 5520,
      bestScore: 4120,
    },
    updatedAt: '2026-10-22T18:30:00.000Z',
  };
}

/** Imports a save for the test and puts the one from before back afterwards (all tests share one save). */
async function withSave(page: Page, save: unknown, run: () => Promise<void>) {
  const before = await (await page.request.get('/api/save/export')).text();
  const response = await page.request.post('/api/save/import', { data: save });
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

test('shows profile levels and unlocks, high scores and statistics', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  await withSave(page, seededSave(), async () => {
    await page.goto('/');
    await page.getByTestId('menu-progress').click();
    await expect(page.getByTestId('progress')).toBeVisible();

    const explorer = page.getByTestId('progress-profile-explorer');
    await expect(explorer.getByTestId('level-bar')).toContainText('Level 3 · 240 / 800 XP');
    const ranks = explorer.getByTestId('ranks-explorer').locator('li');
    await expect(ranks).toHaveCount(4);
    await expect(ranks.nth(1)).toHaveClass(/unlocked/);
    await expect(ranks.nth(2)).toHaveClass(/locked/);
    await expect(page.getByTestId('progress-profile-photographer').getByTestId('level-bar')).toContainText(
      'Level 1 · 0 / 400 XP',
    );
    await page.screenshot({ path: testInfo.outputPath(`progress-profiles-${project}.png`) });

    await page.getByTestId('progress-highScores').click();
    await expect(page.getByTestId('scores-medium').locator('tbody tr')).toHaveCount(2);
    await expect(page.getByTestId('scores-medium').locator('tbody tr').first()).toContainText('4,120');
    await expect(page.getByTestId('scores-human')).toContainText('Mia');
    await page.screenshot({ path: testInfo.outputPath(`progress-scores-${project}.png`) });
    await page.getByTestId('scores-defender').click();
    await expect(page.getByTestId('scores-easy')).toContainText('2,675');

    await page.getByTestId('progress-statistics').click();
    await expect(page.getByTestId('stat-matchesPlayed')).toHaveText('7');
    await expect(page.getByTestId('stat-playSeconds')).toHaveText('92 min');
    await page.screenshot({ path: testInfo.outputPath(`progress-stats-${project}.png`) });

    // The profile picker shows each profile's level.
    await page.getByTestId('progress-back').click();
    await page.getByTestId('menu-single').click();
    await page.getByTestId('side-attacker').click();
    await expect(page.getByTestId('level-explorer')).toHaveText('Level 3');
    await expect(page.getByTestId('level-photographer')).toHaveText('Level 1');
  });
});

test('exports the save and imports it back in Settings', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the save lives on the PC');
  await withSave(page, seededSave(), async () => {
    await page.goto('/');
    await page.getByTestId('menu-settings').click();
    await page.getByTestId('settings-tab-save').click();
    await expect(page.getByTestId('save-info')).toContainText('Backups:');

    const download = page.waitForEvent('download');
    await page.getByTestId('save-export').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^GuosTowerDefense-save-\d{4}-\d{2}-\d{2}\.json$/);

    const exported = JSON.parse(await (await page.request.get('/api/save/export')).text());
    exported.settings.playerName = 'Imported';
    await page.getByTestId('save-import-file').setInputFiles({
      name: 'save.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(exported)),
    });
    await expect(page.getByTestId('save-message')).toHaveText('The save was imported.');
    await page.screenshot({ path: testInfo.outputPath('settings-save-desktop.png') });
    await page.getByTestId('settings-tab-general').click();
    await expect(page.getByTestId('settings-name')).toHaveValue('Imported');

    await page.getByTestId('settings-tab-save').click();
    await page.getByTestId('save-import-file').setInputFiles({
      name: 'notes.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"hello":1}'),
    });
    await expect(page.getByTestId('save-message')).toHaveText('This file is not a save of this game.');
  });
});

test('a whole match against the computer gives score, XP and a high score', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'desktop and phone are enough; it runs in real time');
  test.setTimeout(300_000);
  const project = testInfo.project.name;
  await withSave(page, { ...seededSave(), profiles: {}, highScores: [] }, async () => {
    await page.goto('/?debug');
    await page.getByTestId('menu-single').click();
    await page.getByTestId('side-defender').click();
    await page.getByTestId('profile-ranger').click();
    await page.getByTestId('to-briefing').click();
    await page.getByTestId('start-match').click();
    await expect(page.getByTestId('level-canvas')).toHaveAttribute('data-rendered', 'true', {
      timeout: 30_000,
    });
    // Nothing is built: the computer's Explorers reach the waterhole and hold it. 2× speed keeps the test short.
    await page.getByTestId('speed').click();
    await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 240_000 });
    const mine = page.getByTestId('reward-defender');
    await expect(mine).toBeVisible({ timeout: 10_000 });
    await expect(mine).toContainText('XP');
    await expect(page.getByTestId('high-score-defender')).toHaveText('New best score!');
    await expect(page.getByTestId('reward-attacker')).toContainText('The computer earns no XP.');
    await page.screenshot({ path: testInfo.outputPath(`result-rewards-${project}.png`) });

    const progress = await (await page.request.get('/api/progress')).json();
    expect(progress.profileXp['stage-01-big-five'].ranger).toBeGreaterThanOrEqual(100);
    expect(progress.profileXp['stage-01-big-five'].explorer).toBeUndefined();
    const records = await (await page.request.get('/api/records')).json();
    expect(records.highScores).toHaveLength(1);
    expect(records.statistics.matchesPlayed).toBe(8);
  });
});
