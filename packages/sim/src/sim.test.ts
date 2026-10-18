import { describe, expect, it } from 'vitest';
import {
  CommandQueue,
  FixedStepClock,
  Match,
  Rng,
  TICK_MS,
  RouteGraph,
  routePath,
  type Command,
} from './index';
import { fixtureSetup } from './testFixture';

describe('Rng', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = new Rng(7);
    const b = new Rng(7);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(Array.from({ length: 5 }, () => b.next()));
  });

  it('accepts text seeds and keeps values in range', () => {
    const rng = new Rng('chaotic-seed');
    for (let i = 0; i < 1000; i++) {
      const value = rng.int(3, 6);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(6);
    }
  });

  it('restores from saved state', () => {
    const rng = new Rng(99);
    rng.next();
    const state = rng.getState();
    const expected = rng.next();
    rng.setState(state);
    expect(rng.next()).toBe(expected);
  });
});

describe('CommandQueue', () => {
  it('orders due commands by tick, then side, then arrival', () => {
    const queue = new CommandQueue();
    const defend: Command = {
      type: 'placeDefense',
      side: 'defender',
      tick: 1,
      defenseTypeId: 'post',
      nodeId: 'north',
    };
    const attackLate: Command = {
      type: 'launchWave',
      side: 'attacker',
      tick: 2,
      groups: [{ unitTypeId: 'walker', count: 1, formation: 'column', routeId: 'north', delaySeconds: 0 }],
    };
    const attack: Command = { ...attackLate, tick: 1 };
    queue.enqueue(attackLate);
    queue.enqueue(defend);
    queue.enqueue(attack);
    expect(queue.drain(1)).toEqual([attack, defend]);
    expect(queue.size).toBe(1);
    expect(queue.drain(5)).toEqual([attackLate]);
  });
});

describe('FixedStepClock', () => {
  it('converts elapsed time into whole ticks and keeps the remainder', () => {
    const clock = new FixedStepClock();
    expect(clock.advance(TICK_MS * 2.5)).toBe(2);
    expect(clock.alpha).toBeCloseTo(0.5);
    expect(clock.advance(TICK_MS * 0.5)).toBe(1);
  });

  it('limits catch-up after a long stall', () => {
    const clock = new FixedStepClock(TICK_MS, 10);
    expect(clock.advance(60_000)).toBe(10);
    expect(clock.alpha).toBe(0);
  });
});

describe('routePath', () => {
  it('inserts edge bend points in travel direction, also for edges listed the other way round', () => {
    const nodes = new Map([
      ['a', { id: 'a', x: 0, z: 0 }],
      ['b', { id: 'b', x: 10, z: 0 }],
      ['c', { id: 'c', x: 10, z: 10 }],
    ]);
    const edges = [
      { from: 'a', to: 'b', via: [[5, 2]] as [number, number][] },
      {
        from: 'c',
        to: 'b',
        via: [
          [12, 8],
          [12, 2],
        ] as [number, number][],
      },
    ];
    expect(routePath({ id: 'r', nodes: ['a', 'b', 'c'] }, nodes, edges)).toEqual([
      { x: 0, z: 0 },
      { x: 5, z: 2 },
      { x: 10, z: 0 },
      { x: 12, z: 2 },
      { x: 12, z: 8 },
      { x: 10, z: 10 },
    ]);
  });

  it('walks groups along the bend points', () => {
    const setup = fixtureSetup({}, { preparationSeconds: 0 });
    setup.level.edges[0] = { from: 'spawn', to: 'fork', via: [[0, 10]], terrain: 'cover' };
    const match = new Match(setup);
    match.enqueue({
      type: 'launchWave',
      side: 'attacker',
      tick: 1,
      groups: [{ unitTypeId: 'walker', count: 1, formation: 'column', routeId: 'north', delaySeconds: 0 }],
    });
    for (let i = 0; i < 40; i++) match.step();
    const group = match.snapshot().entities[0];
    // About 6 units along the first leg, which runs straight up the z axis to the bend point.
    expect(group?.x).toBeCloseTo(0, 5);
    expect(group?.z).toBeGreaterThan(5);
  });
});

describe('RouteGraph', () => {
  it('finds junctions where routes split and the shortest walk between nodes', () => {
    const graph = new RouteGraph(fixtureSetup().level);
    expect([...graph.junctions]).toEqual(['fork']);
    expect(graph.shortestPath('north', 'south')?.map((leg) => leg.to)).toEqual(['fork', 'south']);
    expect(graph.shortestPath('north', 'north-zone')).toBeNull();
  });

  it('knows whether a set of closed nodes leaves a route open', () => {
    const graph = new RouteGraph(fixtureSetup().level);
    expect(graph.hasOpenRoute(new Set(['north']))).toBe(true);
    expect(graph.hasOpenRoute(new Set(['north', 'south']))).toBe(false);
    expect(graph.hasOpenRoute(new Set(['fork']))).toBe(false);
    expect(graph.hasOpenRoute(new Set(['spawn']))).toBe(true);
  });
});
