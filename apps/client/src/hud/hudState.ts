import type { Action, Level, StagePack } from '@gtd/content-schema';
import type { DefenseEntity, MatchSnapshot, Side } from '@gtd/sim';

/** What the player has picked on the map or in a list. */
export type Selection = { kind: 'group'; id: number } | { kind: 'defense'; id: number } | null;

/**
 * What the next click on the map does: place the chosen build item, aim an ability, pick a route for a group, or pick
 * a place for a patrol. Escape or a right click cancels.
 */
export type MapMode =
  | { type: 'build'; defenseTypeId: string }
  | { type: 'ability'; abilityId: string; groupId?: number }
  | { type: 'reroute'; groupId: number }
  | { type: 'focus'; defenseId: number }
  | { type: 'guard'; defenseId: number }
  | { type: 'patrol'; defenseId: number }
  | null;

export type Layout = 'desktop' | 'tablet' | 'phone';

/** Phones: short side under 500 px. Tablets: touch screens and windows up to 1280 px wide. Everything else: desktop. */
export function layoutFor(width: number, height: number, coarsePointer: boolean): Layout {
  if (Math.min(width, height) <= 500) return 'phone';
  if (width <= 1280 || coarsePointer) return 'tablet';
  return 'desktop';
}

/** Map nodes where a defense type may go (the simulation checks again and has the last word). */
export function buildSites(level: Level, type: StagePack['catalog']['defenses'][number] | undefined) {
  if (!type) return [];
  const routeNodes = new Set(level.routes.flatMap((r) => r.nodes));
  const spawns = new Set(level.routes.map((r) => r.nodes[0]));
  return level.map.nodes.filter((n) => {
    const onRoute = routeNodes.has(n.id) && !spawns.has(n.id);
    if (type.mobile) return onRoute;
    const routeOk = onRoute && n.id !== level.objective.nodeId;
    if (type.placement === 'buildZone') return n.buildable === true;
    if (type.placement === 'routeNode') return routeOk;
    return n.buildable === true || routeOk;
  });
}

/** Free build sites: structures cannot share a node, patrols can. */
export function freeBuildSites(
  level: Level,
  type: StagePack['catalog']['defenses'][number] | undefined,
  defenses: DefenseEntity[],
) {
  const taken = new Set(defenses.filter((d) => !d.mobile).map((d) => d.nodeId));
  return buildSites(level, type).filter((n) => type?.mobile || !taken.has(n.id));
}

/** Route nodes a junction ability (a closure, a dropped barrier) can be aimed at: not a spawn, not the objective. */
export function junctionTargets(level: Level): string[] {
  return patrolNodes(level).filter((id) => id !== level.objective.nodeId);
}

/** Route-graph nodes a patrol may be sent to. */
export function patrolNodes(level: Level): string[] {
  const spawns = new Set(level.routes.map((r) => r.nodes[0]));
  return [...new Set(level.routes.flatMap((r) => r.nodes))].filter((id) => !spawns.has(id));
}

export function upgradeCost(type: { cost: number; upgradeCostFactor: number }, level: number): number {
  return Math.round(type.cost * type.upgradeCostFactor * level);
}

export function repairCost(type: { cost: number }, condition: number): number {
  return Math.ceil((type.cost * 0.5 * (100 - condition)) / 100);
}

/** What the player must click to use an ability. */
export function abilityAim(ability: Action): 'now' | 'ground' | 'group' | 'route' | 'node' {
  if (ability.target === 'self') return 'now';
  if (ability.target === 'area') return 'ground';
  if (ability.target === 'junction') return 'node';
  if (ability.target === 'route') return 'route';
  return 'group';
}

/** A route ability that moves a group (Rapid Reroute) needs the group first, then the route. */
export function abilityNeedsGroup(ability: Action): boolean {
  return (
    ability.target === 'unit' ||
    (ability.target === 'route' && ability.effects.some((e) => e.type === 'move'))
  );
}

export function abilityReady(snapshot: MatchSnapshot, ability: Action, side: Side): boolean {
  const points = snapshot.points[side] ?? 0;
  return (snapshot.cooldowns[ability.id] ?? 0) <= 0 && points >= ability.cost;
}
