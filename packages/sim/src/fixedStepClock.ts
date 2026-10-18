import { TICK_MS } from './constants';

/**
 * Turns real elapsed time into a whole number of simulation ticks. The remainder is kept for the next call, and the
 * client uses `alpha` to interpolate between the last two snapshots.
 */
export class FixedStepClock {
  private accumulatorMs = 0;

  constructor(
    private readonly stepMs = TICK_MS,
    /** Caps catch-up after a long stall (e.g. a sleeping laptop) so the server never runs thousands of ticks at once. */
    private readonly maxStepsPerAdvance = 10,
  ) {}

  /** Returns how many ticks to run for `elapsedMs` of real time. */
  advance(elapsedMs: number): number {
    this.accumulatorMs += Math.max(0, elapsedMs);
    let steps = Math.floor(this.accumulatorMs / this.stepMs);
    if (steps > this.maxStepsPerAdvance) {
      steps = this.maxStepsPerAdvance;
      this.accumulatorMs = 0;
    } else {
      this.accumulatorMs -= steps * this.stepMs;
    }
    return steps;
  }

  /** Fraction of the way to the next tick, in [0, 1). */
  get alpha(): number {
    return this.accumulatorMs / this.stepMs;
  }

  reset(): void {
    this.accumulatorMs = 0;
  }
}
