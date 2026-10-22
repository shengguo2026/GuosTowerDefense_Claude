/**
 * AI-vs-AI balance runs: many headless matches per profile matchup and difficulty pairing, each with its own seed.
 * Usage: npm run balance -- [matches=200] [stageId=stage-01-big-five] [levelId=lion] [--matrix] [--all] [--check]
 *   [--attacker=<profileId>] [--defender=<profileId>]
 * Without --all only the stage's first profile of each side is played (Explorer vs Ranger); --all plays every
 * attacker × defender matchup, --attacker / --defender pick one profile. Without --matrix only equal difficulties are
 * played (Easy vs Easy, Medium vs Medium, Hard vs Hard).
 * With --check the command fails when a match crashes or never ends, the AI sends a command the rules refuse, or one
 * side wins more than 70% at equal difficulty in any matchup (the M3 and M8 balance gate).
 */
import { resolve } from 'node:path';
import { DIFFICULTIES } from '@gtd/ai';
import { createMatchSetup } from '@gtd/content-schema';
import { loadAllStages } from '@gtd/content-schema/node';
import { formatBalance, runBalance, type BalanceReport } from './balance';

const args = process.argv.slice(2);
const matrix = args.includes('--matrix');
const all = args.includes('--all');
const check = args.includes('--check');
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const [matchesText = '200', stageId = 'stage-01-big-five', levelId = 'lion'] = args.filter(
  (a) => !a.startsWith('--'),
);
const report = await loadAllStages(resolve(import.meta.dirname, '../../../content/stages'));
const pack = report.stages.find((stage) => stage.manifest.id === stageId);
if (!pack) {
  console.error(`Stage "${stageId}" not found or not valid.`);
  process.exit(1);
}
const pick = (side: 'attacker' | 'defender'): string[] => {
  const chosen = option(side);
  const profiles = pack.manifest.profiles[side];
  if (chosen) return [chosen];
  return all ? profiles : profiles.slice(0, 1);
};

const problems: string[] = [];
const summary: string[] = [];
for (const attackerProfileId of pick('attacker'))
  for (const defenderProfileId of pick('defender')) {
    const matchup = `${attackerProfileId} vs ${defenderProfileId}`;
    console.log(`${stageId} / ${levelId}: ${matchup}`);
    const setupFor = (seed: number) =>
      createMatchSetup(pack, { levelId, attackerProfileId, defenderProfileId, seed });
    const rates: string[] = [];
    for (const attacker of DIFFICULTIES)
      for (const defender of DIFFICULTIES) {
        if (!matrix && attacker !== defender) continue;
        const result = runBalance(setupFor, attacker, defender, Number(matchesText));
        console.log(formatBalance(result));
        problems.push(...balanceProblems(matchup, result));
        if (attacker === defender)
          rates.push(`${Math.round((result.attackerWins / Math.max(1, result.matches)) * 100)}%`);
      }
    summary.push(`${matchup.padEnd(36)} attacker wins ${rates.join(' / ')}`);
  }
if (summary.length > 1) console.log(`\nAttacker wins at Easy / Medium / Hard:\n${summary.join('\n')}`);
if (check && problems.length > 0) {
  console.error(problems.map((p) => `FAIL ${p}`).join('\n'));
  process.exit(1);
}

function balanceProblems(matchup: string, result: BalanceReport): string[] {
  const label = `${matchup}, ${result.attacker} vs ${result.defender}`;
  const out: string[] = [];
  if (result.failures > 0) out.push(`${label}: ${result.failures} matches crashed or never ended`);
  if (result.rejectedCommands > 0) out.push(`${label}: ${result.rejectedCommands} AI commands were refused`);
  const top = Math.max(result.attackerWins, result.defenderWins) / result.matches;
  if (result.attacker === result.defender && top > 0.7)
    out.push(`${label}: one side wins ${Math.round(top * 100)}% (limit 70%)`);
  return out;
}
