import { toVisionArea, type Catalog, type Level } from '@gtd/content-schema';
import { UPGRADE_RANGE_BONUS, VisionField, type Point } from '@gtd/sim';
import type { MapOverlay } from '../world/selectionView';

const fields = new WeakMap<Level, VisionField>();

/** The level's line of sight, built once per level. */
export function visionOf(level: Level): VisionField {
  let field = fields.get(level);
  if (!field) {
    field = new VisionField(level.vision.map(toVisionArea));
    fields.set(level, field);
  }
  return field;
}

/**
 * What a structure at `at` would see on a level with Concealment Zones: its detection reach (further from a ledge),
 * cut short by rock walls and brush. Null on open levels and for mobile assets, where the plain reach ring says it all.
 */
export function structureViewArea(
  level: Level,
  type: Catalog['defenses'][number] | undefined,
  at: Point,
  upgradeLevel = 1,
): MapOverlay['viewArea'] {
  if (!type || type.mobile || level.vision.length === 0) return null;
  const vision = visionOf(level);
  const range =
    (type.detectionRange ?? type.range) *
    (1 + UPGRADE_RANGE_BONUS * (upgradeLevel - 1)) *
    vision.vantageAt(at);
  return { origin: { x: at.x, z: at.z }, edge: vision.viewShape(at, range) };
}
