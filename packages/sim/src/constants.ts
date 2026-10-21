/** The simulation always advances in fixed steps, independent of frame rate or network timing. */
export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
export const TICK_SECONDS = 1 / TICK_RATE;

export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICK_RATE);
}

/** Formations trade speed against how easily the group is detected and how much pressure it takes. */
export const FORMATIONS = {
  column: { speed: 1, detection: 0.85, pressureTaken: 1.15 },
  spread: { speed: 0.95, detection: 1.15, pressureTaken: 0.8 },
} as const;

/** Factor on the distance at which a unit of each visibility type is detected. */
export const VISIBILITY_FACTORS = { normal: 1, concealed: 0.7, stealth: 0.4 } as const;

/** A detected group becomes Identified (type and size known) after this long in detection. */
export const IDENTIFY_SECONDS = 2;
/** A group out of every detection range for this long goes back to Unknown. */
export const LOSE_DETECTION_SECONDS = 3;
/** Distance at which a group stops in front of a roadblock. */
export const BLOCK_STANDOFF = 2;
/** Per upgrade level above 1: reach and detection grow by this share, pressure by the next. */
export const UPGRADE_RANGE_BONUS = 0.15;
export const UPGRADE_PRESSURE_BONUS = 0.25;
/** Selling refunds this share of everything spent on the asset. */
export const SELL_REFUND = 0.5;
/** Repairing from 0 to 100 condition costs this share of the asset's build cost. */
export const REPAIR_COST_SHARE = 0.5;
/** Each group's speed varies by up to this share (seeded), so groups launched together spread out a little. */
export const SPEED_VARIATION = 0.05;
export const MAX_GROUPS_PER_WAVE = 4;
export const MAX_LAUNCH_DELAY_SECONDS = 30;
/** Default strength of a boost or slow ability that gives no magnitude. */
export const DEFAULT_EFFECT_MAGNITUDE = 0.3;
/** Hold progress per tick while a Defender patrol is inside the objective zone. */
export const CONTESTED_HOLD_RATE = 0.5;
/** How close a group must be to a defense to work on it (Focus Defense). */
export const DISMANTLE_REACH = 8;
/** Width of the band along a route that a route-wide effect covers, for things standing beside the route. */
export const ROUTE_EFFECT_REACH = 6;
/** Radius of a junction-target effect that gives no range. */
export const JUNCTION_EFFECT_REACH = 6;
/** Default strength of `conceal` (detection distance lost) and `protect` (pressure or wear taken off). */
export const DEFAULT_CONCEAL = 0.5;
export const DEFAULT_PROTECT = 0.4;
