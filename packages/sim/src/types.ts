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
  | 'resource';

export interface SimEffect {
  type: EffectType;
  magnitude?: number;
  /** What a boost raises, e.g. `speed` or `detectionRange`. */
  stat?: 'speed' | 'detectionRange';
  /** When a passive applies, e.g. `knownRoute` (a route an earlier group of this match already used). */
  condition?: 'knownRoute';
}

export interface SimAbility {
  id: string;
  target: AbilityTarget;
  effects: SimEffect[];
  range: number;
  durationSeconds: number;
  /** Points (the profile's second resource). */
  cost: number;
  cooldownSeconds: number;
}

export interface SimSide {
  profileId: string;
  abilities: SimAbility[];
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
/** `blocked`: waiting in front of a roadblock; `holding`: stopped at a junction by the Attacker. */
export type GroupState = 'waiting' | 'moving' | 'holding' | 'blocked' | 'atObjective' | 'retreating';

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
  x: number;
  z: number;
}

export type TargetPriority = 'first' | 'last' | 'strongest' | 'weakest' | 'fastest';
export const TARGET_PRIORITIES: readonly TargetPriority[] = ['first', 'last', 'strongest', 'weakest', 'fastest'];

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
  /** Supplies spent on it so far (selling refunds half). */
  spent: number;
  /** In the Attacker's view: a remembered structure that is not in sight right now (its state may be out of date). */
  remembered?: boolean;
  x: number;
  z: number;
}

export type MatchEntity = GroupEntity | DefenseEntity;

export interface AreaEffect {
  abilityId: string;
  side: Side;
  x: number;
  z: number;
  radius: number;
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
  entities: MatchEntity[];
  stats: SideStats;
}
