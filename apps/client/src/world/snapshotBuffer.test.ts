import type { MatchSnapshot } from '@gtd/sim';
import { describe, expect, it } from 'vitest';
import { INTERPOLATION_DELAY_MS, SnapshotBuffer } from './snapshotBuffer';

function snap(tick: number, x: number): MatchSnapshot {
  return {
    tick,
    phase: 'combat',
    result: null,
    viewer: null,
    resources: { attacker: 0, defender: 0 },
    points: { attacker: 0, defender: 0 },
    capacity: { total: 40, remaining: 40 },
    objective: { nodeId: 'goal', x: 0, z: 0, radius: 4, heldTicks: 0, requiredTicks: 100, contested: false },
    remainingTicks: 1000,
    preparationRemainingTicks: 0,
    launchCooldownRemainingTicks: 0,
    activeWaves: 1,
    cooldowns: {},
    areaEffects: [],
    closures: [],
    entities: [
      {
        id: 1,
        kind: 'group',
        waveId: 1,
        unitTypeId: 'scout',
        count: 2,
        formation: 'column',
        routeId: 'r',
        leg: 0,
        legDistance: x,
        state: 'moving',
        holdAtJunction: false,
        pendingRouteId: null,
        pressure: 0,
        detection: 'unknown',
        slowed: false,
        boosted: false,
        statuses: [],
        focusDefenseId: null,
        x,
        z: 0,
      },
    ],
    stats: {
      attacker: {
        wavesLaunched: 0,
        membersLaunched: 0,
        membersReachedObjective: 0,
        membersTurnedBack: 0,
        membersRetreated: 0,
        checkpointsPassed: 0,
        capacityUsed: 0,
        defensesDisrupted: 0,
        defensesDismantled: 0,
        bestObjectiveProgress: 0,
      },
      defender: {
        membersTurnedBack: 0,
        wavesStopped: 0,
        structuresBuilt: 0,
        patrolsDeployed: 0,
        upgrades: 0,
        groupsIdentified: 0,
        abilitiesUsed: 0,
      },
    },
  };
}

describe('SnapshotBuffer', () => {
  it('interpolates positions between two snapshots, a little in the past', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snap(2, 0), 1000);
    buffer.push(snap(4, 10), 1100);
    const half = buffer.sample(1050 + INTERPOLATION_DELAY_MS).get(1);
    expect(half?.x).toBeCloseTo(5);
    expect(half?.heading).toBeCloseTo(Math.PI / 2);
    expect(half?.moving).toBe(true);
  });

  it('holds the newest position when no newer snapshot has arrived', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snap(2, 0), 1000);
    buffer.push(snap(4, 10), 1100);
    expect(buffer.sample(5000).get(1)?.x).toBe(10);
  });

  it('starts over when a new match begins', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snap(200, 50), 1000);
    buffer.push(snap(0, 0), 1100);
    expect(buffer.latest?.tick).toBe(0);
    expect(buffer.sample(1100).get(1)?.x).toBe(0);
  });
});
