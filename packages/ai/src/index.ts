import type { Side } from '@gtd/sim';
import type { AiBase } from './aiBase';
import { AttackerAi } from './attackerAi';
import { DefenderAi } from './defenderAi';
import type { Difficulty } from './difficulty';

export * from './controller';
export * from './difficulty';
export * from './levelModel';
export { AiBase } from './aiBase';
export { AttackerAi } from './attackerAi';
export { DefenderAi } from './defenderAi';

/** An AI player for one side. Give each match its own instance: it remembers what it has seen. */
export function createAi(side: Side, difficulty: Difficulty, seed: number): AiBase {
  return side === 'attacker' ? new AttackerAi(difficulty, seed) : new DefenderAi(difficulty, seed);
}
