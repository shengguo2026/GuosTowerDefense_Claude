import type { MatchResult, Side } from './types';

export type MatchEvent =
  | { tick: number; type: 'matchStarted'; seed: number; levelId: string }
  | { tick: number; type: 'commandRejected'; side: Side; command: string; reason: string }
  | {
      tick: number;
      type: 'groupLaunched';
      groupId: number;
      unitTypeId: string;
      count: number;
      routeId: string;
    }
  | { tick: number; type: 'groupReachedObjective'; groupId: number }
  | { tick: number; type: 'groupStopped'; groupId: number; byDefenseId: number }
  | { tick: number; type: 'defensePlaced'; defenseId: number; defenseTypeId: string; nodeId: string }
  | { tick: number; type: 'matchEnded'; result: MatchResult };

/** Append-only record of everything that happened in a match, used for replays, tests and the local match log. */
export class EventLog {
  private readonly events: MatchEvent[] = [];

  push(event: MatchEvent): void {
    this.events.push(event);
  }

  all(): readonly MatchEvent[] {
    return this.events;
  }

  /** Events added after the first `index` events; lets a server send only what is new. */
  since(index: number): MatchEvent[] {
    return this.events.slice(index);
  }

  get length(): number {
    return this.events.length;
  }
}
