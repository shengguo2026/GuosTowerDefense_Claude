import { describe, expect, it } from 'vitest';
import { CommandQueue, FixedStepClock, Match, Rng, TICK_MS, hashValue, type Command } from './index';
import { fixtureSetup } from './testFixture';

function runToEnd(match: Match, maxTicks = 10_000): void {
  for (let i = 0; i < maxTicks && !match.isOver; i++) match.step();
}

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
      type: 'launchGroup',
      side: 'attacker',
      tick: 2,
      unitTypeId: 'walker',
      count: 1,
      routeId: 'north',
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

describe('Match', () => {
  it('ends with a Defender win when the timer runs out', () => {
    const match = new Match(fixtureSetup());
    runToEnd(match);
    expect(match.result).toEqual({ winner: 'defender', reason: 'timerExpired' });
    expect(match.tick).toBe(60 * 20);
  });

  it('ends with an Attacker win when a group holds the objective', () => {
    const match = new Match(fixtureSetup());
    match.enqueue({
      type: 'launchGroup',
      side: 'attacker',
      tick: 1,
      unitTypeId: 'walker',
      count: 2,
      routeId: 'south',
    });
    runToEnd(match);
    expect(match.result).toEqual({ winner: 'attacker', reason: 'objectiveHeld' });
    const types = match.events.all().map((event) => event.type);
    expect(types).toEqual(['matchStarted', 'groupLaunched', 'groupReachedObjective', 'matchEnded']);
  });

  it('turns back a group that walks past a defense instead of harming it', () => {
    const match = new Match(fixtureSetup());
    match.enqueue({
      type: 'placeDefense',
      side: 'defender',
      tick: 1,
      defenseTypeId: 'post',
      nodeId: 'north',
    });
    match.enqueue({
      type: 'launchGroup',
      side: 'attacker',
      tick: 1,
      unitTypeId: 'walker',
      count: 1,
      routeId: 'north',
    });
    runToEnd(match);
    expect(match.events.all().some((event) => event.type === 'groupStopped')).toBe(true);
    expect(match.result?.winner).toBe('defender');
  });

  it('rejects illegal commands without changing resources', () => {
    const match = new Match(fixtureSetup());
    match.enqueue({ type: 'placeDefense', side: 'defender', tick: 1, defenseTypeId: 'post', nodeId: 'goal' });
    match.enqueue({
      type: 'launchGroup',
      side: 'attacker',
      tick: 1,
      unitTypeId: 'walker',
      count: 50,
      routeId: 'north',
    });
    match.step();
    const rejected = match.events.all().filter((event) => event.type === 'commandRejected');
    expect(rejected.map((event) => event.type === 'commandRejected' && event.reason)).toEqual([
      'notEnoughResources',
      'notBuildable',
    ]);
    expect(match.snapshot().entities).toHaveLength(0);
  });

  it('is deterministic for the same seed and commands', () => {
    const play = (seed: number) => {
      const match = new Match(fixtureSetup({ seed }));
      match.enqueue({
        type: 'placeDefense',
        side: 'defender',
        tick: 3,
        defenseTypeId: 'post',
        nodeId: 'north',
      });
      for (let t = 1; t < 400; t += 40) {
        match.enqueue({
          type: 'launchGroup',
          side: 'attacker',
          tick: t,
          unitTypeId: 'walker',
          count: 1,
          routeId: 'north',
        });
      }
      runToEnd(match);
      return hashValue({ events: match.events.all(), snapshot: match.snapshot() });
    };
    expect(play(1)).toBe(play(1));
    expect(play(1)).not.toBe(play(2));
  });
});
