/** One running status: active while `until` is later than the current tick. */
interface Entry {
  until: number;
  magnitude: number;
}

/**
 * Timed status effects per entity (Slowed, Revealed, Boosted …). Applying a status that is still running keeps the
 * later end and the stronger magnitude, so overlapping effects never stack into something stronger than either.
 */
export class StatusBook {
  private readonly entries = new Map<number, Map<string, Entry>>();

  apply(id: number, key: string, until: number, magnitude: number, tick: number): void {
    let own = this.entries.get(id);
    if (!own) this.entries.set(id, (own = new Map()));
    const current = own.get(key);
    if (!current || current.until <= tick) own.set(key, { until, magnitude });
    else
      own.set(key, {
        until: Math.max(current.until, until),
        magnitude: Math.max(current.magnitude, magnitude),
      });
  }

  active(id: number, key: string, tick: number): boolean {
    return (this.entries.get(id)?.get(key)?.until ?? 0) > tick;
  }

  /** The magnitude of a running status, 0 when it is not running. */
  magnitude(id: number, key: string, tick: number): number {
    const entry = this.entries.get(id)?.get(key);
    return entry && entry.until > tick ? entry.magnitude : 0;
  }

  /** Whether any status whose key starts with `prefix` is running. */
  anyActive(id: number, prefix: string, tick: number): boolean {
    for (const [key, entry] of this.entries.get(id) ?? [])
      if (key.startsWith(prefix) && entry.until > tick) return true;
    return false;
  }

  clear(id: number): void {
    this.entries.delete(id);
  }
}
