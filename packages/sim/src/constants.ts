/** The simulation always advances in fixed steps, independent of frame rate or network timing. */
export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
export const TICK_SECONDS = 1 / TICK_RATE;

export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICK_RATE);
}
