import {
  AMBUSH_PRESSURE,
  AMBUSH_SECONDS,
  CROWD_PRESSURE_TAKEN,
  FORMATIONS,
  RouteGraph,
  UPGRADE_PRESSURE_BONUS,
  UPGRADE_RANGE_BONUS,
  VISIBILITY_FACTORS,
  VisionField,
  contactFactor,
  crowdSpeed,
  crowding,
  distance,
  groundOf,
  groundSpeed,
  type BoostStat,
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
  /** Factor on detection distance at this spot from the level's Concealment Zones (clearings above 1, brush below). */
  exposure: number;
  /** Distance from the spawn along the route. */
  along: number;
  /** Route Capacity of the stretch, on a narrow crossing. */
  capacity?: number;
}

export interface RouteModel {
  id: string;
  nodes: string[];
  length: number;
  samples: RouteSample[];
  /** Distance from the spawn to each node of the route. */
  nodeAlong: Map<string, number>;
  /** Capacity of the narrowest crossing on the route (Route Capacity), or null without one. */
  narrowest: number | null;
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
  /** Line of sight on the level: where brush hides, walls block, ledges see further and clearings expose. */
  readonly vision: VisionField;
  readonly routes: RouteModel[];
  readonly objective: Point & { id: string; radius: number };
  readonly detectionBonus: number;
  /** The Attacker's passive concealment (Low Profile): every group is that much harder to detect. */
  readonly lowProfile: number;
  /** The Attacker's passive bonus on how fast groups take assets apart. */
  readonly dismantleBonus: number;
  /** Exposure estimates already worked out, by route, group and the defenses they were worked out against. */
  readonly exposureCache = new Map<string, Exposure>();
  /** Line-of-sight factors from a spot to every sample of a route, by route and spot. */
  private readonly sightLines = new Map<string, Float32Array>();

  constructor(readonly setup: MatchSetup) {
    const { level } = setup;
    this.graph = new RouteGraph(level);
    this.vision = new VisionField(level.vision ?? []);
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
              exposure: 1,
              along: along + length * t,
              ...(leg.capacity === undefined ? {} : { capacity: leg.capacity }),
            });
          }
          along += length;
        }
        nodeAlong.set(leg.to, along);
      }
      for (const sample of samples) sample.exposure = this.vision.exposureAt(sample);
      const capacities = this.graph
        .routeLegs(route.id)
        .flatMap((leg) => (leg.capacity === undefined ? [] : [leg.capacity]));
      const narrowest = capacities.length > 0 ? Math.min(...capacities) : null;
      return { id: route.id, nodes: route.nodes, length: along, samples, nodeAlong, narrowest };
    });
    const node = this.graph.node(level.objective.nodeId);
    this.objective = { id: node.id, x: node.x, z: node.z, radius: level.objective.radius };
    this.detectionBonus = 1 + passiveTotal(setup.defender.passive, 'detectionRange');
    this.lowProfile = Math.min(
      0.9,
      setup.attacker.passive
        .filter((e) => e.type === 'conceal')
        .reduce((sum, e) => sum + (e.magnitude ?? 0), 0),
    );
    this.dismantleBonus = passiveTotal(setup.attacker.passive, 'dismantle');
  }

  /**
   * How much of its reach a sight line from `from` keeps to each sample of a route (0 behind a rock wall), worked out
   * once per spot. Every sample is 1 on a level without Concealment Zones.
   */
  sightLine(from: Point, route: RouteModel): Float32Array {
    const key = `${route.id}|${Math.round(from.x * 2)},${Math.round(from.z * 2)}`;
    let line = this.sightLines.get(key);
    if (!line) {
      line = new Float32Array(route.samples.length);
      if (this.vision.empty) line.fill(1);
      else route.samples.forEach((sample, i) => (line![i] = this.vision.lineFactor(from, sample)));
      if (this.sightLines.size > 4000) this.sightLines.clear();
      this.sightLines.set(key, line);
    }
    return line;
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

  /**
   * Seconds a lone group needs to walk a route, with Terrain Weight (mud bogs heavy units down) and Route Capacity (a
   * group wider than a crossing squeezes through slowly, as a column).
   */
  travelTime(route: RouteModel, unit: SimUnitType, formation: Formation, members: number): number {
    let seconds = 0;
    for (let i = 0; i < route.samples.length; i++) {
      const sample = route.samples[i] as RouteSample;
      const next = route.samples[i + 1];
      const step = next ? next.along - sample.along : SAMPLE_STEP;
      seconds += step / sampleSpeed(this, sample, unit, formation, members);
    }
    return seconds;
  }

  /** Seconds a group of a unit that fits needs for the longest narrow crossing on a route (0 without one). */
  crossingSeconds(route: RouteModel, unit: SimUnitType): number {
    let longest = 0;
    for (const leg of this.graph.routeLegs(route.id)) {
      if (leg.capacity === undefined) continue;
      const speed =
        unit.speed * FORMATIONS.column.speed * groundSpeed(groundOf(this.setup.level, leg.terrain), unit);
      longest = Math.max(longest, leg.length / Math.max(0.1, speed));
    }
    return longest;
  }
}

/** Speed of a lone group at one spot of a route: its unit, formation, the ground and how packed a crossing is. */
function sampleSpeed(
  model: LevelModel,
  sample: RouteSample,
  unit: SimUnitType,
  formation: Formation,
  members: number,
): number {
  const ground = groundOf(model.setup.level, sample.terrain);
  const crossing = sample.capacity !== undefined;
  const crowd = crossing ? crowding(members * unit.capacity, sample.capacity as number) : 0;
  return Math.max(
    0.1,
    unit.speed *
      FORMATIONS[crossing ? 'column' : formation].speed *
      groundSpeed(ground, unit) *
      crowdSpeed(crowd),
  );
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

export function passiveTotal(passive: SimEffect[], stat: BoostStat): number {
  let total = 0;
  for (const effect of passive)
    if (effect.type === 'boost' && (effect.stat ?? 'speed') === stat && !effect.condition)
      total += effect.magnitude ?? 0;
  return total;
}

export interface ExposureOptions {
  unit: SimUnitType;
  formation: Formation;
  members: number;
  /** Start counting from this distance along the route (a group already under way). */
  from?: number;
  /**
   * Count the surprise of assets hidden in Ambush Zones. Only the Defender knows where they wait; the Attacker only
   * knows assets it has already seen, and those can no longer surprise it.
   */
  ambushes?: boolean;
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
  const { unit, formation, members, from = 0, ambushes = false } = options;
  const active = defenses.filter((d) => d.condition > 0);
  const key = [
    route.id,
    unit.id,
    formation,
    members,
    Math.round(from),
    ambushes ? 'a' : '',
    ...active.map(
      (d) =>
        `${d.type.id}@${Math.round(d.x)},${Math.round(d.z)}:${d.level}:${d.blocking ? Math.round(d.condition) : ''}:${d.boosted ? 1 : 0}`,
    ),
  ].join('|');
  const cached = model.exposureCache.get(key);
  if (cached) return cached;
  if (model.exposureCache.size > 5000) model.exposureCache.clear();
  const exposure = computeExposure(model, route, active, unit, formation, members, from, ambushes);
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
  ambushes: boolean,
): Exposure {
  // Sensors see hidden units as easily as any other; other assets only see them from closer.
  const hidden = VISIBILITY_FACTORS[unit.visibility] * (1 - model.lowProfile);
  let pressureSeconds = 0;
  let blockedSeconds = 0;
  const vantage = active.map((d) => model.vision.vantageAt(d));
  const lines = active.map((d) => model.sightLine(d, route));
  const contact = model.setup.level.closeContact;
  // A hidden asset catches a group by surprise once: a few seconds of extra pressure, spread over the time the group
  // spends crossing its reach.
  const surprise = active.map((d) =>
    ambushes && model.vision.ambushAt(d)
      ? 1 + (AMBUSH_PRESSURE * AMBUSH_SECONDS * unit.speed) / (2 * reachOf(d.type, d.level))
      : 1,
  );
  for (let index = 0; index < route.samples.length; index++) {
    const sample = route.samples[index] as RouteSample;
    if (sample.along < from) continue;
    const ground = groundOf(model.setup.level, sample.terrain);
    // On a narrow crossing a group moves as a column, and packed it takes more pressure (Route Capacity).
    const crossing = sample.capacity !== undefined;
    const shape = crossing ? 'column' : formation;
    const packed = crossing && crowding(members * unit.capacity, sample.capacity as number) > 1;
    const visibility = FORMATIONS[shape].detection * ground.detection * sample.exposure;
    let detected = false;
    let pressure = 0;
    let slow = 0;
    for (let k = 0; k < active.length; k++) {
      const d = active[k] as KnownDefense;
      const gap = distance(d, sample);
      const sight = detectionOf(d.type, d.level) * model.detectionBonus * visibility * (vantage[k] as number);
      const line = (lines[k] as Float32Array)[index] as number;
      // Close Contact: within its range a group is seen past any cover (not through a wall).
      if (gap <= sight * (d.type.seesHidden ? 1 : hidden) * line) detected = true;
      else if (contact && gap <= contact.range && line > 0) detected = true;
      if (gap <= reachOf(d.type, d.level) && line > 0) {
        pressure +=
          pressureOf(d.type, d.level) *
          (d.boosted ? 1.5 : 1) *
          contactFactor(contact, gap) *
          (surprise[k] as number);
        slow = Math.max(slow, d.type.slow);
      }
    }
    if (!detected || pressure === 0) continue;
    const speed = sampleSpeed(model, sample, unit, formation, members) * (1 - slow);
    const taken = FORMATIONS[shape].pressureTaken * (packed ? 1 + CROWD_PRESSURE_TAKEN : 1);
    pressureSeconds += (pressure * taken) / Math.max(0.1, speed);
  }
  const blockers = active.filter(
    (d) => d.blocking && (route.nodeAlong.get(d.nodeId) ?? -1) > from && route.nodes.includes(d.nodeId),
  );
  for (const blocker of blockers) {
    // Waiting in front of it: everything that reaches the waiting spot keeps pressing until it gives way.
    const dismantle = blocker.type.dismantlable ? unit.dismantle * (1 + model.dismantleBonus) : 0;
    const wearTime =
      blocker.condition / Math.max(0.01, (blocker.type.wearPerMemberSecond + dismantle) * members);
    let pressure = 0;
    for (const d of active) {
      const gap = distance(d, blocker);
      if (gap <= reachOf(d.type, d.level) + 2)
        pressure += pressureOf(d.type, d.level) * contactFactor(model.setup.level.closeContact, gap);
    }
    blockedSeconds += pressure * wearTime;
  }
  const scaled = pressureSeconds + blockedSeconds * FORMATIONS[formation].pressureTaken;
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
    if (gap <= reachOf(d.type, d.level) && !model.vision.blocked(d, model.objective))
      pressure += pressureOf(d.type, d.level) * contactFactor(model.setup.level.closeContact, gap);
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
