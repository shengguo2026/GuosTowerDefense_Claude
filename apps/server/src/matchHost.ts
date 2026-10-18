import { SNAPSHOT_EVERY_TICKS } from '@gtd/protocol';
import { FixedStepClock, Match, TICK_MS, type Command, type MatchSetup } from '@gtd/sim';
import type { Controller } from '@gtd/ai';

export interface MatchHostOptions {
  setup: MatchSetup;
  attacker?: Controller;
  defender?: Controller;
  /** Called at the snapshot rate (and once at the start and end); the owner decides who sees which view. */
  onFrame(match: Match): void;
  onEnd?(): void;
  snapshotEveryTicks?: number;
  /** Injectable for tests. */
  now?: () => number;
}

/**
 * Runs one authoritative match in real time on the server: 20 ticks per second, controllers' and players' commands
 * applied before each tick, frames sent at a fixed rate.
 */
export class MatchHost {
  readonly match: Match;
  private readonly clock = new FixedStepClock();
  private timer: NodeJS.Timeout | undefined;
  private last = 0;
  private readonly now: () => number;
  /** A paused match keeps its timer running (for snapshots) but runs no ticks. */
  paused = false;
  /** 1× or 2×: how many simulation seconds pass per real second. */
  speed: 1 | 2 = 1;

  constructor(private readonly options: MatchHostOptions) {
    this.match = new Match(options.setup);
    this.now = options.now ?? (() => performance.now());
  }

  start(): void {
    this.last = this.now();
    this.options.onFrame(this.match);
    this.timer = setInterval(() => this.advance(), TICK_MS / 2);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Queues a player's command for the next tick (its own tick is ignored). */
  submit(command: Command): void {
    this.match.enqueue({ ...command, tick: this.match.tick + 1 });
  }

  get running(): boolean {
    return this.timer !== undefined;
  }

  /** Runs the ticks that are due; public so tests can drive time by hand. */
  advance(): void {
    const now = this.now();
    const elapsed = now - this.last;
    this.last = now;
    if (this.paused) return;
    const steps = this.clock.advance(elapsed * this.speed);
    const every = this.options.snapshotEveryTicks ?? SNAPSHOT_EVERY_TICKS;
    for (let i = 0; i < steps && !this.match.isOver; i++) this.tick(every);
  }

  private tick(every: number): void {
    const { setup, attacker, defender } = this.options;
    const commands = [
      ...(attacker?.decide(this.match.snapshot('attacker'), setup) ?? []),
      ...(defender?.decide(this.match.snapshot('defender'), setup) ?? []),
    ];
    for (const command of commands) this.match.enqueue({ ...command, tick: this.match.tick + 1 });
    this.match.step();
    if (this.match.tick % every === 0 || this.match.isOver) this.options.onFrame(this.match);
    if (this.match.isOver) {
      this.stop();
      this.options.onEnd?.();
    }
  }
}
