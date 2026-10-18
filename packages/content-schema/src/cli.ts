#!/usr/bin/env node
/**
 * Validates every stage pack in a folder.
 * Usage: gtd-validate-content [stagesRoot]   (default: content/stages)
 * Exits with code 1 when any pack has a problem, so CI fails on broken content.
 */
import { resolve } from 'node:path';
import { loadAllStages } from './node';

const root = resolve(process.argv[2] ?? 'content/stages');
const report = await loadAllStages(root);

for (const stage of report.stages) {
  const { manifest, levels, profiles } = stage;
  console.log(
    `✓ ${manifest.id}: ${levels.length} level(s), ${manifest.profiles.attacker.length} attacker and ` +
      `${manifest.profiles.defender.length} defender profile(s), ${profiles.length} profile file(s)`,
  );
}
for (const line of [...report.errors, ...report.warnings]) console.error(`✗ ${line}`);

const problems = report.errors.length + report.warnings.length;
console.log(
  problems === 0 ? `All ${report.stages.length} stage pack(s) are valid.` : `${problems} problem(s) found.`,
);
process.exit(problems === 0 ? 0 : 1);
