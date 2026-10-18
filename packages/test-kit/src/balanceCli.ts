/**
 * AI-vs-AI balance runs: many headless matches per difficulty pairing, each with its own seed.
 * Usage: npm run balance -- [matches=200] [stageId=stage-01-big-five] [levelId=lion] [--matrix] [--check]
 * Without --matrix only equal difficulties are played (Easy vs Easy, Medium vs Medium, Hard vs Hard).
 * With --check the command fails when a match crashes or never ends, the AI sends a command the rules refuse, or one
 * side wins more than 70% at equal difficulty (the M3 balance gate).
 */
import { resolve } from 'node:path';
import { DIFFICULTIES } from '@gtd/ai';
import { createMatchSetup } from '@gtd/content-schema';
import { loadAllStages } from '@gtd/content-schema/node';
import { formatBalance, runBalance, type BalanceReport } from './balance';

const args = process.argv.slice(2);
const matrix = args.includes('--matrix');
const check = args.includes('--check');
const [matchesText = '200', stageId = 'stage-01-big-five', levelId = 'lion'] = args.filter(
  (a) => !a.startsWith('--'),
);
const report = await loadAllStages(resolve(import.meta.dirname, '../../../content/stages'));
const pack = report.stages.find((stage) => stage.manifest.id === stageId);
if (!pack) {
  console.error(`Stage "${stageId}" not found or not valid.`);
  process.exit(1);
}
const attackerProfileId = pack.manifest.profiles.attacker[0] as string;
const defenderProfileId = pack.manifest.profiles.defender[0] as string;
const setupFor = (seed: number) =>
  createMatchSetup(pack, { levelId, attackerProfileId, defenderProfileId, seed });

console.log(`${stageId} / ${levelId}: ${attackerProfileId} vs ${defenderProfileId}`);
const problems: string[] = [];
for (const attacker of DIFFICULTIES)
  for (const defender of DIFFICULTIES) {
    if (!matrix && attacker !== defender) continue;
    const result = runBalance(setupFor, attacker, defender, Number(matchesText));
    console.log(formatBalance(result));
    problems.push(...balanceProblems(result));
  }
if (check && problems.length > 0) {
  console.error(problems.map((p) => `FAIL ${p}`).join('\n'));
  process.exit(1);
}

function balanceProblems(result: BalanceReport): string[] {
  const label = `${result.attacker} vs ${result.defender}`;
  const out: string[] = [];
  if (result.failures > 0) out.push(`${label}: ${result.failures} matches crashed or never ended`);
  if (result.rejectedCommands > 0) out.push(`${label}: ${result.rejectedCommands} AI commands were refused`);
  const top = Math.max(result.attackerWins, result.defenderWins) / result.matches;
  if (result.attacker === result.defender && top > 0.7)
    out.push(`${label}: one side wins ${Math.round(top * 100)}% (limit 70%)`);
  return out;
}
