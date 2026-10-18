import { createAi, type Difficulty } from '@gtd/ai';
import type { MatchEndReason, MatchSetup } from '@gtd/sim';
import { runHeadlessMatch } from './runHeadlessMatch';

export interface BalanceReport {
  attacker: Difficulty;
  defender: Difficulty;
  matches: number;
  attackerWins: number;
  defenderWins: number;
  /** Matches that threw or never ended. */
  failures: number;
  reasons: Partial<Record<MatchEndReason, number>>;
  /** Commands the rules refused, over all matches (the AI should only send legal ones). */
  rejectedCommands: number;
  averageSeconds: number;
  /** Average best objective progress, 0–1. */
  averageObjective: number;
}

/**
 * Plays many AI-vs-AI matches headless, each with its own seed, and sums up who won and how. Used by the balance
 * command and the balance tests.
 */
export function runBalance(
  setupFor: (seed: number) => MatchSetup,
  attacker: Difficulty,
  defender: Difficulty,
  matches: number,
  firstSeed = 1,
): BalanceReport {
  const report: BalanceReport = {
    attacker,
    defender,
    matches,
    attackerWins: 0,
    defenderWins: 0,
    failures: 0,
    reasons: {},
    rejectedCommands: 0,
    averageSeconds: 0,
    averageObjective: 0,
  };
  let ticks = 0;
  let objective = 0;
  for (let i = 0; i < matches; i++) {
    const seed = firstSeed + i;
    const setup = setupFor(seed);
    try {
      const run = runHeadlessMatch(setup, {
        attacker: createAi('attacker', attacker, seed * 2 + 1),
        defender: createAi('defender', defender, seed * 2 + 2),
      });
      if (!run.result) {
        report.failures++;
        continue;
      }
      if (run.result.winner === 'attacker') report.attackerWins++;
      else report.defenderWins++;
      report.reasons[run.result.reason] = (report.reasons[run.result.reason] ?? 0) + 1;
      report.rejectedCommands += run.events.filter((e) => e.type === 'commandRejected').length;
      ticks += run.ticks;
      objective += run.stats.attacker.bestObjectiveProgress;
    } catch {
      report.failures++;
    }
  }
  const played = Math.max(1, matches - report.failures);
  report.averageSeconds = ticks / played / 20;
  report.averageObjective = objective / played;
  return report;
}

export function formatBalance(report: BalanceReport): string {
  const pct = (n: number) => `${Math.round((n / Math.max(1, report.matches)) * 100)}%`.padStart(4);
  const reasons = Object.entries(report.reasons)
    .map(([reason, count]) => `${reason} ${count}`)
    .join(', ');
  return (
    `${report.attacker.padEnd(6)} vs ${report.defender.padEnd(6)} ${String(report.matches).padStart(4)} matches: ` +
    `attacker ${pct(report.attackerWins)}, defender ${pct(report.defenderWins)}, failures ${report.failures}, ` +
    `rejected ${report.rejectedCommands}, ${Math.round(report.averageSeconds)} s avg, ` +
    `objective ${Math.round(report.averageObjective * 100)}% avg (${reasons})`
  );
}
