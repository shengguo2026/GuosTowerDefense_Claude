import { describe, expect, it } from 'vitest';
import {
  AMBUSH_SIGHT,
  Match,
  contactFactor,
  secondsToTicks,
  type Command,
  type WaveGroupOrder,
} from './index';
import { fixtureSetup } from './testFixture';
import type { CloseContact, DefenseEntity, GroupEntity, SimDefenseType, SimLevel } from './types';
import type { VisionArea } from './vision';

// M13 Rhinoceros: Close Contact (pressure by distance, sight at close range) and Ambush Zones.

function newMatch(level: Partial<SimLevel> = {}, defenses: SimDefenseType[] = []): Match {
  const setup = fixtureSetup({}, level);
  setup.defender.defenses.push(...defenses);
  setup.level.startingResources.attacker = 1000;
  // A post that presses hard enough to turn walkers back as they pass.
  setup.defender.defenses = setup.defender.defenses.map((d) =>
    d.id === 'post' ? { ...d, pressurePerSecond: 4 } : d,
  );
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
  count: 6,
  formation: 'column',
  routeId: 'north',
  delaySeconds: 0,
  ...overrides,
});

function groups(match: Match, viewer: 'attacker' | 'defender' | null = null): GroupEntity[] {
  return match.snapshot(viewer).entities.filter((e): e is GroupEntity => e.kind === 'group');
}

function defenses(match: Match, viewer: 'attacker' | 'defender' | null = null): DefenseEntity[] {
  return match.snapshot(viewer).entities.filter((e): e is DefenseEntity => e.kind === 'defense');
}

/** Builds a post beside the north route, sends one wave along it and counts the members turned back. */
function playPast(match: Match, defenseTypeId = 'post', wave: WaveGroupOrder[] = [order()]): number {
  send(match, { type: 'placeDefense', side: 'defender', defenseTypeId, nodeId: 'north-zone' } as Omit<
    Command,
    'tick'
  >);
  runUntil(match, () => match.phase === 'combat');
  send(match, { type: 'launchWave', side: 'attacker', groups: wave } as Omit<Command, 'tick'>);
  runUntil(
    match,
    () => groups(match).every((g) => g.state === 'atObjective') || groups(match).length === 0,
    60,
  );
  return match.events.all().filter((e) => e.type === 'memberTurnedBack').length;
}

/** An Ambush Zone around the north build zone (20, 13), reaching the north route at (20, 10). */
const thicket: VisionArea = {
  id: 'thicket',
  kind: 'thicket',
  circle: { x: 20, z: 13, radius: 4 },
  los: 'partial',
  cover: 0.5,
  exposure: 0.6,
  vantage: 1,
  ambush: true,
};

describe('Close Contact', () => {
  it('scales pressure by distance: near within the range, far beyond it', () => {
    const contact: CloseContact = { range: 6, near: 1.3, far: 0.6 };
    expect(contactFactor(contact, 5)).toBe(1.3);
    expect(contactFactor(contact, 6)).toBe(1.3);
    expect(contactFactor(contact, 6.5)).toBe(0.6);
    expect(contactFactor(undefined, 50)).toBe(1);
  });

  it('turns back more members when assets press harder up close, none when they cannot press from afar', () => {
    const plain = playPast(newMatch());
    const close = playPast(newMatch({ closeContact: { range: 100, near: 3, far: 3 } }));
    const farOnly = playPast(newMatch({ closeContact: { range: 0.1, near: 1, far: 0 } }));
    expect(plain).toBeGreaterThan(0);
    expect(close).toBeGreaterThan(plain);
    expect(farOnly).toBe(0);
  });

  it('detects a group at close range that the asset would not see at all otherwise', () => {
    // A post that only sees one step ahead but reaches eight: without Close Contact it never finds a target.
    const blind: SimDefenseType = {
      ...fixtureSetup().defender.defenses[0]!,
      id: 'blind',
      pressurePerSecond: 4,
      detectionRange: 0.5,
    };
    const without = playPast(newMatch({}, [blind]), 'blind');
    const withContact = playPast(newMatch({ closeContact: { range: 6, near: 1, far: 1 } }, [blind]), 'blind');
    expect(without).toBe(0);
    expect(withContact).toBeGreaterThan(0);
  });
});

describe('Ambush Zones', () => {
  it('keeps an asset in the zone hidden from the Attacker until a group is very close', () => {
    /** How far from the post the walkers are when the Attacker first sees it (Infinity: never). */
    const firstSeen = (area: VisionArea) => {
      const match = newMatch({ vision: [area] });
      send(match, {
        type: 'placeDefense',
        side: 'defender',
        defenseTypeId: 'post',
        nodeId: 'north-zone',
      } as Omit<Command, 'tick'>);
      expect(defenses(match, 'defender')[0]?.statuses.includes('hidden')).toBe(area.ambush === true);
      runUntil(match, () => match.phase === 'combat');
      send(match, { type: 'launchWave', side: 'attacker', groups: [order({ count: 12 })] } as Omit<
        Command,
        'tick'
      >);
      let seenAt = Infinity;
      runUntil(
        match,
        () => {
          const group = groups(match)[0];
          if (!group || group.state === 'atObjective') return true;
          if (defenses(match, 'attacker').length === 0) return false;
          seenAt = Math.hypot(group.x - 20, group.z - 13);
          return true;
        },
        60,
      );
      return seenAt;
    };
    // Walkers see 12 far; through the thicket's cover a plain post shows up well before they pass it.
    expect(firstSeen({ ...thicket, ambush: false })).toBeGreaterThan(12 * AMBUSH_SIGHT);
    const hidden = firstSeen(thicket);
    expect(hidden === Infinity || hidden <= 12 * AMBUSH_SIGHT).toBe(true);
  });

  it('springs once per asset and group: the group stops and takes more pressure', () => {
    const ambushed = newMatch({ vision: [thicket] });
    const turnedBackInAmbush = playPast(ambushed);
    const events = ambushed.events.all().filter((e) => e.type === 'groupAmbushed');
    expect(events).toHaveLength(1);
    // The same thicket without the ambush flag: the same cover, no surprise.
    const plain = newMatch({ vision: [{ ...thicket, ambush: false }] });
    const turnedBackPlain = playPast(plain);
    expect(plain.events.all().some((e) => e.type === 'groupAmbushed')).toBe(false);
    expect(turnedBackInAmbush).toBeGreaterThan(turnedBackPlain);
  });

  it('shows the surprise on the group while it lasts', () => {
    const match = newMatch({ vision: [thicket] });
    send(match, {
      type: 'placeDefense',
      side: 'defender',
      defenseTypeId: 'post',
      nodeId: 'north-zone',
    } as Omit<Command, 'tick'>);
    runUntil(match, () => match.phase === 'combat');
    send(match, { type: 'launchWave', side: 'attacker', groups: [order({ count: 12 })] } as Omit<
      Command,
      'tick'
    >);
    runUntil(match, () => match.events.all().some((e) => e.type === 'groupAmbushed'), 60);
    expect(groups(match, 'attacker')[0]?.statuses).toEqual(expect.arrayContaining(['ambushed', 'pinned']));
    expect(groups(match, 'defender')[0]?.statuses).toContain('ambushed');
  });

  it('does not spring when the Attacker has already uncovered the asset', () => {
    const match = newMatch({ vision: [thicket] });
    send(match, {
      type: 'placeDefense',
      side: 'defender',
      defenseTypeId: 'post',
      nodeId: 'north-zone',
    } as Omit<Command, 'tick'>);
    runUntil(match, () => match.phase === 'combat');
    send(match, { type: 'launchWave', side: 'attacker', groups: [order({ count: 12 })] } as Omit<
      Command,
      'tick'
    >);
    // Reconnaissance over the thicket just before the group gets there; it lasts while the group walks past.
    runUntil(match, () => (groups(match)[0]?.x ?? 0) >= 12, 60);
    send(match, { type: 'useAbility', side: 'attacker', abilityId: 'recon', x: 20, z: 12 } as Omit<
      Command,
      'tick'
    >);
    runUntil(match, () => groups(match).length === 0 || groups(match)[0]!.state === 'atObjective', 60);
    expect(match.events.all().some((e) => e.type === 'groupAmbushed')).toBe(false);
  });
});
