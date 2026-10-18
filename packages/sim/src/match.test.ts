import { describe, expect, it } from 'vitest';
import { Match, hashValue, secondsToTicks, type Command, type WaveGroupOrder } from './index';
import { fixtureSetup } from './testFixture';
import type { DefenseEntity, GroupEntity, MatchSetup, SimLevel } from './types';

type CommandInput = Command extends infer C ? (C extends Command ? Omit<C, 'tick'> : never) : never;

function newMatch(overrides: Partial<MatchSetup> = {}, level: Partial<SimLevel> = {}): Match {
  return new Match(fixtureSetup(overrides, level));
}

/** Sends a command for the next tick and runs that tick. */
function send(match: Match, command: CommandInput): void {
  match.enqueue({ ...command, tick: match.tick + 1 } as Command);
  match.step();
}

function run(match: Match, seconds: number): void {
  const ticks = secondsToTicks(seconds);
  for (let i = 0; i < ticks && !match.isOver; i++) match.step();
}

function runUntil(match: Match, done: () => boolean, maxSeconds = 300): void {
  for (let i = 0; i < secondsToTicks(maxSeconds) && !match.isOver && !done(); i++) match.step();
}

function skipPreparation(match: Match): void {
  runUntil(match, () => match.phase === 'combat');
}

const order = (overrides: Partial<WaveGroupOrder> = {}): WaveGroupOrder => ({
  unitTypeId: 'walker',
  count: 2,
  formation: 'column',
  routeId: 'north',
  delaySeconds: 0,
  ...overrides,
});

function launch(match: Match, ...groups: WaveGroupOrder[]): void {
  send(match, { type: 'launchWave', side: 'attacker', groups: groups.length ? groups : [order()] });
}

function place(match: Match, defenseTypeId: string, nodeId: string): void {
  send(match, { type: 'placeDefense', side: 'defender', defenseTypeId, nodeId });
}

function rejections(match: Match): string[] {
  return match.events.all().flatMap((e) => (e.type === 'commandRejected' ? [e.reason] : []));
}

function groups(match: Match): GroupEntity[] {
  return match.snapshot().entities.filter((e): e is GroupEntity => e.kind === 'group');
}

function defenses(match: Match): DefenseEntity[] {
  return match.snapshot().entities.filter((e): e is DefenseEntity => e.kind === 'defense');
}

function group(match: Match, id: number): GroupEntity | undefined {
  return groups(match).find((g) => g.id === id);
}

function eventsOf<T extends Command['type'] | string>(match: Match, type: T) {
  return match.events.all().filter((e) => e.type === type);
}

describe('phases and waves', () => {
  it('lets the Defender build during preparation but holds launches until combat starts', () => {
    const match = newMatch();
    expect(match.phase).toBe('preparation');
    place(match, 'post', 'north-zone');
    launch(match);
    expect(defenses(match)).toHaveLength(1);
    expect(groups(match)).toHaveLength(0);
    expect(rejections(match)).toEqual(['preparation']);
    skipPreparation(match);
    expect(eventsOf(match, 'combatStarted')).toHaveLength(1);
    launch(match);
    expect(groups(match)).toHaveLength(1);
  });

  it('launches a wave of several groups, spending supplies and deployment capacity', () => {
    const match = newMatch();
    skipPreparation(match);
    const before = match.snapshot();
    launch(match, order({ count: 3 }), order({ unitTypeId: 'sneaker', count: 2, routeId: 'south', formation: 'spread' }));
    const after = match.snapshot();
    expect(groups(match).map((g) => [g.unitTypeId, g.count, g.routeId, g.formation])).toEqual([
      ['walker', 3, 'north', 'column'],
      ['sneaker', 2, 'south', 'spread'],
    ]);
    expect(after.capacity.remaining).toBe(before.capacity.remaining - (3 * 1 + 2 * 2));
    // 3 × 10 + 2 × 15 supplies, plus one tick of income.
    expect(after.resources.attacker).toBeCloseTo((before.resources.attacker as number) - 60 + 0.05, 5);
    expect(after.activeWaves).toBe(1);
  });

  it('keeps a delayed group waiting at the spawn point until its launch delay is over', () => {
    const match = newMatch();
    skipPreparation(match);
    launch(match, order(), order({ delaySeconds: 2 }));
    run(match, 1);
    const [first, second] = groups(match);
    expect(first?.state).toBe('moving');
    expect(second?.state).toBe('waiting');
    expect(second?.x).toBe(0);
    run(match, 1.1);
    expect(group(match, second!.id)?.state).toBe('moving');
  });

  it('enforces launch cooldown, the overlapping-wave limit, capacity and valid orders', () => {
    const match = newMatch({}, { launchCooldownSeconds: 2, maxActiveWaves: 1, deploymentCapacity: 5 });
    skipPreparation(match);
    launch(match, order({ count: 6 }));
    launch(match, order({ count: 0 }));
    launch(match, order({ delaySeconds: 99 }));
    launch(match, order({ unitTypeId: 'nobody' }));
    launch(match, order({ routeId: 'nowhere' }));
    launch(match, order({ formation: 'wedge' as never }));
    send(match, { type: 'launchWave', side: 'attacker', groups: [] });
    send(match, { type: 'launchWave', side: 'defender', groups: [order()] } as never);
    launch(match, order());
    launch(match, order());
    run(match, 2);
    launch(match, order());
    expect(rejections(match)).toEqual([
      'notEnoughCapacity',
      'invalidCount',
      'invalidDelay',
      'unknownUnit',
      'unknownRoute',
      'unknownFormation',
      'invalidWave',
      'wrongSide',
      'launchCooldown',
      'tooManyWaves',
    ]);
  });

  it('rejects a wave the Attacker cannot pay for', () => {
    const match = newMatch({}, { startingResources: { attacker: 15, defender: 0 } });
    skipPreparation(match);
    launch(match, order({ count: 3 }));
    expect(rejections(match)).toEqual(['notEnoughResources']);
  });
});

describe('movement on the route graph', () => {
  it('walks open ground faster than cover (Open Ground Exposure)', () => {
    const timeTo = (routeId: string) => {
      const match = newMatch();
      skipPreparation(match);
      launch(match, order({ routeId }));
      const start = match.tick;
      runUntil(match, () => groups(match)[0]?.state === 'atObjective');
      return match.tick - start;
    };
    expect(timeTo('north')).toBeLessThan(timeTo('south') * 0.8);
  });

  it('moves a column faster than a spread formation, and formations can change in the field', () => {
    const distanceAfter = (formation: 'column' | 'spread', switchTo?: 'column') => {
      const match = newMatch();
      skipPreparation(match);
      launch(match, order({ formation }));
      if (switchTo) send(match, { type: 'setFormation', side: 'attacker', groupId: groups(match)[0]!.id, formation: switchTo });
      run(match, 2);
      return groups(match)[0]!.x;
    };
    expect(distanceAfter('column')).toBeGreaterThan(distanceAfter('spread'));
    expect(distanceAfter('spread', 'column')).toBeCloseTo(distanceAfter('column'), 0);
  });

  it('holds at the next junction, reroutes there, and advances again', () => {
    const match = newMatch();
    skipPreparation(match);
    launch(match);
    const id = groups(match)[0]!.id;
    send(match, { type: 'holdGroup', side: 'attacker', groupId: id });
    send(match, { type: 'rerouteGroup', side: 'attacker', groupId: id, routeId: 'south' });
    runUntil(match, () => group(match, id)?.state === 'holding');
    expect(group(match, id)).toMatchObject({ x: 10, z: 0, state: 'holding' });
    run(match, 2);
    expect(group(match, id)?.x).toBe(10);
    send(match, { type: 'rerouteGroup', side: 'attacker', groupId: id, routeId: 'south' });
    send(match, { type: 'advanceGroup', side: 'attacker', groupId: id });
    run(match, 1);
    expect(group(match, id)?.routeId).toBe('south');
    expect(group(match, id)?.z).toBeLessThan(0);
    // No junction is left ahead on the south branch.
    send(match, { type: 'holdGroup', side: 'attacker', groupId: id });
    expect(rejections(match)).toEqual(['notHoldingAtJunction', 'noJunctionAhead']);
  });

  it('pays the Attacker a bonus the first time a group passes a checkpoint', () => {
    const match = newMatch();
    skipPreparation(match);
    launch(match);
    runUntil(match, () => eventsOf(match, 'checkpointPassed').length > 0);
    expect(eventsOf(match, 'checkpointPassed')[0]).toMatchObject({ nodeId: 'north', bonus: 10 });
    expect(match.snapshot().stats.attacker.checkpointsPassed).toBe(1);
  });

  it('retreats a group to the spawn point and refunds part of its capacity and supplies', () => {
    const match = newMatch();
    skipPreparation(match);
    launch(match, order({ count: 4 }));
    const id = groups(match)[0]!.id;
    run(match, 2);
    send(match, { type: 'retreatGroup', side: 'attacker', groupId: id });
    expect(group(match, id)?.state).toBe('retreating');
    const capacityBefore = match.snapshot().capacity.remaining;
    runUntil(match, () => !group(match, id));
    expect(eventsOf(match, 'groupLeft')[0]).toMatchObject({ count: 4, refundCapacity: 2, refundSupplies: 20 });
    expect(match.snapshot().capacity.remaining).toBe(capacityBefore + 2);
    expect(match.snapshot().stats.attacker.membersRetreated).toBe(4);
  });

  it('lets a waiting group leave at once when it is called back', () => {
    const match = newMatch();
    skipPreparation(match);
    launch(match, order({ delaySeconds: 10 }));
    send(match, { type: 'retreatGroup', side: 'attacker', groupId: groups(match)[0]!.id });
    expect(groups(match)).toHaveLength(0);
    expect(eventsOf(match, 'groupLeft')).toHaveLength(1);
  });
});

describe('detection', () => {
  it('detects stealthy groups on open ground but not under cover', () => {
    const detectedOn = (routeId: string, zone: string) => {
      const match = newMatch();
      place(match, 'post', zone);
      skipPreparation(match);
      launch(match, order({ unitTypeId: 'sneaker', count: 1, routeId }));
      runUntil(match, () => groups(match)[0]?.state === 'atObjective');
      return eventsOf(match, 'groupDetected').length > 0;
    };
    expect(detectedOn('north', 'north-zone')).toBe(true);
    expect(detectedOn('south', 'south-zone')).toBe(false);
  });

  it('goes from Unknown to Detected to Identified, and back to Unknown after leaving range', () => {
    const match = newMatch({}, { objective: { nodeId: 'goal', holdSeconds: 60, radius: 4 } });
    place(match, 'post', 'north-zone');
    send(match, { type: 'setPriority', side: 'defender', defenseId: 1, priority: 'first' });
    skipPreparation(match);
    launch(match, order({ count: 9 }));
    const id = groups(match)[0]!.id;
    expect(match.snapshot('defender').entities.filter((e) => e.kind === 'group')).toHaveLength(0);
    runUntil(match, () => group(match, id)?.detection === 'detected');
    const detected = match.snapshot('defender').entities.find((e) => e.id === id) as GroupEntity;
    expect(detected).toMatchObject({ unitTypeId: '', count: 0 });
    runUntil(match, () => group(match, id)?.detection === 'identified');
    expect(eventsOf(match, 'groupIdentified')).toHaveLength(1);
    const identified = match.snapshot('defender').entities.find((e) => e.id === id) as GroupEntity;
    expect(identified.unitTypeId).toBe('walker');
    // Walk back out of range: lost again three seconds after the last sighting.
    send(match, { type: 'retreatGroup', side: 'attacker', groupId: id });
    runUntil(match, () => group(match, id)?.detection === 'unknown' || !group(match, id));
    expect(eventsOf(match, 'groupLost')).toHaveLength(1);
  });

  it('never applies pressure to a group the Defender has not detected', () => {
    const match = newMatch();
    place(match, 'post', 'south-zone');
    skipPreparation(match);
    launch(match, order({ unitTypeId: 'sneaker', count: 1, routeId: 'south' }));
    runUntil(match, () => groups(match)[0]?.state === 'atObjective');
    expect(groups(match)[0]?.pressure).toBe(0);
  });
});

describe('defenses and the non-lethal outcome', () => {
  it('turns members back one at a time and pays the Defender for it', () => {
    const match = newMatch();
    place(match, 'post', 'goal-zone');
    skipPreparation(match);
    launch(match, order({ count: 3 }));
    const supplies = match.snapshot().resources.defender as number;
    runUntil(match, () => eventsOf(match, 'memberTurnedBack').length > 0);
    expect(eventsOf(match, 'memberTurnedBack')[0]).toMatchObject({ remaining: 2, byDefenseId: 1 });
    expect(groups(match)[0]?.count).toBe(2);
    expect(match.snapshot().resources.defender as number).toBeGreaterThan(supplies + 2 - 0.01);
  });

  it('stops a whole wave and pays the wave bonus', () => {
    const match = newMatch();
    place(match, 'barrier', 'north');
    skipPreparation(match);
    launch(match, order({ count: 1 }));
    runUntil(match, () => groups(match).length === 0);
    expect(eventsOf(match, 'groupStopped')).toHaveLength(1);
    expect(eventsOf(match, 'waveStopped')[0]).toMatchObject({ waveId: 1, bonus: 20 });
    expect(match.snapshot().stats.defender.wavesStopped).toBe(1);
  });

  it('picks targets by priority and lets a focus target override it', () => {
    const setUp = () => {
      const match = newMatch({}, { objective: { nodeId: 'goal', holdSeconds: 99, radius: 4 } });
      place(match, 'post', 'goal-zone');
      skipPreparation(match);
      launch(match, order({ count: 1 }), order({ count: 5 }));
      runUntil(match, () => groups(match).every((g) => g.state === 'atObjective' && g.detection === 'identified'));
      return match;
    };
    const targetOf = (match: Match) => defenses(match)[0]?.targetGroupId;
    const strongest = setUp();
    send(strongest, { type: 'setPriority', side: 'defender', defenseId: 1, priority: 'strongest' });
    expect(targetOf(strongest)).toBe(3);
    const weakest = setUp();
    send(weakest, { type: 'setPriority', side: 'defender', defenseId: 1, priority: 'weakest' });
    expect(targetOf(weakest)).toBe(2);
    send(weakest, { type: 'focusTarget', side: 'defender', defenseId: 1, groupId: 3 });
    expect(targetOf(weakest)).toBe(3);
    send(weakest, { type: 'setPriority', side: 'defender', defenseId: 1, priority: 'loudest' as never });
    expect(rejections(weakest)).toEqual(['unknownPriority']);
  });

  it('refuses a focus target that is hidden or out of range', () => {
    const match = newMatch();
    place(match, 'post', 'goal-zone');
    skipPreparation(match);
    launch(match, order({ count: 1 }));
    send(match, { type: 'focusTarget', side: 'defender', defenseId: 1, groupId: 2 });
    runUntil(match, () => groups(match)[0]?.detection !== 'unknown');
    send(match, { type: 'focusTarget', side: 'defender', defenseId: 1, groupId: 2 });
    expect(rejections(match)).toEqual(['notVisible', 'outOfRange']);
  });

  it('places structures only where their type allows', () => {
    const match = newMatch();
    place(match, 'post', 'north');
    place(match, 'post', 'north-zone');
    place(match, 'barrier', 'north-zone');
    place(match, 'barrier', 'spawn');
    place(match, 'barrier', 'goal');
    place(match, 'patrol', 'spawn');
    place(match, 'patrol', 'north-zone');
    place(match, 'patrol', 'goal');
    place(match, 'nothing', 'north');
    place(match, 'post', 'nowhere');
    expect(rejections(match)).toEqual([
      'notBuildable',
      'occupied',
      'notBuildable',
      'notBuildable',
      'notBuildable',
      'notBuildable',
      'unknownDefense',
      'unknownNode',
    ]);
    expect(defenses(match).map((d) => [d.defenseTypeId, d.nodeId])).toEqual([
      ['post', 'north-zone'],
      ['patrol', 'goal'],
    ]);
  });

  it('never lets the Defender block every route', () => {
    const match = newMatch();
    place(match, 'barrier', 'fork');
    place(match, 'barrier', 'north');
    place(match, 'barrier', 'south');
    expect(rejections(match)).toEqual(['wouldBlockAllRoutes', 'wouldBlockAllRoutes']);
    expect(defenses(match).map((d) => [d.nodeId, d.blocking])).toEqual([['north', true]]);
  });

  it('stops groups at a roadblock until they wear it down, and refuses a repair that would close every route', () => {
    const match = newMatch({}, { startingResources: { attacker: 500, defender: 500 } });
    place(match, 'barrier', 'north');
    skipPreparation(match);
    launch(match, order({ count: 12, formation: 'spread' }));
    const id = groups(match)[0]!.id;
    runUntil(match, () => group(match, id)?.state === 'blocked');
    expect(eventsOf(match, 'groupBlocked')[0]).toMatchObject({ nodeId: 'north', defenseId: 1 });
    runUntil(match, () => eventsOf(match, 'defenseDisrupted').length > 0);
    expect(defenses(match)[0]).toMatchObject({ condition: 0, blocking: false });
    run(match, 0.2);
    expect(group(match, id)?.state).toBe('moving');
    // With the north barrier disrupted, the south branch may be closed; repairing north would then close both.
    place(match, 'barrier', 'south');
    send(match, { type: 'repairDefense', side: 'defender', defenseId: 1 });
    expect(rejections(match)).toEqual(['wouldBlockAllRoutes']);
    send(match, { type: 'sellDefense', side: 'defender', defenseId: 3 });
    send(match, { type: 'repairDefense', side: 'defender', defenseId: 1 });
    expect(defenses(match)[0]?.blocking).toBe(true);
    expect(defenses(match)[0]?.condition).toBeGreaterThan(90);
  });

  it('slows groups inside a checkpoint’s reach', () => {
    const progress = (withBarrier: boolean) => {
      const match = newMatch();
      if (withBarrier) place(match, 'barrier', 'north-zone');
      skipPreparation(match);
      launch(match, order({ count: 9 }));
      runUntil(match, () => (groups(match)[0]?.x ?? 0) >= 17);
      run(match, 0.75);
      return groups(match)[0]!;
    };
    const slowed = progress(true);
    expect(slowed.slowed).toBe(true);
    expect(slowed.x).toBeLessThan(progress(false).x);
  });

  it('upgrades, repairs and sells', () => {
    const match = newMatch({}, { startingResources: { attacker: 0, defender: 300 } });
    place(match, 'post', 'north-zone');
    send(match, { type: 'upgradeDefense', side: 'defender', defenseId: 1 });
    send(match, { type: 'upgradeDefense', side: 'defender', defenseId: 1 });
    send(match, { type: 'upgradeDefense', side: 'defender', defenseId: 1 });
    send(match, { type: 'repairDefense', side: 'defender', defenseId: 1 });
    const post = defenses(match)[0]!;
    // 50 build + 50 × 0.75 × 1 + 50 × 0.75 × 2.
    expect(post).toMatchObject({ level: 3, spent: 163 });
    expect(rejections(match)).toEqual(['maxLevel', 'notDamaged']);
    const before = match.snapshot().resources.defender as number;
    send(match, { type: 'sellDefense', side: 'defender', defenseId: 1 });
    expect(defenses(match)).toHaveLength(0);
    expect((match.snapshot().resources.defender as number) - before).toBeCloseTo(82 + 0.05, 5);
    expect(match.snapshot().stats.defender.upgrades).toBe(2);
  });

  it('reaches further after an upgrade', () => {
    const firstPressure = (upgrade: boolean) => {
      const match = newMatch({}, { startingResources: { attacker: 200, defender: 500 } });
      place(match, 'post', 'goal-zone');
      if (upgrade) send(match, { type: 'upgradeDefense', side: 'defender', defenseId: 1 });
      skipPreparation(match);
      launch(match, order({ count: 9 }));
      runUntil(match, () => (groups(match)[0]?.pressure ?? 0) > 0);
      return groups(match)[0]!.x;
    };
    expect(firstPressure(true)).toBeLessThan(firstPressure(false));
  });
});

describe('patrols', () => {
  it('guards a node and patrols back and forth between two nodes', () => {
    const match = newMatch();
    place(match, 'patrol', 'fork');
    send(match, { type: 'orderDefense', side: 'defender', defenseId: 1, order: { type: 'guard', nodeId: 'goal' } });
    run(match, 8);
    expect(defenses(match)[0]).toMatchObject({ nodeId: 'goal', x: 30, z: 0 });
    send(match, {
      type: 'orderDefense',
      side: 'defender',
      defenseId: 1,
      order: { type: 'patrol', nodeIds: ['north', 'south'] },
    });
    const visited = new Set<string>();
    for (let i = 0; i < secondsToTicks(30); i++) {
      match.step();
      visited.add(defenses(match)[0]!.nodeId);
    }
    expect(visited).toEqual(new Set(['goal', 'north', 'fork', 'south']));
    send(match, { type: 'orderDefense', side: 'defender', defenseId: 1, order: { type: 'guard', nodeId: 'north-zone' } });
    place(match, 'post', 'north-zone');
    send(match, { type: 'orderDefense', side: 'defender', defenseId: 2, order: { type: 'guard', nodeId: 'goal' } });
    expect(rejections(match)).toEqual(['invalidOrder', 'notMobile']);
  });

  it('contests the objective: hold progress pauses while a patrol is in the zone', () => {
    const match = newMatch({}, { objective: { nodeId: 'goal', holdSeconds: 30, radius: 4 } });
    skipPreparation(match);
    launch(match, order({ unitTypeId: 'sneaker', count: 3 }));
    runUntil(match, () => groups(match)[0]?.state === 'atObjective');
    run(match, 2);
    const held = match.snapshot().objective.heldTicks;
    expect(held).toBeGreaterThan(0);
    place(match, 'patrol', 'goal');
    run(match, 2);
    expect(match.snapshot().objective).toMatchObject({ contested: true });
    expect(match.snapshot().objective.heldTicks).toBeLessThanOrEqual(held + 1);
  });

  it('moves faster under Rapid Response', () => {
    const travelled = (boost: boolean) => {
      const match = newMatch();
      place(match, 'patrol', 'fork');
      if (boost) send(match, { type: 'useAbility', side: 'defender', abilityId: 'response', x: 10, z: 0 });
      send(match, { type: 'orderDefense', side: 'defender', defenseId: 1, order: { type: 'guard', nodeId: 'goal' } });
      run(match, 2);
      return defenses(match)[0]!.x;
    };
    expect(travelled(true)).toBeGreaterThan(travelled(false) + 3);
  });
});

describe('abilities', () => {
  it('Reconnaissance reveals structures in an area; the Attacker remembers them afterwards', () => {
    const match = newMatch();
    place(match, 'post', 'south-zone');
    expect(match.snapshot('attacker').entities).toHaveLength(0);
    send(match, { type: 'useAbility', side: 'attacker', abilityId: 'recon', x: 20, z: -12 });
    expect(match.snapshot('attacker').entities).toMatchObject([{ kind: 'defense', remembered: false }]);
    run(match, 6);
    expect(match.snapshot('attacker').entities).toMatchObject([{ kind: 'defense', remembered: true }]);
    expect(match.snapshot().areaEffects).toHaveLength(0);
  });

  it('spends points, respects cooldowns, and rejects abilities the side does not have', () => {
    const match = newMatch({}, { startingPoints: { attacker: 25, defender: 0 } });
    send(match, { type: 'useAbility', side: 'attacker', abilityId: 'recon', x: 0, z: 0 });
    expect(match.snapshot().cooldowns.recon).toBeGreaterThan(0);
    expect(match.snapshot().areaEffects).toHaveLength(1);
    send(match, { type: 'useAbility', side: 'attacker', abilityId: 'recon', x: 0, z: 0 });
    send(match, { type: 'useAbility', side: 'attacker', abilityId: 'intercept', groupId: 1 });
    send(match, { type: 'useAbility', side: 'defender', abilityId: 'response', x: 0, z: 0 });
    send(match, { type: 'useAbility', side: 'attacker', abilityId: 'reroute' });
    expect(rejections(match)).toEqual(['cooldown', 'unknownAbility', 'notEnoughPoints', 'missingTarget']);
  });

  it('Rapid Reroute switches route at the next junction without stopping', () => {
    const match = newMatch();
    skipPreparation(match);
    launch(match);
    const id = groups(match)[0]!.id;
    send(match, { type: 'useAbility', side: 'attacker', abilityId: 'reroute', groupId: id, routeId: 'south' });
    expect(group(match, id)?.pendingRouteId).toBe('south');
    runUntil(match, () => group(match, id)?.routeId === 'south');
    expect(eventsOf(match, 'groupHolding')).toHaveLength(0);
    run(match, 0.5);
    expect(group(match, id)?.state).toBe('moving');
    // Past the fork there is nowhere left to switch.
    const second = newMatch();
    skipPreparation(second);
    launch(second);
    run(second, 4);
    send(second, { type: 'useAbility', side: 'attacker', abilityId: 'reroute', groupId: groups(second)[0]!.id, routeId: 'south' });
    expect(rejections(second)).toEqual(['noJunctionAhead']);
  });

  it('Rapid Reroute sends a holding group on along the new route at once', () => {
    const match = newMatch();
    skipPreparation(match);
    launch(match);
    const id = groups(match)[0]!.id;
    send(match, { type: 'holdGroup', side: 'attacker', groupId: id });
    runUntil(match, () => group(match, id)?.state === 'holding');
    send(match, { type: 'useAbility', side: 'attacker', abilityId: 'reroute', groupId: id, routeId: 'south' });
    expect(group(match, id)).toMatchObject({ routeId: 'south', state: 'moving' });
  });

  it('Intercept slows a detected group within reach of a Defender asset', () => {
    const position = (intercept: boolean) => {
      const match = newMatch({}, { objective: { nodeId: 'goal', holdSeconds: 60, radius: 4 } });
      place(match, 'post', 'north-zone');
      skipPreparation(match);
      launch(match, order({ count: 20 }));
      runUntil(match, () => (groups(match)[0]?.x ?? 0) >= 15);
      if (intercept) send(match, { type: 'useAbility', side: 'defender', abilityId: 'intercept', groupId: 2 });
      else match.step();
      run(match, 2);
      return groups(match)[0]!;
    };
    const slowed = position(true);
    expect(slowed.slowed).toBe(true);
    expect(slowed.x).toBeLessThan(position(false).x - 2);
  });

  it('refuses Intercept on an undetected group', () => {
    const match = newMatch();
    place(match, 'post', 'goal-zone');
    skipPreparation(match);
    launch(match);
    send(match, { type: 'useAbility', side: 'defender', abilityId: 'intercept', groupId: 2 });
    expect(rejections(match)).toEqual(['notVisible']);
  });

  it('runs resource abilities and rejects effects the engine does not support yet', () => {
    const setup = fixtureSetup();
    setup.attacker.abilities.push(
      { id: 'drop', target: 'self', effects: [{ type: 'resource', magnitude: 30 }], range: 0, durationSeconds: 0, cost: 0, cooldownSeconds: 10 },
      { id: 'wall', target: 'junction', effects: [{ type: 'blockBranch' }], range: 0, durationSeconds: 5, cost: 0, cooldownSeconds: 10 },
    );
    const match = new Match(setup);
    const before = match.snapshot().resources.attacker as number;
    send(match, { type: 'useAbility', side: 'attacker', abilityId: 'drop' });
    send(match, { type: 'useAbility', side: 'attacker', abilityId: 'wall' });
    expect((match.snapshot().resources.attacker as number) - before).toBeCloseTo(30.1, 5);
    expect(rejections(match)).toEqual(['unsupportedEffect']);
  });
});

describe('passives', () => {
  it('Trail Knowledge speeds up groups on a route an earlier wave already used', () => {
    const secondWaveSpeed = (passive: boolean) => {
      const setup = fixtureSetup();
      if (passive) setup.attacker.passive = [{ type: 'boost', stat: 'speed', magnitude: 0.1, condition: 'knownRoute' }];
      const match = new Match(setup);
      skipPreparation(match);
      launch(match, order({ count: 1 }));
      const firstStart = groups(match)[0]!.x;
      run(match, 3);
      const firstMoved = groups(match)[0]!.x - firstStart;
      launch(match, order({ count: 1 }));
      run(match, 2.95);
      return { first: firstMoved, second: groups(match)[1]!.x };
    };
    const without = secondWaveSpeed(false);
    const withPassive = secondWaveSpeed(true);
    expect(withPassive.first).toBeCloseTo(without.first, 5);
    expect(withPassive.second / without.second).toBeCloseTo(1.1, 2);
  });

  it('Field Awareness extends detection range', () => {
    const firstDetection = (passive: boolean) => {
      const setup = fixtureSetup();
      if (passive) setup.defender.passive = [{ type: 'boost', stat: 'detectionRange', magnitude: 0.3 }];
      const match = new Match(setup);
      place(match, 'post', 'goal-zone');
      skipPreparation(match);
      launch(match);
      runUntil(match, () => groups(match)[0]?.detection !== 'unknown');
      return match.tick;
    };
    expect(firstDetection(true)).toBeLessThan(firstDetection(false));
  });
});

describe('information for each side', () => {
  it('shows the Attacker structures it has seen and patrols only while in sight', () => {
    const match = newMatch();
    place(match, 'post', 'north-zone');
    place(match, 'patrol', 'south');
    skipPreparation(match);
    expect(match.snapshot('attacker').entities.filter((e) => e.kind === 'defense')).toHaveLength(0);
    launch(match, order({ count: 9 }));
    runUntil(match, () => groups(match)[0]?.state === 'atObjective');
    const seen = match.snapshot('attacker').entities.filter((e): e is DefenseEntity => e.kind === 'defense');
    expect(seen.map((d) => d.defenseTypeId)).toContain('post');
    // The group retreats out of sight: the post stays remembered, the patrol vanishes.
    send(match, { type: 'retreatGroup', side: 'attacker', groupId: groups(match)[0]!.id });
    runUntil(match, () => groups(match).length === 0);
    const remembered = match.snapshot('attacker').entities as DefenseEntity[];
    expect(remembered.map((d) => [d.defenseTypeId, d.remembered])).toEqual([['post', true]]);
  });

  it('hides the opponent’s supplies, points and cooldowns', () => {
    const match = newMatch();
    const attackerView = match.snapshot('attacker');
    expect(Object.keys(attackerView.resources)).toEqual(['attacker']);
    expect(Object.keys(attackerView.points)).toEqual(['attacker']);
    expect(Object.keys(attackerView.cooldowns)).toEqual(['recon', 'reroute']);
    expect(Object.keys(match.snapshot('defender').resources)).toEqual(['defender']);
  });
});

describe('victory and defeat', () => {
  it('ends with an Attacker win when a group holds the objective long enough', () => {
    const match = newMatch();
    skipPreparation(match);
    launch(match);
    runUntil(match, () => false);
    expect(match.result).toEqual({ winner: 'attacker', reason: 'objectiveCompleted' });
    expect(match.snapshot().stats.attacker.bestObjectiveProgress).toBe(1);
    expect(match.snapshot().phase).toBe('ended');
  });

  it('ends with a Defender win when the timer runs out', () => {
    const match = newMatch({}, { timerSeconds: 10 });
    runUntil(match, () => false);
    expect(match.result).toEqual({ winner: 'defender', reason: 'timerExpired' });
    expect(match.tick).toBe(secondsToTicks(15));
  });

  it('ends with a Defender win when the Attacker’s capacity is used up and nobody is left', () => {
    const match = newMatch({}, { deploymentCapacity: 2 });
    place(match, 'barrier', 'north');
    skipPreparation(match);
    launch(match, order({ count: 2 }));
    runUntil(match, () => false);
    expect(match.result).toEqual({ winner: 'defender', reason: 'capacityExhausted' });
    const stats = match.snapshot().stats;
    expect(stats.attacker.membersTurnedBack).toBe(2);
    expect(stats.defender.membersTurnedBack).toBe(2);
  });

  it('does nothing after the match has ended', () => {
    const match = newMatch({}, { timerSeconds: 1 });
    runUntil(match, () => false);
    const tick = match.tick;
    match.step();
    expect(match.tick).toBe(tick);
  });

  it('is deterministic for the same seed and commands', () => {
    const play = () => {
      const match = newMatch();
      place(match, 'post', 'north-zone');
      place(match, 'patrol', 'fork');
      skipPreparation(match);
      launch(match, order({ count: 3 }), order({ routeId: 'south', delaySeconds: 1, formation: 'spread' }));
      runUntil(match, () => false);
      return hashValue(match.events.all());
    };
    expect(play()).toBe(play());
  });
});
