/**
 * Plays headless matches of every level and profile pairing of a stage with the scripted controllers.
 * Usage: npm run simulate -- [stageId] [seed]
 */
import { resolve } from 'node:path';
import { createMatchSetup } from '@gtd/content-schema';
import { loadAllStages } from '@gtd/content-schema/node';
import { scriptedAttacker, scriptedDefender } from './controllers';
import { runHeadlessMatch } from './runHeadlessMatch';

const [stageId = 'test-stage', seedText = '1'] = process.argv.slice(2);
const report = await loadAllStages(resolve(import.meta.dirname, '../../../content/stages'));
const pack = report.stages.find((stage) => stage.manifest.id === stageId);
if (!pack) {
  console.error(`Stage "${stageId}" not found or not valid.`);
  process.exit(1);
}

for (const level of pack.levels) {
  for (const attackerProfileId of pack.manifest.profiles.attacker) {
    for (const defenderProfileId of pack.manifest.profiles.defender) {
      const setup = createMatchSetup(pack, {
        levelId: level.id,
        attackerProfileId,
        defenderProfileId,
        seed: Number(seedText),
      });
      const run = runHeadlessMatch(setup, { attacker: scriptedAttacker(), defender: scriptedDefender() });
      const outcome = run.result ? `${run.result.winner} (${run.result.reason})` : 'no result';
      console.log(
        `${level.id.padEnd(10)} ${attackerProfileId} vs ${defenderProfileId}: ${outcome} after ${run.ticks} ticks`,
      );
    }
  }
}
