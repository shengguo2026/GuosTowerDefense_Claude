import { resolve } from 'node:path';
import { createMatchSetup } from '@gtd/content-schema';
import { loadStageDirectory } from '@gtd/content-schema/node';
import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, createAi } from '@gtd/ai';
import { runBalance } from './balance';
import { idleController, scriptedAttacker, scriptedDefender } from './controllers';
import { runHeadlessMatch } from './runHeadlessMatch';

const TEST_STAGE = resolve(import.meta.dirname, '../../../content/stages/test-stage');

async function testStage() {
  const result = await loadStageDirectory(TEST_STAGE);
  if (!result.ok) throw new Error(result.issues.map((i) => i.message).join('\n'));
  return result.pack;
}

describe('headless matches of the test stage', () => {
  it('plays every level and profile pairing to the end', async () => {
    const pack = await testStage();
    for (const level of pack.levels) {
      for (const attackerProfileId of pack.manifest.profiles.attacker) {
        for (const defenderProfileId of pack.manifest.profiles.defender) {
          const setup = createMatchSetup(pack, {
            levelId: level.id,
            attackerProfileId,
            defenderProfileId,
            seed: 3,
          });
          const run = runHeadlessMatch(setup, { attacker: scriptedAttacker(), defender: scriptedDefender() });
          expect(run.result, `${level.id} ${attackerProfileId} vs ${defenderProfileId}`).not.toBeNull();
          expect(run.ticks).toBeLessThanOrEqual((level.preparationSeconds + level.timerSeconds) * 20);
        }
      }
    }
  });

  it('lets either side win', async () => {
    const pack = await testStage();
    const setup = createMatchSetup(pack, {
      levelId: 'meadow',
      attackerProfileId: 'courier',
      defenderProfileId: 'gatekeeper',
      seed: 9,
    });
    expect(
      runHeadlessMatch(setup, { attacker: scriptedAttacker(), defender: idleController }).result?.winner,
    ).toBe('attacker');
    expect(
      runHeadlessMatch(setup, { attacker: idleController, defender: scriptedDefender() }).result?.winner,
    ).toBe('defender');
  });

  it('replays identically from the same seed', async () => {
    const pack = await testStage();
    const run = (seed: number) =>
      runHeadlessMatch(
        createMatchSetup(pack, {
          levelId: 'canyon',
          attackerProfileId: 'sprinter',
          defenderProfileId: 'lookout',
          seed,
        }),
        { attacker: scriptedAttacker(2, 30), defender: scriptedDefender() },
      ).hash;
    expect(run(11)).toBe(run(11));
  });
});

describe('headless matches of Lion', () => {
  async function lionSetup(seed = 1) {
    const result = await loadStageDirectory(
      resolve(import.meta.dirname, '../../../content/stages/stage-01-big-five'),
    );
    if (!result.ok) throw new Error(result.issues.map((i) => i.message).join('\n'));
    return createMatchSetup(result.pack, {
      levelId: 'lion',
      attackerProfileId: 'explorer',
      defenderProfileId: 'ranger',
      seed,
    });
  }

  it('lets the Defender win against small waves sent one at a time', async () => {
    const run = runHeadlessMatch(await lionSetup(), {
      attacker: scriptedAttacker(4),
      defender: scriptedDefender(),
    });
    expect(run.result).toEqual({ winner: 'defender', reason: 'capacityExhausted' });
  });

  it('lets the Attacker win with massed waves against the same defense', async () => {
    const run = runHeadlessMatch(await lionSetup(), {
      attacker: scriptedAttacker(12, 20, { formation: 'spread', routeId: 'ridge', groupsPerWave: 2 }),
      defender: scriptedDefender(),
    });
    expect(run.result).toEqual({ winner: 'attacker', reason: 'objectiveCompleted' });
  });

  it('ends in a Defender win on time when the Attacker never launches', async () => {
    const setup = await lionSetup();
    const run = runHeadlessMatch(setup, { attacker: idleController, defender: scriptedDefender() });
    expect(run.result).toEqual({ winner: 'defender', reason: 'timerExpired' });
    expect(run.ticks).toBe((setup.level.preparationSeconds + setup.level.timerSeconds) * 20);
  });
});

// The full gate (200 matches per difficulty, no side above 70%) runs as `npm run balance -- 200 --check` in CI.
describe('AI against AI on Lion', { timeout: 60_000 }, () => {
  async function lionPack() {
    const result = await loadStageDirectory(
      resolve(import.meta.dirname, '../../../content/stages/stage-01-big-five'),
    );
    if (!result.ok) throw new Error(result.issues.map((i) => i.message).join('\n'));
    const pack = result.pack;
    return (seed: number) =>
      createMatchSetup(pack, {
        levelId: 'lion',
        attackerProfileId: 'explorer',
        defenderProfileId: 'ranger',
        seed,
      });
  }

  it.each(DIFFICULTIES)(
    'plays %s matches to the end with only accepted commands, and both sides win some',
    async (difficulty) => {
      const report = runBalance(await lionPack(), difficulty, difficulty, 16);
      expect(report.failures).toBe(0);
      expect(report.rejectedCommands).toBe(0);
      expect(report.attackerWins).toBeGreaterThan(0);
      expect(report.defenderWins).toBeGreaterThan(0);
    },
  );

  it('beats an easier opponent from either side', async () => {
    const setupFor = await lionPack();
    expect(runBalance(setupFor, 'hard', 'easy', 10).attackerWins).toBeGreaterThan(7);
    expect(runBalance(setupFor, 'easy', 'hard', 10).defenderWins).toBeGreaterThan(7);
  });
});

// M8: the computer plays every profile. The full gate (200 matches per matchup and difficulty, no side above 70%) runs
// as `npm run balance -- 200 stage-01-big-five lion --all --check` in CI, one job per matchup.
describe('AI against AI in all nine matchups on Lion', { timeout: 120_000 }, () => {
  const ATTACKERS = ['explorer', 'hunter', 'photographer'];
  const DEFENDERS = ['ranger', 'wildlife-protector', 'field-researcher'];

  async function bigFive() {
    const result = await loadStageDirectory(
      resolve(import.meta.dirname, '../../../content/stages/stage-01-big-five'),
    );
    if (!result.ok) throw new Error(result.issues.map((i) => i.message).join('\n'));
    return result.pack;
  }

  it('plays every matchup at every difficulty to the end with only accepted commands', async () => {
    const pack = await bigFive();
    for (const attackerProfileId of ATTACKERS)
      for (const defenderProfileId of DEFENDERS)
        for (const difficulty of DIFFICULTIES) {
          const setupFor = (seed: number) =>
            createMatchSetup(pack, { levelId: 'lion', attackerProfileId, defenderProfileId, seed });
          const report = runBalance(setupFor, difficulty, difficulty, 2);
          const label = `${attackerProfileId} vs ${defenderProfileId} at ${difficulty}`;
          expect(report.failures, label).toBe(0);
          expect(report.rejectedCommands, label).toBe(0);
        }
  });

  it("uses each profile's own abilities, commands and orders", async () => {
    const pack = await bigFive();
    const used = new Set<string>();
    for (const attackerProfileId of ATTACKERS)
      for (const defenderProfileId of DEFENDERS)
        for (const seed of [1, 2, 3]) {
          const setup = createMatchSetup(pack, {
            levelId: 'lion',
            attackerProfileId,
            defenderProfileId,
            seed,
          });
          const run = runHeadlessMatch(setup, {
            attacker: createAi('attacker', 'hard', seed * 2 + 1),
            defender: createAi('defender', 'hard', seed * 2 + 2),
          });
          for (const event of run.events) {
            if (event.type === 'abilityUsed') used.add(event.abilityId);
            if (event.type === 'commandUsed') used.add(event.commandId);
            if (event.type === 'groupFocusDefense' && event.defenseId !== null) used.add('focus-defense');
          }
        }
    // At least two tools of every profile come up in a few hard matches.
    const tools: Record<string, string[]> = {
      explorer: ['reconnaissance', 'field-guide', 'rapid-reroute', 'scout-ahead'],
      hunter: ['sabotage', 'breach', 'coordinated-assault', 'focus-defense', 'rush'],
      photographer: ['concealed-approach', 'perfect-position', 'snapshot-window', 'stay-low'],
      ranger: ['rapid-response', 'intercept', 'emergency-reinforcement'],
      'wildlife-protector': ['conservation-barrier', 'protected-zone', 'habitat-lockdown', 'fortify'],
      'field-researcher': ['area-scan', 'route-analysis', 'deep-analysis', 'scan'],
    };
    for (const [profile, ids] of Object.entries(tools))
      expect(ids.filter((id) => used.has(id)).length, profile).toBeGreaterThanOrEqual(2);
  });
});

// M11: Leopard's Concealment Zones change what both AIs see; every matchup must still play cleanly to the end.
describe('AI against AI on Leopard', { timeout: 180_000 }, () => {
  it('plays every matchup at every difficulty to the end with only accepted commands', async () => {
    const result = await loadStageDirectory(
      resolve(import.meta.dirname, '../../../content/stages/stage-01-big-five'),
    );
    if (!result.ok) throw new Error(result.issues.map((i) => i.message).join('\n'));
    const pack = result.pack;
    for (const attackerProfileId of pack.manifest.profiles.attacker)
      for (const defenderProfileId of pack.manifest.profiles.defender)
        for (const difficulty of DIFFICULTIES) {
          const setupFor = (seed: number) =>
            createMatchSetup(pack, { levelId: 'leopard', attackerProfileId, defenderProfileId, seed });
          const report = runBalance(setupFor, difficulty, difficulty, 1);
          const label = `${attackerProfileId} vs ${defenderProfileId} at ${difficulty}`;
          expect(report.failures, label).toBe(0);
          expect(report.rejectedCommands, label).toBe(0);
        }
  });

  it('lets both sides win at medium in the Explorer vs Ranger matchup', async () => {
    const result = await loadStageDirectory(
      resolve(import.meta.dirname, '../../../content/stages/stage-01-big-five'),
    );
    if (!result.ok) throw new Error(result.issues.map((i) => i.message).join('\n'));
    const pack = result.pack;
    const setupFor = (seed: number) =>
      createMatchSetup(pack, {
        levelId: 'leopard',
        attackerProfileId: 'explorer',
        defenderProfileId: 'ranger',
        seed,
      });
    const report = runBalance(setupFor, 'medium', 'medium', 12);
    expect(report.attackerWins).toBeGreaterThan(0);
    expect(report.defenderWins).toBeGreaterThan(0);
  });
});

// M12: Elephant's Terrain Weight and Route Capacity change how both AIs plan; every matchup must still play cleanly.
describe('AI against AI on Elephant', { timeout: 180_000 }, () => {
  it('plays every matchup at every difficulty to the end with only accepted commands', async () => {
    const result = await loadStageDirectory(
      resolve(import.meta.dirname, '../../../content/stages/stage-01-big-five'),
    );
    if (!result.ok) throw new Error(result.issues.map((i) => i.message).join('\n'));
    const pack = result.pack;
    for (const attackerProfileId of pack.manifest.profiles.attacker)
      for (const defenderProfileId of pack.manifest.profiles.defender)
        for (const difficulty of DIFFICULTIES) {
          const setupFor = (seed: number) =>
            createMatchSetup(pack, { levelId: 'elephant', attackerProfileId, defenderProfileId, seed });
          const report = runBalance(setupFor, difficulty, difficulty, 1);
          const label = `${attackerProfileId} vs ${defenderProfileId} at ${difficulty}`;
          expect(report.failures, label).toBe(0);
          expect(report.rejectedCommands, label).toBe(0);
        }
  });

  it('lets both sides win at medium in the Explorer vs Ranger matchup', async () => {
    const result = await loadStageDirectory(
      resolve(import.meta.dirname, '../../../content/stages/stage-01-big-five'),
    );
    if (!result.ok) throw new Error(result.issues.map((i) => i.message).join('\n'));
    const pack = result.pack;
    const setupFor = (seed: number) =>
      createMatchSetup(pack, {
        levelId: 'elephant',
        attackerProfileId: 'explorer',
        defenderProfileId: 'ranger',
        seed,
      });
    const report = runBalance(setupFor, 'medium', 'medium', 12);
    expect(report.attackerWins).toBeGreaterThan(0);
    expect(report.defenderWins).toBeGreaterThan(0);
  });
});
