import type { MapEdge, MapNode, Route, SimLevel, Terrain } from './types';

export interface Point {
  x: number;
  z: number;
}

/** The stretch of a route between two consecutive nodes, expanded into walkable points. */
export interface Leg {
  from: string;
  to: string;
  points: Point[];
  length: number;
  terrain: Terrain;
  /** Route Capacity of the edge (a narrow crossing), when it has one. */
  capacity?: number;
  /** The same for both directions of an edge, so groups going either way share a crossing. */
  edgeKey: string;
}

/**
 * The level's route network prepared for movement: route legs, node lookups, junctions and shortest paths between
 * nodes for patrols.
 */
export class RouteGraph {
  readonly nodes: Map<string, MapNode>;
  readonly routes: Map<string, Route>;
  readonly legs: Map<string, Leg[]>;
  /** Nodes where routes split, or nodes the level marks as junctions. Groups hold and reroute only here. */
  readonly junctions: Set<string>;
  /** Every node that lies on at least one route. */
  readonly routeNodes: Set<string>;
  private readonly adjacency = new Map<string, { to: string; leg: Leg }[]>();

  constructor(level: Pick<SimLevel, 'nodes' | 'edges' | 'routes'>) {
    this.nodes = new Map(level.nodes.map((node) => [node.id, node]));
    this.routes = new Map(level.routes.map((route) => [route.id, route]));
    for (const edge of level.edges) {
      const forward = this.edgeLeg(edge, false);
      const backward = this.edgeLeg(edge, true);
      this.link(edge.from, edge.to, forward);
      this.link(edge.to, edge.from, backward);
    }
    this.legs = new Map(
      level.routes.map((route) => [
        route.id,
        route.nodes.slice(1).map((to, i) => this.leg(route.nodes[i] as string, to)),
      ]),
    );
    this.routeNodes = new Set(level.routes.flatMap((route) => route.nodes));
    this.junctions = new Set();
    const nextNodes = new Map<string, Set<string>>();
    for (const route of level.routes) {
      route.nodes.forEach((id, i) => {
        const next = route.nodes[i + 1];
        if (next === undefined) return;
        const set = nextNodes.get(id) ?? new Set<string>();
        set.add(next);
        nextNodes.set(id, set);
      });
    }
    for (const [id, next] of nextNodes) if (next.size > 1) this.junctions.add(id);
    for (const node of level.nodes)
      if (node.kind === 'junction' && this.routeNodes.has(node.id)) this.junctions.add(node.id);
  }

  node(id: string): MapNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Unknown map node "${id}"`);
    return node;
  }

  routeLegs(routeId: string): Leg[] {
    const legs = this.legs.get(routeId);
    if (!legs) throw new Error(`Unknown route "${routeId}"`);
    return legs;
  }

  /** The leg from `from` to `to`; the two nodes must share an edge. */
  leg(from: string, to: string): Leg {
    const link = this.adjacency.get(from)?.find((entry) => entry.to === to);
    if (!link) throw new Error(`No edge between "${from}" and "${to}"`);
    return link.leg;
  }

  /** Shortest walk between two nodes over the edge network (Dijkstra), as consecutive legs; null if unreachable. */
  shortestPath(from: string, to: string): Leg[] | null {
    if (from === to) return [];
    const dist = new Map<string, number>([[from, 0]]);
    const prev = new Map<string, { node: string; leg: Leg }>();
    const open = new Set<string>([from]);
    while (open.size > 0) {
      let current: string | undefined;
      for (const id of open)
        if (current === undefined || (dist.get(id) as number) < (dist.get(current) as number)) current = id;
      const here = current as string;
      open.delete(here);
      if (here === to) break;
      for (const { to: next, leg } of this.adjacency.get(here) ?? []) {
        const candidate = (dist.get(here) as number) + leg.length;
        if (candidate < (dist.get(next) ?? Infinity)) {
          dist.set(next, candidate);
          prev.set(next, { node: here, leg });
          open.add(next);
        }
      }
    }
    if (!prev.has(to)) return null;
    const path: Leg[] = [];
    for (let at = to; at !== from;) {
      const step = prev.get(at) as { node: string; leg: Leg };
      path.unshift(step.leg);
      at = step.node;
    }
    return path;
  }

  /**
   * True when at least one route reaches the objective without passing a closed node. The spawn node itself never
   * counts as closed. This is the "never block every route" rule.
   */
  hasOpenRoute(closed: ReadonlySet<string>): boolean {
    for (const route of this.routes.values()) {
      if (route.nodes.slice(1).every((id) => !closed.has(id))) return true;
    }
    return false;
  }

  private link(from: string, to: string, leg: Leg): void {
    const list = this.adjacency.get(from) ?? [];
    list.push({ to, leg });
    this.adjacency.set(from, list);
  }

  private edgeLeg(edge: MapEdge, reverse: boolean): Leg {
    const from = this.node(reverse ? edge.to : edge.from);
    const to = this.node(reverse ? edge.from : edge.to);
    const via = (edge.via ?? []).map(([x, z]) => ({ x, z }));
    if (reverse) via.reverse();
    const points = [{ x: from.x, z: from.z }, ...via, { x: to.x, z: to.z }];
    return {
      from: from.id,
      to: to.id,
      points,
      length: polylineLength(points),
      terrain: edge.terrain ?? 'cover',
      ...(edge.capacity === undefined ? {} : { capacity: edge.capacity }),
      edgeKey: `${edge.from}|${edge.to}`,
    };
  }
}

export function polylineLength(points: Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    length += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return length;
}

/** The point `distance` along a polyline (clamped to its ends). */
export function pointOnPolyline(points: Point[], distance: number): Point {
  let left = Math.max(0, distance);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= length) {
      const t = length > 0 ? left / length : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    left -= length;
  }
  const last = points[points.length - 1] as Point;
  return { x: last.x, z: last.z };
}

/** A route expanded into the points a group walks through, including edge bend points (used by the 3D view). */
export function routePath(route: Route, nodes: Map<string, MapNode>, edges: MapEdge[]): Point[] {
  const graph = new RouteGraph({ nodes: [...nodes.values()], edges, routes: [route] });
  const path: Point[] = [];
  for (const leg of graph.routeLegs(route.id))
    path.push(...(path.length === 0 ? leg.points : leg.points.slice(1)));
  return path;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Shortest distance from a point to a polyline. */
export function distanceToPolyline(point: Point, points: Point[]): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    const t =
      lengthSq > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq)) : 0;
    best = Math.min(best, Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t)));
  }
  return points.length === 1 ? distance(point, points[0] as Point) : best;
}
