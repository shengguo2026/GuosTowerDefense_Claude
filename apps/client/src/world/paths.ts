export interface Point2 {
  x: number;
  z: number;
}

/** Shortest distance from a point to a polyline. */
export function distanceToPath(x: number, z: number, path: readonly Point2[]): number {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i] as Point2;
    const b = path[i + 1] as Point2;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lengthSq));
    best = Math.min(best, Math.hypot(x - a.x - t * dx, z - a.z - t * dz));
  }
  return best;
}

export function pathLength(path: readonly Point2[]): number {
  let length = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i] as Point2;
    const b = path[i + 1] as Point2;
    length += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return length;
}

/** Point and heading (radians, 0 = +z) at a distance along a polyline. */
export function sampleAlong(
  path: readonly Point2[],
  distance: number,
): { x: number; z: number; heading: number } {
  let left = distance;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i] as Point2;
    const b = path[i + 1] as Point2;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= length || i === path.length - 2) {
      const t = length > 0 ? Math.min(1, left / length) : 0;
      return {
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        heading: Math.atan2(b.x - a.x, b.z - a.z),
      };
    }
    left -= length;
  }
  const last = path[path.length - 1] ?? { x: 0, z: 0 };
  return { x: last.x, z: last.z, heading: 0 };
}
