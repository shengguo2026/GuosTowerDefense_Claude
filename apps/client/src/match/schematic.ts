import type { Level } from '@gtd/content-schema';
import type { GroupEntity } from '@gtd/sim';

export type CursorDirection = 'up' | 'down' | 'left' | 'right';

/** Screen directions on the schematic, which is drawn like the minimap: x to the right, z downwards. */
const VECTORS: Record<CursorDirection, { x: number; z: number }> = {
  up: { x: 0, z: -1 },
  down: { x: 0, z: 1 },
  left: { x: -1, z: 0 },
  right: { x: 1, z: 0 },
};

/** Route-graph nodes the junction cursor can stand on (spec §5.2): every node some route passes. */
export function cursorNodes(level: Level): Level['map']['nodes'] {
  const onRoute = new Set(level.routes.flatMap((r) => r.nodes));
  return level.map.nodes.filter((n) => onRoute.has(n.id));
}

/** Where the cursor starts: the first junction routes share, else the first spawn point. */
export function startCursor(level: Level): string {
  const nodes = cursorNodes(level);
  return (nodes.find((n) => n.kind === 'junction') ?? nodes[0])?.id ?? '';
}

/**
 * The node the cursor jumps to for W A S D: the closest route node that lies in that direction, preferring nodes
 * straight ahead over nodes off to the side. Stays put when nothing lies that way.
 */
export function moveCursor(level: Level, from: string, direction: CursorDirection): string {
  const nodes = cursorNodes(level);
  const start = nodes.find((n) => n.id === from);
  if (!start) return startCursor(level);
  const dir = VECTORS[direction];
  let best: { id: string; score: number } | null = null;
  for (const node of nodes) {
    if (node.id === from) continue;
    const dx = node.x - start.x;
    const dz = node.z - start.z;
    const distance = Math.hypot(dx, dz);
    const along = (dx * dir.x + dz * dir.z) / distance;
    // Within 60° of the pressed direction.
    if (distance === 0 || along < 0.5) continue;
    const score = distance * (2 - along);
    if (!best || score < best.score) best = { id: node.id, score };
  }
  return best?.id ?? from;
}

/** Nodes still ahead of a field group on its route, without the objective at the end. */
export function nodesAhead(level: Level, group: GroupEntity): string[] {
  const route = level.routes.find((r) => r.id === group.routeId);
  return route ? route.nodes.slice(group.leg + 1, -1) : [];
}

/** Nodes where routes split, or that the level marks as junctions (the simulation's rule). */
export function junctionIds(level: Level): Set<string> {
  const next = new Map<string, Set<string>>();
  for (const route of level.routes)
    route.nodes.forEach((id, i) => {
      const after = route.nodes[i + 1];
      if (after) next.set(id, (next.get(id) ?? new Set()).add(after));
    });
  return new Set(
    level.map.nodes.filter((n) => n.kind === 'junction' || (next.get(n.id)?.size ?? 0) > 1).map((n) => n.id),
  );
}

export type CursorOrder =
  | { type: 'hold'; nodeId: string }
  | { type: 'switch'; nodeId: string; routeId: string }
  | { type: 'rerouteNow'; routeId: string }
  | { type: 'none'; reason: 'notAhead' | 'notJunction' | 'routeMissesNode' | 'sameRoute' };

/** What Enter does for a field group with the cursor on a node: hold there, if it is a junction ahead. */
export function holdAtCursor(level: Level, group: GroupEntity, cursor: string): CursorOrder {
  if (!junctionIds(level).has(cursor)) return { type: 'none', reason: 'notJunction' };
  if (!nodesAhead(level, group).includes(cursor)) return { type: 'none', reason: 'notAhead' };
  return { type: 'hold', nodeId: cursor };
}

/**
 * What T Z U do for a field group: a holding group changes route at once; a moving one switches when it reaches the
 * cursor node, which must lie ahead on both routes.
 */
export function rerouteAtCursor(
  level: Level,
  group: GroupEntity,
  cursor: string,
  routeId: string,
): CursorOrder {
  if (routeId === group.routeId) return { type: 'none', reason: 'sameRoute' };
  if (group.state === 'holding') return { type: 'rerouteNow', routeId };
  const target = level.routes.find((r) => r.id === routeId)?.nodes ?? [];
  const at = target.indexOf(cursor);
  if (at < 0 || at >= target.length - 1) return { type: 'none', reason: 'routeMissesNode' };
  if (!nodesAhead(level, group).includes(cursor)) return { type: 'none', reason: 'notAhead' };
  return { type: 'switch', nodeId: cursor, routeId };
}
