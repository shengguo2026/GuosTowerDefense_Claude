import {
  FORMATIONS,
  RouteGraph,
  UPGRADE_PRESSURE_BONUS,
  UPGRADE_RANGE_BONUS,
  VISIBILITY_FACTORS,
  distance,
  type DefenseEntity,
  type Formation,
  type MatchSetup,
  type Point,
  type SimDefenseType,
  type SimEffect,
  type SimUnitType,
  type Terrain,
} from '@gtd/sim';

/** Distance between two route samples. */
const SAMPLE_STEP = 1;

export interface RouteSample extends Point {
  terrain: Terrain;
  /** Distance from the spawn along the route. */
  along: number;
}

export interface RouteModel {
  id: string;
  nodes: string[];
  length: number;
  samples: RouteSample[];
  /** Distance from the spawn to each node of the route. */
  nodeAlong: Map<string, number>;
}

/** A defense as one side knows it: all of them for the Defender, the seen or remembered ones for the Attacker. */
export interface KnownDefense extends Point {
  id: number;
  type: SimDefenseType;
  level: number;
  condition: number;
  blocking: boolean;
  nodeId: string;
  boosted?: boolean;
}

/**
 * What both AIs know about a level before the match starts, the same as a human reading the map and the manual: the
 * routes as walkable samples, and how far each asset reaches and presses.
 */
export class LevelModel {
  readonly graph: RouteGraph;
  readonly routes: RouteModel[];
  readonly objective: Point & { id: string; radius: number };
  readonly detectionBonus: number;
  /** Exposure estimates already worked out, by route, group and the defenses they were worked out against. */
  readonly exposureCache = new Map<string, Exposure>();

  constructor(readonly setup: MatchSetup) {
    const { level } = setup;
    this.graph = new RouteGraph(level);
    this.routes = level.routes.map((route) => {
      const samples: RouteSample[] = [];
      const nodeAlong = new Map<string, number>([[route.nodes[0] as string, 0]]);
      let along = 0;
      for (const leg of this.graph.routeLegs(route.id)) {
        for (let i = 1; i < leg.points.length; i++) {
          const a = leg.points[i - 1] as Point;
          const b = leg.points[i] as Point;
          const length = distance(a, b);
          const count = Math.max(1, Math.ceil(length / SAMPLE_STEP));
          for (let s = 0; s < count; s++) {
            const t = (s + 0.5) / count;
            samples.push({
              x: a.x + (b.x - a.x) * t,
              z: a.z + (b.z - a.z) * t,
              terrain: leg.terrain,
              along: along + length * t,
            });
          }
          along += length;
        }
        nodeAlong.set(leg.to, along);
      }
      return { id: route.id, nodes: route.nodes, length: along, samples, nodeAlong };
    });
    const node = this.graph.node(level.objective.nodeId);
    this.objective = { id: node.id, x: node.x, z: node.z, radius: level.objective.radius };
    this.detectionBonus = 1 + passiveTotal(setup.defender.passive, 'detectionRange');
  }

  route(id: string): RouteModel {
    const route = this.routes.find((r) => r.id === id);
    if (!route) throw new Error(`Unknown route "${id}"`);
    return route;
  }

  /** Routes that pass within `tolerance` of a point (a group seen there may be on any of them). */
  routesAt(point: Point, tolerance = 1.5): RouteModel[] {
    return this.routes.filter((route) => route.samples.some((s) => distance(s, point) <= tolerance));
  }

  /** How far along a route a point is (distance of the nearest sample from the spawn). */
  alongRoute(route: RouteModel, point: Point): number {
    let best = Infinity;
    let along = 0;
    for (const sample of route.samples) {
      const d = distance(sample, point);
      if (d < best) {
        best = d;
        along = sample.along;
      }
    }
    return along;
  }

  /** Remaining distance to the objective from a point on a route. */
  distanceToGoal(route: RouteModel, point: Point): number {
    return route.length - this.alongRoute(route, point);
  }

  defenseType(id: string): SimDefenseType | undefined {
    return this.setup.defender.defenses.find((d) => d.id === id);
  }

  unit(id: string): SimUnitType | undefined {
    return this.setup.attacker.units.find((u) => u.id === id);
  }
}

export function reachOf(type: SimDefenseType, level: number): number {
  return type.range * (1 + UPGRADE_RANGE_BONUS * (level - 1));
}

export function detectionOf(type: SimDefenseType, level: number): number {
  return type.detectionRange * (1 + UPGRADE_RANGE_BONUS * (level - 1));
}

export function pressureOf(type: SimDefenseType, level: number): number {
  return type.pressurePerSecond * (1 + UPGRADE_PRESSURE_BONUS * (level - 1));
}

export function passiveTotal(passive: SimEffect[], stat: 'speed' | 'detectionRange'): number {
  let total = 0;
  for (const effect of passive)
    if (effect.type === 'boost' && effect.stat === stat) total += effect.magnitude ?? 0;
  return total;
}

export interface ExposureOptions {
  unit: SimUnitType;
  formation: Formation;
  members: number;
  /** Start counting from this distance along the route (a group already under way). */
  from?: number;
}

export interface Exposure {
  /** Pressure a lone group would take walking the rest of the route, already scaled by its formation. */
  pressure: number;
  /** Members it would lose on the way. */
  losses: number;
  /** Roadblocks still standing on the way. */
  blockers: KnownDefense[];
}

/**
 * Estimates what a group would go through on the rest of a route: at every sample, the defenses that would detect it
 * and those that reach it, how long it stays there (slower in a checkpoint's reach), and the time spent wearing down
 * any roadblock in its way. A defense presses one group at a time, so this is the cost for the group that is targeted.
 */
export function routeExposure(
  model: LevelModel,
  route: RouteModel,
  defenses: KnownDefense[],
  options: ExposureOptions,
): Exposure {
  const { unit, formation, members, from = 0 } = options;
  const active = defenses.filter((d) => d.condition > 0);
  const key = [
    route.id,
    unit.id,
    formation,
    members,
    Math.round(from),
    ...active.map(
      (d) =>
        `${d.type.id}@${Math.round(d.x)},${Math.round(d.z)}:${d.level}:${d.blocking ? Math.round(d.condition) : ''}:${d.boosted ? 1 : 0}`,
    ),
  ].join('|');
  const cached = model.exposureCache.get(key);
  if (cached) return cached;
  if (model.exposureCache.size > 5000) model.exposureCache.clear();
  const exposure = computeExposure(model, route, active, unit, formation, members, from);
  model.exposureCache.set(key, exposure);
  return exposure;
}

function computeExposure(
  model: LevelModel,
  route: RouteModel,
  active: KnownDefense[],
  unit: SimUnitType,
  formation: Formation,
  members: number,
  from: number,
): Exposure {
  const { terrain } = model.setup.level;
  let pressureSeconds = 0;
  for (const sample of route.samples) {
    if (sample.along < from) continue;
    const ground = terrain[sample.terrain];
    const visibility =
      VISIBILITY_FACTORS[unit.visibility] * FORMATIONS[formation].detection * ground.detection;
    let detected = false;
    let pressure = 0;
    let slow = 0;
    for (const d of active) {
      const gap = distance(d, sample);
      if (gap <= detectionOf(d.type, d.level) * model.detectionBonus * visibility) detected = true;
      if (gap <= reachOf(d.type, d.level)) {
        pressure += pressureOf(d.type, d.level) * (d.boosted ? 1.5 : 1);
        slow = Math.max(slow, d.type.slow);
      }
    }
    if (!detected || pressure === 0) continue;
    const speed = unit.speed * FORMATIONS[formation].speed * ground.speed * (1 - slow);
    pressureSeconds += pressure * (1 / Math.max(0.1, speed));
  }
  const blockers = active.filter(
    (d) => d.blocking && (route.nodeAlong.get(d.nodeId) ?? -1) > from && route.nodes.includes(d.nodeId),
  );
  for (const blocker of blockers) {
    // Waiting in front of it: everything that reaches the waiting spot keeps pressing until it gives way.
    const wearTime = blocker.condition / Math.max(0.01, blocker.type.wearPerMemberSecond * members);
    let pressure = 0;
    for (const d of active)
      if (distance(d, blocker) <= reachOf(d.type, d.level) + 2) pressure += pressureOf(d.type, d.level);
    pressureSeconds += pressure * wearTime;
  }
  const scaled = pressureSeconds * FORMATIONS[formation].pressureTaken;
  return { pressure: scaled, losses: scaled / unit.resilience, blockers };
}

/** Pressure per second on a group holding the objective, and whether a patrol there contests it. */
export function objectivePressure(
  model: LevelModel,
  defenses: KnownDefense[],
): { pressure: number; contested: boolean } {
  let pressure = 0;
  let contested = false;
  for (const d of defenses) {
    if (d.condition <= 0) continue;
    const gap = distance(d, model.objective);
    if (gap <= reachOf(d.type, d.level)) pressure += pressureOf(d.type, d.level);
    if (d.type.mobile && gap <= model.objective.radius) contested = true;
  }
  return { pressure, contested };
}

export function toKnown(entity: DefenseEntity, type: SimDefenseType): KnownDefense {
  return {
    id: entity.id,
    type,
    x: entity.x,
    z: entity.z,
    level: entity.level,
    condition: entity.condition,
    blocking: entity.blocking,
    nodeId: entity.nodeId,
    boosted: entity.boosted,
  };
}
