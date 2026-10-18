import type { MatchSnapshot } from '@gtd/sim';

/** How far behind the newest snapshot the view renders, so there is always a pair to interpolate between. */
export const INTERPOLATION_DELAY_MS = 120;

interface Timed {
  at: number;
  snapshot: MatchSnapshot;
}

export interface InterpolatedEntity {
  id: number;
  x: number;
  z: number;
  /** Direction of travel in radians (0 = +z), held when standing still. */
  heading: number;
  moving: boolean;
}

/** Keeps recent snapshots and blends entity positions between them for smooth motion at any frame rate. */
export class SnapshotBuffer {
  private readonly items: Timed[] = [];
  private readonly headings = new Map<number, number>();

  push(snapshot: MatchSnapshot, at: number): void {
    if (this.items.length > 0 && snapshot.tick < (this.items.at(-1) as Timed).snapshot.tick)
      this.items.length = 0;
    this.items.push({ at, snapshot });
    if (this.items.length > 8) this.items.shift();
  }

  clear(): void {
    this.items.length = 0;
    this.headings.clear();
  }

  get latest(): MatchSnapshot | null {
    return this.items.at(-1)?.snapshot ?? null;
  }

  /** Positions of every entity in the newest snapshot, as seen at `now`. */
  sample(now: number): Map<number, InterpolatedEntity> {
    const result = new Map<number, InterpolatedEntity>();
    const latest = this.items.at(-1);
    if (!latest) return result;
    const renderAt = now - INTERPOLATION_DELAY_MS;
    let older = this.items[0] as Timed;
    let newer = latest;
    for (let i = 0; i < this.items.length - 1; i++) {
      const a = this.items[i] as Timed;
      const b = this.items[i + 1] as Timed;
      if (a.at <= renderAt && renderAt <= b.at) {
        older = a;
        newer = b;
        break;
      }
    }
    if (renderAt > latest.at) older = newer = latest;
    const span = newer.at - older.at;
    const t = span > 0 ? Math.min(1, Math.max(0, (renderAt - older.at) / span)) : 1;
    const before = new Map(older.snapshot.entities.map((e) => [e.id, e]));

    for (const entity of latest.snapshot.entities) {
      const to = newer.snapshot.entities.find((e) => e.id === entity.id) ?? entity;
      const from = before.get(entity.id) ?? to;
      const x = from.x + (to.x - from.x) * t;
      const z = from.z + (to.z - from.z) * t;
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const moving = dx * dx + dz * dz > 1e-6;
      if (moving) this.headings.set(entity.id, Math.atan2(dx, dz));
      result.set(entity.id, { id: entity.id, x, z, heading: this.headings.get(entity.id) ?? 0, moving });
    }
    return result;
  }
}
