import { SNAPSHOT_EVERY_TICKS } from '@gtd/protocol';
import { FixedStepClock, Match, TICK_MS, type MatchSetup, type MatchSnapshot } from '@gtd/sim';
import type { Controller } from '@gtd/test-kit';

export interface MatchHostOptions {
  setup: MatchSetup;
  attacker: Controller;
  defender: Controller;
  onSnapshot(snapshot: MatchSnapshot): void;
  onEnd?(): void;
  snapshotEveryTicks?: number;
  /** Injectable for tests. */
  now?: () => number;
}

/**
 * Runs one authoritative match in real time on the server: 20 ticks per second, controllers' commands applied before
 * each tick, snapshots sent at a fixed rate.
 */
export class MatchHost {
  readonly match: Match;
  private readonly clock = new FixedStepClock();
  private timer: NodeJS.Timeout | undefined;
  private last = 0;
  private readonly now: () => number;

  constructor(private readonly options: MatchHostOptions) {
    this.match = new Match(options.setup);
    this.now = options.now ?? (() => performance.now());
  }

  start(): void {
    this.last = this.now();
    this.options.onSnapshot(this.match.snapshot());
    this.timer = setInterval(() => this.advance(), TICK_MS / 2);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Runs the ticks that are due; public so tests can drive time by hand. */
  advance(): void {
    const now = this.now();
    const steps = this.clock.advance(now - this.last);
    this.last = now;
    const every = this.options.snapshotEveryTicks ?? SNAPSHOT_EVERY_TICKS;
    for (let i = 0; i < steps && !this.match.isOver; i++) this.tick(every);
  }

  private tick(every: number): void {
    const { setup, attacker, defender } = this.options;
    const snapshot = this.match.snapshot();
    for (const command of [...attacker.decide(snapshot, setup), ...defender.decide(snapshot, setup)]) {
      this.match.enqueue({ ...command, tick: this.match.tick + 1 });
    }
    this.match.step();
    if (this.match.tick % every === 0 || this.match.isOver) this.options.onSnapshot(this.match.snapshot());
    if (this.match.isOver) {
      this.stop();
      this.options.onEnd?.();
    }
  }
}
