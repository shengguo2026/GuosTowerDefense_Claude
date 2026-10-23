import type { VisionArea } from './vision';

export type Side = 'attacker' | 'defender';

/** Open ground is faster but easier to detect; cover is slower but safer (Open Ground Exposure, Lion). */
export type Terrain = 'open' | 'cover';

export type NodeKind = 'spawn' | 'junction' | 'checkpoint' | 'connector' | 'objective' | 'buildZone';

export interface MapNode {
  id: string;
  x: number;
  z: number;
  kind?: NodeKind;
  /** The Defender may build a structure here. */
  buildable?: boolean;
}

export interface MapEdge {
  from: string;
  to: string;
  /** Bend points between the two nodes, so paths can curve around terrain. */
  via?: [number, number][];
  terrain?: Terrain;
}

export interface Route {
  id: string;
  /** Node ids from the spawn point to the objective; consecutive nodes must share an edge. */
  nodes: string[];
}

export interface TerrainModifiers {
  /** Movement speed factor. */
  speed: number;
  /** Factor on the distance at which defenders detect a group. */
  detection: number;
}

export interface EconomyBonuses {
  /** Attacker supplies when a group passes a checkpoint node for the first time. */
  checkpointPass: number;
  /** Defender supplies for each member turned back. */
  memberTurnedBack: number;
  /** Defender supplies when every member of a wave was turned back. */
  waveStopped: number;
  /** Share of capacity and supplies a retreating group gets back when it leaves the map. */
  retreatRefund: number;
}

export interface SimLevel {
  id: string;
  timerSeconds: number;
  /** Time at the start when the Defender builds and the Attacker plans; no launches yet. */
  preparationSeconds: number;
  objective: { nodeId: string; holdSeconds: number; radius: number };
  nodes: MapNode[];
  edges: MapEdge[];
  routes: Route[];
  /** Total capacity the Attacker can deploy over the whole match. */
  deploymentCapacity: number;
  launchCooldownSeconds: number;
  maxActiveWaves: number;
  startingResources: Record<Side, number>;
  incomePerSecond: Record<Side, number>;
  /** Second resource, spent on abilities (Recon Points, Response Points). */
  startingPoints: Record<Side, number>;
  pointsPerSecond: Record<Side, number>;
  bonuses: EconomyBonuses;
  terrain: Record<Terrain, TerrainModifiers>;
  /** Concealment Zones and environment objects that shape line of sight (none on open levels). */
  vision?: VisionArea[];
}

export type Visibility = 'normal' | 'concealed' | 'stealth';

export interface SimUnitType {
  id: string;
  /** Map units per second. */
  speed: number;
  /** Supplies per member. */
  cost: number;
  /** Deployment capacity per member. */
  capacity: number;
  /** Pressure needed to turn back one member of the group. */
  resilience: number;
  visibility: Visibility;
  /** How close the group must come to a defense to see it. */
  sightRange: number;
  /** Condition per second each member takes off a defense it works on (Focus Defense, or a roadblock it waits at). */
  dismantle: number;
  /** Factor on how fast the group wins hold time at the objective. */
  objectiveRate: number;
}

/** Where an asset may be placed: build zones, nodes on a route (not spawn or objective for structures), or either. */
export type Placement = 'buildZone' | 'routeNode' | 'any';

export interface SimDefenseType {
  id: string;
  cost: number;
  /** Mobile assets (patrols) move along the route graph; structures stay where they were built. */
  mobile: boolean;
  placement: Placement;
  /** Reach of interception and slowing. */
  range: number;
  detectionRange: number;
  /** Pressure per second on the asset's current target. */
  pressurePerSecond: number;
  /** Share of speed groups in range lose (0.4 = 40 % slower). */
  slow: number;
  /** Map units per second, mobile assets only. */
  speed: number;
  /** How many of this asset the Defender may have at once (no limit when left out). */
  maxCount?: number;
  /**
   * A blocking asset on a route node stops groups in front of it (a roadblock). The Defender may never block every
   * route: placement and repair are refused if they would.
   */
  blocksNode: boolean;
  maxLevel: number;
  /** Upgrade to level n+1 costs cost × upgradeCostFactor × n. */
  upgradeCostFactor: number;
  /** Condition a blocking asset loses per second for each member held in front of it; at 0 it is disrupted. */
  wearPerMemberSecond: number;
  /** Attacker sabotage can put it out of action for a while. */
  disruptible: boolean;
  /** Attacker units can take it apart: at 0 condition it is removed instead of waiting for a repair. */
  dismantlable: boolean;
  /** A sensor: detects Concealed and Stealth units as easily as normal ones. */
  seesHidden: boolean;
  /** Temporary assets are removed after this long (no limit when left out). */
  lifetimeSeconds?: number;
  /** Condition per second it gives back to the Defender's worn (not yet disrupted) assets in its reach. */
  repairPerSecond: number;
}

export type AbilityTarget = 'self' | 'area' | 'unit' | 'route' | 'junction';
export type EffectType =
  | 'slow'
  | 'reveal'
  | 'conceal'
  | 'protect'
  | 'disrupt'
  | 'boost'
  | 'move'
  | 'spawn'
  | 'blockBranch'
  | 'resource'
  | 'dismantle';

/** What a boost raises. Without a stat, groups move faster and mobile assets move and press harder. */
export type BoostStat = 'speed' | 'detectionRange' | 'sightRange' | 'pressure' | 'holdRate' | 'dismantle';
/**
 * When an effect counts: `knownRoute` on a route an earlier group of this match already used, `atObjective` for groups
 * in the objective zone.
 */
export type EffectCondition = 'knownRoute' | 'atObjective';

export interface SimEffect {
  type: EffectType;
  magnitude?: number;
  stat?: BoostStat;
  condition?: EffectCondition;
  /** For `spawn`: the unit or defense type to create. */
  spawn?: string;
  /** For `resource`: which of the profile's two resources it adds to (default supplies). */
  pool?: 'supplies' | 'points';
}

/**
 * Engine orders a command slot can stand for. They keep their own commands (`holdGroup`, `upgradeDefense` …); a profile
 * only decides which of them sit on its keys.
 */
export type OrderType =
  | 'hold'
  | 'advance'
  | 'retreat'
  | 'reroute'
  | 'formation'
  | 'dismantle'
  | 'upgrade'
  | 'repair'
  | 'sell'
  | 'priority'
  | 'focus'
  | 'guard'
  | 'patrol';
export const ATTACKER_ORDERS: readonly OrderType[] = [
  'hold',
  'advance',
  'retreat',
  'reroute',
  'formation',
  'dismantle',
];
export const DEFENDER_ORDERS: readonly OrderType[] = [
  'upgrade',
  'repair',
  'sell',
  'priority',
  'focus',
  'guard',
  'patrol',
];

/**
 * An ability or a command, composed from building blocks (spec §2.1): a target type, effects, range, duration, cost
 * and cooldown. A command is aimed from the selected group or asset; an order command stands for an engine order.
 */
export interface SimAbility {
  id: string;
  target: AbilityTarget;
  effects: SimEffect[];
  range: number;
  durationSeconds: number;
  /** Points (the profile's second resource). */
  cost: number;
  cooldownSeconds: number;
  order?: OrderType;
}

export interface SimSide {
  profileId: string;
  abilities: SimAbility[];
  /** The profile's command slots (up to 6), in key order. */
  commands: SimAbility[];
  passive: SimEffect[];
}

export interface MatchSetup {
  seed: number;
  level: SimLevel;
  attacker: SimSide & { units: SimUnitType[] };
  defender: SimSide & { defenses: SimDefenseType[] };
}

export type MatchEndReason = 'objectiveCompleted' | 'timerExpired' | 'capacityExhausted';

export interface MatchResult {
  winner: Side;
  reason: MatchEndReason;
}

export type Formation = 'column' | 'spread';
export type DetectionState = 'unknown' | 'detected' | 'identified';
/**
 * `blocked`: waiting in front of a roadblock or a closed branch; `holding`: stopped at a junction by the Attacker;
 * `dismantling`: stopped to take apart the defense it focuses.
 */
export type GroupState =
  'waiting' | 'moving' | 'holding' | 'blocked' | 'dismantling' | 'atObjective' | 'retreating';

/** Status effects (spec §8). Every status is shown with an icon and a word, never colour alone. */
export type GroupStatus = 'slowed' | 'boosted' | 'concealed' | 'revealed' | 'pinned' | 'protected';
export type DefenseStatus = 'disrupted' | 'boosted' | 'protected' | 'revealed' | 'concealed';

export interface GroupEntity {
  id: number;
  kind: 'group';
  waveId: number;
  /** Empty when the viewer has detected but not yet identified the group. */
  unitTypeId: string;
  count: number;
  formation: Formation;
  routeId: string;
  /** Index into the route's nodes of the node the group last passed. */
  leg: number;
  /** Distance travelled along the current leg. */
  legDistance: number;
  state: GroupState;
  /** Stop at the next junction (Hold). */
  holdAtJunction: boolean;
  /** Switch to this route at the next node it shares (Rapid Reroute). */
  pendingRouteId: string | null;
  pressure: number;
  detection: DetectionState;
  /** Status effects that are active this tick. */
  slowed: boolean;
  boosted: boolean;
  statuses: GroupStatus[];
  /** The defense the group works on (Focus Defense). */
  focusDefenseId: number | null;
  x: number;
  z: number;
}

export type TargetPriority = 'first' | 'last' | 'strongest' | 'weakest' | 'fastest';
export const TARGET_PRIORITIES: readonly TargetPriority[] = [
  'first',
  'last',
  'strongest',
  'weakest',
  'fastest',
];

export type DefenseOrder = { type: 'guard'; nodeId: string } | { type: 'patrol'; nodeIds: [string, string] };

export interface DefenseEntity {
  id: number;
  kind: 'defense';
  defenseTypeId: string;
  mobile: boolean;
  /** Node it stands on (structures) or last reached (patrols). */
  nodeId: string;
  level: number;
  /** 0–100. A blocking asset wears down while groups push against it; at 0 it is disrupted until repaired. */
  condition: number;
  /** Currently closes its node (a blocking asset on a route node that is not disrupted). */
  blocking: boolean;
  priority: TargetPriority;
  focusGroupId: number | null;
  targetGroupId: number | null;
  order: DefenseOrder | null;
  boosted: boolean;
  /** Out of action: worn down to 0 condition (until repaired) or sabotaged (for a while). */
  disrupted: boolean;
  statuses: DefenseStatus[];
  /** A temporary asset leaves at this tick. */
  expiresAtTick: number | null;
  /** Supplies spent on it so far (selling refunds half). */
  spent: number;
  /** In the Attacker's view: a remembered structure that is not in sight right now (its state may be out of date). */
  remembered?: boolean;
  x: number;
  z: number;
}

export type MatchEntity = GroupEntity | DefenseEntity;

/** An ability or command in effect: where it works and what it does there, for the map. */
export interface AreaEffect {
  abilityId: string;
  side: Side;
  /** Centre of an area, the junction, or the group or asset a command came from. */
  x: number;
  z: number;
  radius: number;
  /** Set when the effect follows a whole route. */
  routeId?: string;
  effects: EffectType[];
  remainingTicks: number;
}

/** A branch the Defender closed for a while (`blockBranch`): groups wait in front of the node until it opens. */
export interface Closure {
  nodeId: string;
  x: number;
  z: number;
  remainingTicks: number;
}

export interface SideStats {
  attacker: {
    wavesLaunched: number;
    membersLaunched: number;
    membersReachedObjective: number;
    membersTurnedBack: number;
    membersRetreated: number;
    checkpointsPassed: number;
    capacityUsed: number;
    defensesDisrupted: number;
    defensesDismantled: number;
    /** Highest objective progress, 0–1. */
    bestObjectiveProgress: number;
  };
  defender: {
    membersTurnedBack: number;
    wavesStopped: number;
    structuresBuilt: number;
    patrolsDeployed: number;
    upgrades: number;
    groupsIdentified: number;
    abilitiesUsed: number;
  };
}

export interface MatchSnapshot {
  tick: number;
  phase: 'preparation' | 'combat' | 'ended';
  result: MatchResult | null;
  /** Whose view this is; `null` is the full debug view. */
  viewer: Side | null;
  /** The opponent's numbers are left out of a side's view. */
  resources: Partial<Record<Side, number>>;
  points: Partial<Record<Side, number>>;
  capacity: { total: number; remaining: number };
  objective: {
    nodeId: string;
    x: number;
    z: number;
    radius: number;
    heldTicks: number;
    requiredTicks: number;
    contested: boolean;
  };
  remainingTicks: number;
  preparationRemainingTicks: number;
  launchCooldownRemainingTicks: number;
  activeWaves: number;
  /** Remaining cooldown ticks per ability id, for the viewer's side (both in the debug view). */
  cooldowns: Record<string, number>;
  /** Area abilities in effect that the viewer may see (their own side's, or all in the debug view). */
  areaEffects: AreaEffect[];
  /** Closed branches the viewer knows of (the Defender's own; the Attacker's once a group sees them). */
  closures: Closure[];
  entities: MatchEntity[];
  stats: SideStats;
}
