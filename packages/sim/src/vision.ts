import { distance, distanceToPolyline, type Point } from './graph';

/** What an environment object does to sight lines through it (spec §8, masterplan §28). */
export type LineOfSight = 'blocker' | 'partial' | 'none';

/**
 * A Concealment Zone or environment object of a level: dense brush, a rock wall, a ledge, a clearing. It is either a
 * circle or a wall (a line of points with a width). Everything it does is a factor, so a level states only what it
 * changes.
 */
export interface VisionArea {
  id: string;
  /** How the client draws it (`brush`, `rockWall`, `ledge`, `clearing` …); the simulation does not read it. */
  kind: string;
  circle?: { x: number; z: number; radius: number };
  wall?: { points: Point[]; width: number };
  /** Sight lines through it: stopped (`blocker`), shortened (`partial`) or untouched (`none`). */
  los: LineOfSight;
  /** For `partial`: share of the distance a sight line through it still reaches (0.6 = 60 %). */
  cover: number;
  /** Factor on how far away a group standing in it can be detected (a clearing exposes, brush hides). */
  exposure: number;
  /** Factor on how far whoever stands in it sees (a ledge looks further). */
  vantage: number;
  /**
   * An Ambush Zone (Rhinoceros): Defender assets standing in it are hard to spot, and one the Attacker has not seen
   * catches a group by surprise the first time it reaches it.
   */
  ambush?: boolean;
}

/**
 * Line of sight on a level, kept simple but meaningful: who stands where, and what the line between two points
 * crosses. Detection, the Attacker's sight of defenses, interception reach and the AI's map reading all use it.
 */
export class VisionField {
  readonly areas: readonly VisionArea[];

  constructor(areas: readonly VisionArea[] = []) {
    this.areas = areas;
  }

  get empty(): boolean {
    return this.areas.length === 0;
  }

  /** Whether a point lies in an area (on a wall: within half its width). */
  contains(area: VisionArea, p: Point): boolean {
    if (area.circle) return distance(area.circle, p) <= area.circle.radius;
    if (area.wall) return distanceToPolyline(p, area.wall.points) <= area.wall.width / 2;
    return false;
  }

  /** Factor on the detection distance of a group standing at `p`. */
  exposureAt(p: Point): number {
    let factor = 1;
    for (const area of this.areas) if (area.exposure !== 1 && this.contains(area, p)) factor *= area.exposure;
    return factor;
  }

  /** Whether `p` lies in an Ambush Zone. */
  ambushAt(p: Point): boolean {
    for (const area of this.areas) if (area.ambush && this.contains(area, p)) return true;
    return false;
  }

  /** Factor on the sight of whoever stands at `p` (the best vantage point it stands on). */
  vantageAt(p: Point): number {
    let best = 1;
    for (const area of this.areas) if (area.vantage > best && this.contains(area, p)) best = area.vantage;
    return best;
  }

  /**
   * Share of its distance a sight line from `a` to `b` keeps: 0 when a blocker stands between them, reduced by each
   * area of partial cover it passes through (including one either end stands in), 1 in the open.
   */
  lineFactor(a: Point, b: Point): number {
    let factor = 1;
    for (const area of this.areas) {
      if (area.los === 'none') continue;
      if (!this.crosses(area, a, b)) continue;
      if (area.los === 'blocker') return 0;
      factor *= area.cover;
    }
    return factor;
  }

  /** Whether a blocker stands between two points (interception cannot reach through a rock wall). */
  blocked(a: Point, b: Point): boolean {
    for (const area of this.areas) if (area.los === 'blocker' && this.crosses(area, a, b)) return true;
    return false;
  }

  /**
   * Whether `from`, seeing `range` far in the open, sees `to`: the distance must be within the range after the sight
   * line's cover. Vantage and exposure are the caller's to apply, since they depend on who looks at whom.
   */
  sees(from: Point, to: Point, range: number): boolean {
    const gap = distance(from, to);
    if (gap > range) return false;
    if (this.areas.length === 0) return true;
    return gap <= range * this.lineFactor(from, to);
  }

  /**
   * How far one sees in each of `rays` directions around `origin`, for drawing a view area: the reach along each ray
   * after the walls and brush it meets.
   */
  viewShape(origin: Point, range: number, rays = 72): Point[] {
    const out: Point[] = [];
    for (let i = 0; i < rays; i++) {
      const angle = (i / rays) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      // Walk outwards: the furthest point still seen, given what the line to it crosses.
      let lo = 0;
      const steps = 24;
      for (let s = 1; s <= steps; s++) {
        const d = (range * s) / steps;
        const p = { x: origin.x + dx * d, z: origin.z + dz * d };
        if (d <= range * this.lineFactor(origin, p)) lo = d;
        else if (this.blocked(origin, p)) break;
      }
      out.push({ x: origin.x + dx * lo, z: origin.z + dz * lo });
    }
    return out;
  }

  private crosses(area: VisionArea, a: Point, b: Point): boolean {
    if (area.circle) {
      const { x, z, radius } = area.circle;
      // Standing on a boulder or ledge does not hide the view from it; standing in brush does.
      if (
        area.los === 'blocker' &&
        (distance(area.circle, a) <= radius || distance(area.circle, b) <= radius)
      )
        return false;
      return distanceToPolyline({ x, z }, [a, b]) <= radius;
    }
    if (area.wall) {
      const points = area.wall.points;
      for (let i = 1; i < points.length; i++)
        if (segmentsIntersect(a, b, points[i - 1] as Point, points[i] as Point)) return true;
    }
    return false;
  }
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
}

/** Whether segments ab and cd intersect (touching counts). */
export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && onSegment(c, d, a)) return true;
  if (d2 === 0 && onSegment(c, d, b)) return true;
  if (d3 === 0 && onSegment(a, b, c)) return true;
  if (d4 === 0 && onSegment(a, b, d)) return true;
  return false;
}

function onSegment(p: Point, q: Point, r: Point): boolean {
  return (
    Math.min(p.x, q.x) <= r.x &&
    r.x <= Math.max(p.x, q.x) &&
    Math.min(p.z, q.z) <= r.z &&
    r.z <= Math.max(p.z, q.z)
  );
}
