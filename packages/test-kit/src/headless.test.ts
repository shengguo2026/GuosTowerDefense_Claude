import { resolve } from 'node:path';
import { createMatchSetup } from '@gtd/content-schema';
import { loadStageDirectory } from '@gtd/content-schema/node';
import { describe, expect, it } from 'vitest';
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
          expect(run.ticks).toBeLessThanOrEqual(level.timerSeconds * 20);
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
