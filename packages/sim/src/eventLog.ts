import type { MatchResult, Side } from './types';

export type MatchEvent =
  | { tick: number; type: 'matchStarted'; seed: number; levelId: string }
  | { tick: number; type: 'combatStarted' }
  | { tick: number; type: 'commandRejected'; side: Side; command: string; reason: string }
  | { tick: number; type: 'waveLaunched'; waveId: number; groupIds: number[] }
  | {
      tick: number;
      type: 'groupLaunched';
      groupId: number;
      waveId: number;
      unitTypeId: string;
      count: number;
      routeId: string;
    }
  | { tick: number; type: 'groupHolding'; groupId: number; nodeId: string }
  | { tick: number; type: 'groupBlocked'; groupId: number; nodeId: string; defenseId: number }
  | { tick: number; type: 'groupRerouted'; groupId: number; routeId: string }
  | { tick: number; type: 'groupRetreating'; groupId: number }
  | { tick: number; type: 'groupLeft'; groupId: number; count: number; refundCapacity: number; refundSupplies: number }
  | { tick: number; type: 'checkpointPassed'; groupId: number; nodeId: string; bonus: number }
  | { tick: number; type: 'groupReachedObjective'; groupId: number }
  | { tick: number; type: 'groupDetected'; groupId: number }
  | { tick: number; type: 'groupIdentified'; groupId: number }
  | { tick: number; type: 'groupLost'; groupId: number }
  /** Non-lethal: one member was stopped and walks off the map. */
  | { tick: number; type: 'memberTurnedBack'; groupId: number; byDefenseId: number; remaining: number }
  | { tick: number; type: 'groupStopped'; groupId: number; byDefenseId: number }
  | { tick: number; type: 'waveStopped'; waveId: number; bonus: number }
  | { tick: number; type: 'defensePlaced'; defenseId: number; defenseTypeId: string; nodeId: string }
  | { tick: number; type: 'defenseUpgraded'; defenseId: number; level: number }
  | { tick: number; type: 'defenseRepaired'; defenseId: number }
  | { tick: number; type: 'defenseSold'; defenseId: number; refund: number }
  | { tick: number; type: 'defenseDisrupted'; defenseId: number }
  | { tick: number; type: 'defenseSeen'; defenseId: number }
  | { tick: number; type: 'abilityUsed'; side: Side; abilityId: string }
  | { tick: number; type: 'matchEnded'; result: MatchResult };

export type MatchEventType = MatchEvent['type'];

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
