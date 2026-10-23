import type { Level } from '@gtd/content-schema';
import type { Translate } from '@gtd/i18n';
import type { GroupEntity, Point } from '@gtd/sim';
import { distanceToPath, type Point2 } from '../world/paths';

type Edge = Level['map']['edges'][number];

/** Kinds of ground an area hint can name besides vision areas: heavy ground, or a narrow crossing (Route Capacity). */
export type GroundKind = 'mud' | 'water' | 'crossing';

function matches(edge: Edge, kind: string): boolean {
  return kind === 'crossing' ? edge.capacity !== undefined : edge.terrain === kind;
}

function edgeBetween(level: Level, a: string, b: string): Edge | undefined {
  return level.map.edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
}

/** The path of one map edge, from its first node through its bend points to its second. */
export function edgePath(level: Level, edge: Edge): Point2[] {
  const from = level.map.nodes.find((n) => n.id === edge.from);
  const to = level.map.nodes.find((n) => n.id === edge.to);
  if (!from || !to) return [];
  return [{ x: from.x, z: from.z }, ...(edge.via ?? []).map(([x, z]) => ({ x, z })), { x: to.x, z: to.z }];
}

/** The map edge a group is walking along (from the node it last passed to the next one). */
export function edgeOfGroup(level: Level, group: Pick<GroupEntity, 'routeId' | 'leg'>): Edge | undefined {
  const route = level.routes.find((r) => r.id === group.routeId);
  const from = route?.nodes[group.leg];
  const to = route?.nodes[group.leg + 1];
  return from && to ? edgeBetween(level, from, to) : undefined;
}

/** A group walks on this kind of ground (or on a narrow crossing). */
export function groupOnGround(level: Level, kind: string, group: GroupEntity): boolean {
  if (group.state === 'waiting') return false;
  const edge = edgeOfGroup(level, group);
  return edge !== undefined && matches(edge, kind);
}

/** A spot within `reach` of a stretch of this kind of ground (a structure that covers a crossing). */
export function nearGround(level: Level, kind: string, at: Point, reach: number): boolean {
  return level.map.edges.some(
    (edge) => matches(edge, kind) && distanceToPath(at.x, at.z, edgePath(level, edge)) <= reach,
  );
}

/**
 * What a route goes through, in words, for the route chips: heavy ground (Terrain Weight), narrow crossings with how
 * much they hold (Route Capacity) and ambush thickets (Ambush Zones). Empty on routes over plain open ground and cover.
 */
export function routeNotes(level: Level, routeId: string, t: Translate, stageText: Translate): string[] {
  const route = level.routes.find((r) => r.id === routeId);
  if (!route) return [];
  const notes: string[] = [];
  const seen = new Set<string>();
  route.nodes.forEach((id, i) => {
    const next = route.nodes[i + 1];
    const edge = next ? edgeBetween(level, id, next) : undefined;
    if (!edge) return;
    if ((edge.terrain === 'mud' || edge.terrain === 'water') && !seen.has(edge.terrain)) {
      seen.add(edge.terrain);
      notes.push(t(`ground.${edge.terrain}`));
    }
    if (edge.capacity !== undefined)
      notes.push(
        t('ground.crossing', {
          name: edge.label ? stageText(edge.label) : t('ground.crossingName'),
          capacity: edge.capacity,
        }),
      );
  });
  // Ambush Zones (Rhinoceros): thickets the route runs through, where Defender assets may wait unseen.
  const path = route.nodes.flatMap((id, i) => {
    const next = route.nodes[i + 1];
    const edge = next ? edgeBetween(level, id, next) : undefined;
    return edge ? edgePath(level, edge) : [];
  });
  const thickets = level.vision.filter(
    (area) =>
      area.ambush && area.circle && distanceToPath(area.circle.x, area.circle.z, path) <= area.circle.radius,
  ).length;
  if (thickets > 0) notes.push(t('ground.ambush', { count: thickets }));
  return notes;
}

/** The level has heavy ground, so a unit's weight matters (Terrain Weight). */
export function hasHeavyGround(level: Level): boolean {
  return level.map.edges.some((edge) => edge.terrain === 'mud' || edge.terrain === 'water');
}

/** The narrowest crossing on a route (Route Capacity), or null when it has none. */
export function narrowestCrossing(
  level: Level,
  routeId: string,
): { capacity: number; label?: string } | null {
  const route = level.routes.find((r) => r.id === routeId);
  if (!route) return null;
  let narrow: { capacity: number; label?: string } | null = null;
  route.nodes.forEach((id, i) => {
    const next = route.nodes[i + 1];
    const edge = next ? edgeBetween(level, id, next) : undefined;
    if (edge?.capacity !== undefined && (narrow === null || edge.capacity < narrow.capacity))
      narrow = { capacity: edge.capacity, ...(edge.label ? { label: edge.label } : {}) };
  });
  return narrow;
}
