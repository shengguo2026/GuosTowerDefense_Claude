import type { Difficulty } from '@gtd/ai';
import type { Side } from '@gtd/sim';

/** Everything a single-player match is started with (spec §6.1). */
export interface MatchConfig {
  stageId: string;
  levelId: string;
  /** The side the person plays; the computer plays the other one. */
  side: Side;
  attackerProfileId: string;
  defenderProfileId: string;
  difficulty: Difficulty;
  /** Guided tutorial: Chief Warden Guo explains each step and the match waits while he talks. */
  tutorial: boolean;
  /** Developer view of the computer's reasoning. */
  showAiReasoning: boolean;
}

export function otherSide(side: Side): Side {
  return side === 'attacker' ? 'defender' : 'attacker';
}

/** Everything a hot-seat match is started with (spec §6.1): the Attacker plays with the keyboard, the Defender with the mouse. */
export interface HotSeatConfig {
  stageId: string;
  levelId: string;
  attackerProfileId: string;
  defenderProfileId: string;
  names: Record<Side, string>;
}
