import { describe, expect, it } from 'vitest';
import { Match, secondsToTicks, unitWeight, type Command, type WaveGroupOrder } from './index';
import { fixtureLevel, fixtureSetup } from './testFixture';
import type { GroupEntity, MatchSetup, SimLevel, SimUnitType } from './types';

// M12 Elephant: Terrain Weight (heavy ground slows units by weight) and Route Capacity (narrow crossings).

const truck: SimUnitType = {
  id: 'truck',
  speed: 4,
  cost: 10,
  capacity: 3,
  resilience: 6,
  visibility: 'normal',
  sightRange: 12,
  dismantle: 0,
  objectiveRate: 1,
};

function newMatch(level: Partial<SimLevel> = {}, overrides: Partial<MatchSetup> = {}): Match {
  const setup = fixtureSetup(overrides, level);
  setup.attacker.units.push(truck);
  setup.level.deploymentCapacity = 60;
  setup.level.startingResources.attacker = 1000;
  return new Match(setup);
}

function send(match: Match, command: Omit<Command, 'tick'>): void {
  match.enqueue({ ...command, tick: match.tick + 1 } as Command);
  match.step();
}

function runUntil(match: Match, done: () => boolean, maxSeconds = 300): void {
  for (let i = 0; i < secondsToTicks(maxSeconds) && !match.isOver && !done(); i++) match.step();
}

const order = (overrides: Partial<WaveGroupOrder> = {}): WaveGroupOrder => ({
  unitTypeId: 'walker',
  count: 2,
  formation: 'column',
  routeId: 'north',
  delaySeconds: 0,
  ...overrides,
});

function groups(match: Match): GroupEntity[] {
  return match.snapshot().entities.filter((e): e is GroupEntity => e.kind === 'group');
}

/** Ticks from launch until the first group reaches the objective. */
function arrival(match: Match, ...wave: WaveGroupOrder[]): number {
  runUntil(match, () => match.phase === 'combat');
  send(match, { type: 'launchWave', side: 'attacker', groups: wave } as Omit<Command, 'tick'>);
  const start = match.tick;
  runUntil(match, () => groups(match).some((g) => g.state === 'atObjective'));
  return match.tick - start;
}

/** The fixture with its north route over mud (or another heavy ground). */
function heavyNorth(
  terrain: 'mud' | 'water',
  weight: SimLevel['terrain']['open']['weight'],
): Partial<SimLevel> {
  const level = fixtureLevel();
  return {
    edges: level.edges.map((e) => (e.from === 'fork' && e.to === 'north' ? { ...e, terrain } : e)),
    terrain: { ...level.terrain, [terrain]: { speed: 1, detection: 1, ...(weight ? { weight } : {}) } },
  };
}

describe('Terrain Weight', () => {
  it('reads a unit weight from its capacity unless the catalog sets one', () => {
    expect(unitWeight({ capacity: 1 })).toBe('light');
    expect(unitWeight({ capacity: 2 })).toBe('medium');
    expect(unitWeight({ capacity: 3 })).toBe('heavy');
    expect(unitWeight({ capacity: 3, weight: 'light' })).toBe('light');
  });

  it('bogs heavy units down in mud while light units keep their pace', () => {
    const weight = { light: 1, heavy: 0.5 };
    const truckPlain = arrival(
      newMatch(heavyNorth('mud', undefined)),
      order({ unitTypeId: 'truck', count: 1 }),
    );
    const truckMud = arrival(newMatch(heavyNorth('mud', weight)), order({ unitTypeId: 'truck', count: 1 }));
    const walkerPlain = arrival(newMatch(heavyNorth('mud', undefined)), order({ count: 1 }));
    const walkerMud = arrival(newMatch(heavyNorth('mud', weight)), order({ count: 1 }));
    expect(truckMud).toBeGreaterThan(truckPlain * 1.2);
    expect(walkerMud).toBe(walkerPlain);
  });

  it('counts a level without the heavy ground as cover', () => {
    const level = fixtureLevel();
    const asCover = arrival(
      newMatch({
        edges: level.edges.map((e) =>
          e.from === 'fork' && e.to === 'north' ? { ...e, terrain: 'cover' } : e,
        ),
      }),
      order({ count: 1 }),
    );
    const missing = arrival(
      newMatch({
        edges: level.edges.map((e) => (e.from === 'fork' && e.to === 'north' ? { ...e, terrain: 'mud' } : e)),
      }),
      order({ count: 1 }),
    );
    expect(missing).toBe(asCover);
  });
});

/** The fixture with a narrow crossing on the north route's last stretch (north to the goal). */
function narrowNorth(capacity: number): Partial<SimLevel> {
  const level = fixtureLevel();
  return {
    edges: level.edges.map((e) => (e.from === 'north' && e.to === 'goal' ? { ...e, capacity } : e)),
  };
}

describe('Route Capacity', () => {
  it('slows a group that is wider than a crossing and moves it as a column', () => {
    const fits = arrival(newMatch(narrowNorth(4)), order({ count: 4, formation: 'spread' }));
    const packed = arrival(newMatch(narrowNorth(4)), order({ count: 12, formation: 'spread' }));
    expect(packed).toBeGreaterThan(fits * 1.3);
    // The same wide group on an open stretch is not slowed.
    const open = arrival(newMatch(), order({ count: 12, formation: 'spread' }));
    expect(open).toBeLessThan(packed);
  });

  it('lets groups wait in front of a full crossing, marked as crowded', () => {
    const match = newMatch(narrowNorth(3));
    runUntil(match, () => match.phase === 'combat');
    send(match, {
      type: 'launchWave',
      side: 'attacker',
      groups: [order({ count: 3 }), order({ count: 3 })],
    } as Omit<Command, 'tick'>);
    let queued = false;
    let together = false;
    runUntil(match, () => {
      const field = groups(match);
      // While one group is on the crossing, the other stands at its near end.
      const onCrossing = field.filter((g) => g.leg === 2 && g.legDistance > 0);
      const waiting = field.filter((g) => g.leg === 2 && g.legDistance === 0 && g.state === 'moving');
      if (onCrossing.length === 2) together = true;
      if (onCrossing.length === 1 && waiting.length === 1 && waiting[0]!.statuses.includes('crowded'))
        queued = true;
      return field.every((g) => g.state === 'atObjective');
    });
    expect(queued).toBe(true);
    expect(together).toBe(false);
  });

  it('turns back more members of groups packed on a full crossing', () => {
    const pressedGroups = (capacity: number | undefined) => {
      const match = newMatch(capacity === undefined ? {} : narrowNorth(capacity));
      send(match, {
        type: 'placeDefense',
        side: 'defender',
        defenseTypeId: 'post',
        nodeId: 'north-zone',
      } as Omit<Command, 'tick'>);
      runUntil(match, () => match.phase === 'combat');
      send(match, {
        type: 'launchWave',
        side: 'attacker',
        groups: [order({ count: 4 }), order({ count: 4 })],
      } as Omit<Command, 'tick'>);
      runUntil(
        match,
        () => groups(match).every((g) => g.state === 'atObjective') || groups(match).length === 0,
        60,
      );
      return match.events.all().filter((e) => e.type === 'memberTurnedBack').length;
    };
    // Packed on a full crossing, both groups stay longer in the post's reach and share its pressure.
    expect(pressedGroups(2)).toBeGreaterThan(pressedGroups(undefined));
  });
});
