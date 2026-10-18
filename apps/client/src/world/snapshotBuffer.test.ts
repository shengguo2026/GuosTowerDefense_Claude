import type { MatchSnapshot } from '@gtd/sim';
import { describe, expect, it } from 'vitest';
import { INTERPOLATION_DELAY_MS, SnapshotBuffer } from './snapshotBuffer';

function snap(tick: number, x: number): MatchSnapshot {
  return {
    tick,
    phase: 'running',
    result: null,
    resources: { attacker: 0, defender: 0 },
    objective: { nodeId: 'goal', heldTicks: 0, requiredTicks: 100 },
    remainingTicks: 1000,
    entities: [
      {
        id: 1,
        kind: 'group',
        unitTypeId: 'scout',
        count: 2,
        routeId: 'r',
        segment: 0,
        distance: x,
        speed: 4,
        pressure: 0,
        state: 'moving',
        x,
        z: 0,
      },
    ],
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
