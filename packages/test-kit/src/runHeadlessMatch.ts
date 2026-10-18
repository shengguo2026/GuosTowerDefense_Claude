import {
  Match,
  hashValue,
  type MatchEvent,
  type MatchResult,
  type MatchSetup,
  type SideStats,
} from '@gtd/sim';
import { idleController, type Controller } from './controllers';

export interface HeadlessMatchOptions {
  attacker?: Controller;
  defender?: Controller;
  /** Safety stop so a broken rule can never hang a test. */
  maxTicks?: number;
}

export interface HeadlessMatchReport {
  result: MatchResult | null;
  ticks: number;
  events: readonly MatchEvent[];
  stats: SideStats;
  /** Hash of the full event log; equal hashes mean identical matches. */
  hash: string;
}

/** Runs a whole match as fast as possible, without a server, clock or renderer. */
export function runHeadlessMatch(setup: MatchSetup, options: HeadlessMatchOptions = {}): HeadlessMatchReport {
  const { attacker = idleController, defender = idleController, maxTicks = 100_000 } = options;
  const match = new Match(setup);
  while (!match.isOver && match.tick < maxTicks) {
    const commands = [
      ...attacker.decide(match.snapshot('attacker'), setup),
      ...defender.decide(match.snapshot('defender'), setup),
    ];
    for (const command of commands) {
      match.enqueue({ ...command, tick: match.tick + 1 });
    }
    match.step();
  }
  return {
    result: match.result,
    ticks: match.tick,
    events: match.events.all(),
    stats: match.snapshot().stats,
    hash: hashValue(match.events.all()),
  };
}
