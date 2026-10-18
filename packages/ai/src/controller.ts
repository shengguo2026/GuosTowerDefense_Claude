import type { Command, MatchSetup, MatchSnapshot, Side } from '@gtd/sim';

/**
 * Something that looks at the match from one side and issues commands for it: the AI, or a scripted bot in tests. It
 * receives that side's view, so it never sees more than a human player would.
 */
export interface Controller {
  decide(snapshot: MatchSnapshot, setup: MatchSetup): Command[];
}

export const idleController: Controller = { decide: () => [] };

/** One round of AI reasoning, for the developer view: what it saw, weighed and chose. */
export interface AiThought {
  tick: number;
  side: Side;
  lines: string[];
}
