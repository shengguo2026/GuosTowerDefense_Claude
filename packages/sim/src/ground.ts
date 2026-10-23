import type { SimLevel, SimUnitType, Terrain, TerrainModifiers, UnitWeight } from './types';

/**
 * Terrain Weight and Route Capacity (Elephant). Heavy ground slows units by how heavy they are; a narrow crossing holds
 * only so much at once, and groups packed on it are slower, move as a column and take more pressure.
 */

/** Slowest a full crossing makes the groups on it (share of their speed). */
export const CROWD_MIN_SPEED = 0.35;
/** Extra pressure a group takes while packed on a full crossing. */
export const CROWD_PRESSURE_TAKEN = 0.3;
/** Share of the pressure on one group packed on a full crossing that the other groups packed there take too. */
export const CROWD_SPLASH = 0.4;

/** A unit's weight class: set in the catalog, else from its capacity (1 light, 2 medium, 3 or more heavy). */
export function unitWeight(unit: Pick<SimUnitType, 'weight' | 'capacity'>): UnitWeight {
  if (unit.weight) return unit.weight;
  return unit.capacity >= 3 ? 'heavy' : unit.capacity >= 2 ? 'medium' : 'light';
}

/** The level's numbers for a kind of ground; heavy ground a level leaves out counts as cover. */
export function groundOf(level: Pick<SimLevel, 'terrain'>, terrain: Terrain): TerrainModifiers {
  return level.terrain[terrain] ?? level.terrain.cover;
}

/** Speed factor of the ground for a unit: the ground's own factor times its Terrain Weight factor for the unit. */
export function groundSpeed(
  ground: TerrainModifiers,
  unit: Pick<SimUnitType, 'weight' | 'capacity'>,
): number {
  return ground.speed * (ground.weight?.[unitWeight(unit)] ?? 1);
}

/** How full a crossing is: its load over its capacity (above 1, the groups on it are packed). */
export function crowding(load: number, capacity: number): number {
  return capacity > 0 ? load / capacity : 0;
}

/** Speed factor on a crossing at this crowding: full speed up to its capacity, then slower the more it is packed. */
export function crowdSpeed(crowd: number): number {
  return crowd > 1 ? Math.max(CROWD_MIN_SPEED, 1 / crowd) : 1;
}
