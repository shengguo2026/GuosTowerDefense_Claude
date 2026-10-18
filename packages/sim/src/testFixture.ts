import type { MatchSetup, SimDefenseType, SimLevel } from './types';

/**
 * A small level for the simulation's own tests: the spawn leads to a fork, where a north and a south route split and
 * meet again at the goal. North is open ground, south has cover. Build zones sit beside each branch.
 *
 *            north (checkpoint)
 *          /                    \
 *   spawn - fork                  goal
 *          \                    /
 *            south
 */
export function fixtureLevel(overrides: Partial<SimLevel> = {}): SimLevel {
  return {
    id: 'fixture',
    timerSeconds: 120,
    preparationSeconds: 5,
    objective: { nodeId: 'goal', holdSeconds: 5, radius: 4 },
    nodes: [
      { id: 'spawn', x: 0, z: 0, kind: 'spawn' },
      { id: 'fork', x: 10, z: 0, kind: 'junction' },
      { id: 'north', x: 20, z: 10, kind: 'checkpoint' },
      { id: 'south', x: 20, z: -10 },
      { id: 'goal', x: 30, z: 0, kind: 'objective' },
      { id: 'north-zone', x: 20, z: 13, kind: 'buildZone', buildable: true },
      { id: 'south-zone', x: 20, z: -14, kind: 'buildZone', buildable: true },
      { id: 'goal-zone', x: 30, z: 8, kind: 'buildZone', buildable: true },
    ],
    edges: [
      { from: 'spawn', to: 'fork', terrain: 'cover' },
      { from: 'fork', to: 'north', terrain: 'open' },
      { from: 'north', to: 'goal', terrain: 'open' },
      { from: 'fork', to: 'south', terrain: 'cover' },
      { from: 'south', to: 'goal', terrain: 'cover' },
    ],
    routes: [
      { id: 'north', nodes: ['spawn', 'fork', 'north', 'goal'] },
      { id: 'south', nodes: ['spawn', 'fork', 'south', 'goal'] },
    ],
    deploymentCapacity: 20,
    launchCooldownSeconds: 3,
    maxActiveWaves: 2,
    startingResources: { attacker: 200, defender: 200 },
    incomePerSecond: { attacker: 1, defender: 1 },
    startingPoints: { attacker: 50, defender: 50 },
    pointsPerSecond: { attacker: 0.5, defender: 0.5 },
    bonuses: { checkpointPass: 10, memberTurnedBack: 2, waveStopped: 20, retreatRefund: 0.5 },
    terrain: { open: { speed: 1.2, detection: 1.3 }, cover: { speed: 0.8, detection: 0.6 } },
    ...overrides,
  };
}

const structure = (overrides: Partial<SimDefenseType> & Pick<SimDefenseType, 'id'>): SimDefenseType => ({
  cost: 40,
  mobile: false,
  placement: 'buildZone',
  range: 8,
  detectionRange: 12,
  pressurePerSecond: 1,
  slow: 0,
  speed: 0,
  blocksNode: false,
  maxLevel: 3,
  upgradeCostFactor: 0.75,
  wearPerMemberSecond: 0,
  ...overrides,
});

export const FIXTURE_DEFENSES: SimDefenseType[] = [
  structure({ id: 'post', cost: 50, range: 8, detectionRange: 14, pressurePerSecond: 1 }),
  structure({
    id: 'barrier',
    cost: 30,
    placement: 'any',
    range: 4,
    detectionRange: 6,
    pressurePerSecond: 3,
    slow: 0.4,
    blocksNode: true,
    wearPerMemberSecond: 5,
  }),
  structure({
    id: 'patrol',
    cost: 40,
    mobile: true,
    placement: 'routeNode',
    range: 4,
    detectionRange: 8,
    pressurePerSecond: 2,
    speed: 5,
  }),
];

/** Two routes, one unit type per role, every Stage 1 ability shape, no passives. */
export function fixtureSetup(overrides: Partial<MatchSetup> = {}, level: Partial<SimLevel> = {}): MatchSetup {
  return {
    seed: 42,
    level: fixtureLevel(level),
    attacker: {
      profileId: 'scout',
      units: [
        {
          id: 'walker',
          speed: 4,
          cost: 10,
          capacity: 1,
          resilience: 3,
          visibility: 'normal',
          sightRange: 12,
        },
        {
          id: 'sneaker',
          speed: 3,
          cost: 15,
          capacity: 2,
          resilience: 4,
          visibility: 'stealth',
          sightRange: 8,
        },
      ],
      abilities: [
        {
          id: 'recon',
          target: 'area',
          effects: [{ type: 'reveal' }],
          range: 10,
          durationSeconds: 5,
          cost: 10,
          cooldownSeconds: 20,
        },
        {
          id: 'reroute',
          target: 'route',
          effects: [{ type: 'move' }],
          range: 0,
          durationSeconds: 0,
          cost: 10,
          cooldownSeconds: 20,
        },
      ],
      passive: [],
    },
    defender: {
      profileId: 'keeper',
      defenses: FIXTURE_DEFENSES,
      abilities: [
        {
          id: 'response',
          target: 'area',
          effects: [{ type: 'boost', magnitude: 0.5 }],
          range: 10,
          durationSeconds: 5,
          cost: 10,
          cooldownSeconds: 20,
        },
        {
          id: 'intercept',
          target: 'unit',
          effects: [{ type: 'slow', magnitude: 0.5 }],
          range: 10,
          durationSeconds: 3,
          cost: 10,
          cooldownSeconds: 20,
        },
      ],
      passive: [],
    },
    ...overrides,
  };
}
