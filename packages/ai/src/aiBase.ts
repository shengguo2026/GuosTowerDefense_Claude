import { Rng, type Command, type MatchSetup, type MatchSnapshot, type Side } from '@gtd/sim';
import type { AiThought, Controller } from './controller';
import type { Difficulty } from './difficulty';
import { LevelModel } from './levelModel';

const KEPT_THOUGHTS = 30;

/**
 * Shared frame of both AIs: it looks at the match only every few ticks (its reaction time), builds its picture of the
 * level once, and records what it was thinking each time it looked, for the developer view.
 */
export abstract class AiBase implements Controller {
  readonly thoughts: AiThought[] = [];
  /** Called with every round of reasoning (the server forwards them to a developer view). */
  onThought?: (thought: AiThought) => void;
  protected readonly rng: Rng;
  protected model!: LevelModel;
  private nextThink = 0;
  private lines: string[] = [];

  constructor(
    readonly side: Side,
    readonly difficulty: Difficulty,
    seed: number,
    private readonly thinkEveryTicks: number,
  ) {
    this.rng = new Rng(seed).fork(`ai-${side}`);
  }

  decide(snapshot: MatchSnapshot, setup: MatchSetup): Command[] {
    if (snapshot.phase === 'ended' || snapshot.tick < this.nextThink) return [];
    this.model ??= new LevelModel(setup);
    this.nextThink = snapshot.tick + this.thinkEveryTicks;
    this.lines = [];
    const commands = this.think(snapshot);
    const last = this.thoughts.at(-1);
    const repeat = last !== undefined && last.lines.join('\n') === this.lines.join('\n');
    if (this.lines.length > 0 && !repeat) {
      const thought: AiThought = { tick: snapshot.tick, side: this.side, lines: this.lines };
      this.thoughts.push(thought);
      if (this.thoughts.length > KEPT_THOUGHTS) this.thoughts.shift();
      this.onThought?.(thought);
    }
    return commands;
  }

  protected abstract think(snapshot: MatchSnapshot): Command[];

  /** Adds a line to this round's reasoning (a round that only repeats the last one is not recorded again). */
  protected note(line: string): void {
    this.lines.push(line);
  }

  /** True with the difficulty's chance of a plainly worse choice. */
  protected slips(chance: number): boolean {
    return chance > 0 && this.rng.next() < chance;
  }
}

export function round(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '∞';
}
