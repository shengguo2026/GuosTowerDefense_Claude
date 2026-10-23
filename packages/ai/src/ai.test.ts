import { Match, type MatchSetup } from '@gtd/sim';
import { fixtureSetup } from '@gtd/sim/test-fixture';
import { describe, expect, it } from 'vitest';
import {
  DIFFICULTIES,
  LevelModel,
  createAi,
  routeExposure,
  type Controller,
  type KnownDefense,
} from './index';

function play(setup: MatchSetup, attacker: Controller, defender: Controller, maxTicks = 20_000): Match {
  const match = new Match(setup);
  while (!match.isOver && match.tick < maxTicks) {
    for (const command of [
      ...attacker.decide(match.snapshot('attacker'), setup),
      ...defender.decide(match.snapshot('defender'), setup),
    ])
      match.enqueue({ ...command, tick: match.tick + 1 });
    match.step();
  }
  return match;
}

describe('level model', () => {
  it('samples every route from spawn to objective', () => {
    const model = new LevelModel(fixtureSetup());
    for (const route of model.routes) {
      expect(route.samples.length).toBeGreaterThan(20);
      expect(route.nodeAlong.get(route.nodes.at(-1) as string)).toBeCloseTo(route.length);
    }
    expect(model.routesAt({ x: 20, z: 10 }).map((r) => r.id)).toEqual(['north']);
    expect(model.routesAt({ x: 5, z: 0 }).map((r) => r.id)).toEqual(['north', 'south']);
  });

  it('expects more losses next to a defense and none on a clear route', () => {
    const setup = fixtureSetup();
    const model = new LevelModel(setup);
    const post = setup.defender.defenses.find((d) => d.id === 'post');
    if (!post) throw new Error('fixture post missing');
    const defense: KnownDefense = {
      id: 1,
      type: post,
      x: 20,
      z: 13,
      level: 1,
      condition: 100,
      blocking: false,
      nodeId: 'north-zone',
    };
    const unit = setup.attacker.units[0];
    if (!unit) throw new Error('fixture unit missing');
    const options = { unit, formation: 'column' as const, members: 5 };
    expect(routeExposure(model, model.route('north'), [defense], options).losses).toBeGreaterThan(0);
    expect(routeExposure(model, model.route('south'), [defense], options).losses).toBe(0);
  });
});

describe('level model on heavy ground and narrow crossings (Elephant)', () => {
  /** The fixture with mud on the north route and a narrow crossing (room for 4) on its last stretch. */
  function elephantLike(): MatchSetup {
    const setup = fixtureSetup();
    setup.level.edges = setup.level.edges.map((e) =>
      e.from === 'fork' && e.to === 'north'
        ? { ...e, terrain: 'mud' }
        : e.from === 'north' && e.to === 'goal'
          ? { ...e, capacity: 4 }
          : e,
    );
    setup.level.terrain = { ...setup.level.terrain, mud: { speed: 1, detection: 1, weight: { heavy: 0.5 } } };
    return setup;
  }

  it('knows the narrowest crossing of each route', () => {
    const model = new LevelModel(elephantLike());
    expect(model.route('north').narrowest).toBe(4);
    expect(model.route('south').narrowest).toBeNull();
  });

  it('expects heavy units to take longer over mud, and wide groups to take longer over a crossing', () => {
    const setup = elephantLike();
    const model = new LevelModel(setup);
    const walker = setup.attacker.units[0]!;
    const heavy = { ...walker, id: 'truck', capacity: 3 };
    const light = { ...walker, id: 'runner', capacity: 1 };
    const north = model.route('north');
    // Same speed, but the heavy one bogs down in the mud.
    expect(model.travelTime(north, heavy, 'column', 1)).toBeGreaterThan(
      model.travelTime(north, light, 'column', 1),
    );
    // Ten members do not fit a crossing for four: they squeeze through more slowly.
    expect(model.travelTime(north, light, 'column', 10)).toBeGreaterThan(
      model.travelTime(north, light, 'column', 4),
    );
    expect(model.crossingSeconds(north, light)).toBeGreaterThan(0);
    expect(model.crossingSeconds(model.route('south'), light)).toBe(0);
  });

  it('plays whole matches on such a level with only accepted commands', () => {
    for (const difficulty of DIFFICULTIES) {
      const match = play(
        elephantLike(),
        createAi('attacker', difficulty, 3),
        createAi('defender', difficulty, 4),
      );
      expect(match.isOver).toBe(true);
      expect(match.events.all().filter((e) => e.type === 'commandRejected')).toEqual([]);
    }
  });
});

describe('AI players', () => {
  it.each(DIFFICULTIES)('play a whole match at %s with only accepted commands', (difficulty) => {
    const setup = fixtureSetup();
    const match = play(setup, createAi('attacker', difficulty, 1), createAi('defender', difficulty, 2));
    expect(match.isOver).toBe(true);
    const rejected = match.events.all().filter((e) => e.type === 'commandRejected');
    expect(rejected).toEqual([]);
  });

  it('records its reasoning for the developer view', () => {
    const setup = fixtureSetup();
    const attacker = createAi('attacker', 'hard', 1);
    const defender = createAi('defender', 'hard', 2);
    play(setup, attacker, defender);
    expect(attacker.thoughts.some((t) => t.lines.some((l) => l.startsWith('Launch')))).toBe(true);
    expect(defender.thoughts.some((t) => t.lines.some((l) => l.startsWith('Build')))).toBe(true);
  });

  it('decides the same way from the same seed', () => {
    const setup = fixtureSetup();
    const run = () =>
      play(setup, createAi('attacker', 'medium', 5), createAi('defender', 'medium', 6)).events.all();
    expect(run()).toEqual(run());
  });
});
