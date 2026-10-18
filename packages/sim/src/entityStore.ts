export interface Entity {
  readonly id: number;
}

/**
 * Holds the live entities of a match. Ids are allocated in order and never reused, and iteration is always in id
 * order, so every system visits entities in the same sequence on every machine.
 */
export class EntityStore<T extends Entity> {
  private readonly items = new Map<number, T>();
  private nextId = 1;

  create<S extends T>(build: (id: number) => S): S {
    const entity = build(this.nextId++);
    this.items.set(entity.id, entity);
    return entity;
  }

  get(id: number): T | undefined {
    return this.items.get(id);
  }

  remove(id: number): boolean {
    return this.items.delete(id);
  }

  /** Entities in id order. A copy, so systems may remove entities while iterating. */
  all(): T[] {
    return [...this.items.values()];
  }

  filter<S extends T>(predicate: (entity: T) => entity is S): S[] {
    return this.all().filter(predicate);
  }

  get size(): number {
    return this.items.size;
  }
}
