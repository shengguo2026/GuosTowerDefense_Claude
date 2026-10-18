export type Side = 'attacker' | 'defender';

export interface MapNode {
  id: string;
  x: number;
  z: number;
  /** The Defender may build here. */
  buildable?: boolean;
}

export interface MapEdge {
  from: string;
  to: string;
  /** Bend points between the two nodes, so paths can curve around terrain. */
  via?: [number, number][];
}

export interface Route {
  id: string;
  /** Node ids from the spawn point to the objective; consecutive nodes must share an edge. */
  nodes: string[];
}

export interface SimLevel {
  id: string;
  timerSeconds: number;
  objective: { nodeId: string; holdSeconds: number };
  nodes: MapNode[];
  edges: MapEdge[];
  routes: Route[];
  startingResources: Record<Side, number>;
  incomePerSecond: Record<Side, number>;
}

export interface SimUnitType {
  id: string;
  /** Map units per second. */
  speed: number;
  /** Resource cost per member. */
  cost: number;
  /** Pressure needed to turn back one member of the group. */
  resilience: number;
}

export interface SimDefenseType {
  id: string;
  cost: number;
  /** Reach in map units around the node it is built on. */
  range: number;
  /** Pressure applied per second to each attacker group in range. */
  pressurePerSecond: number;
}

export interface SimSideSetup {
  profileId: string;
}

export interface MatchSetup {
  seed: number;
  level: SimLevel;
  attacker: SimSideSetup & { units: SimUnitType[] };
  defender: SimSideSetup & { defenses: SimDefenseType[] };
}

export interface MatchResult {
  winner: Side;
  reason: 'objectiveHeld' | 'timerExpired';
}

export interface GroupEntity {
  id: number;
  kind: 'group';
  unitTypeId: string;
  count: number;
  routeId: string;
  /** Index of the route node the group last passed. */
  segment: number;
  /** Distance travelled along the current segment. */
  distance: number;
  speed: number;
  pressure: number;
  state: 'moving' | 'holding';
  x: number;
  z: number;
}

export interface DefenseEntity {
  id: number;
  kind: 'defense';
  defenseTypeId: string;
  nodeId: string;
  x: number;
  z: number;
}

export type MatchEntity = GroupEntity | DefenseEntity;

/** Plain, serialisable view of a match, sent to clients and used by tests. */
export interface MatchSnapshot {
  tick: number;
  phase: 'running' | 'ended';
  result: MatchResult | null;
  resources: Record<Side, number>;
  objective: { nodeId: string; heldTicks: number; requiredTicks: number };
  remainingTicks: number;
  entities: MatchEntity[];
}
