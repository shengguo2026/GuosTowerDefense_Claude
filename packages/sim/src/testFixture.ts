import type { MatchSetup } from './types';

/** A tiny two-route level used by the simulation's own unit tests. */
export function fixtureSetup(overrides: Partial<MatchSetup> = {}): MatchSetup {
  return {
    seed: 42,
    level: {
      id: 'fixture',
      timerSeconds: 60,
      objective: { nodeId: 'goal', holdSeconds: 5 },
      nodes: [
        { id: 'spawn', x: 0, z: 0 },
        { id: 'north', x: 10, z: 10, buildable: true },
        { id: 'south', x: 10, z: -10, buildable: true },
        { id: 'goal', x: 20, z: 0 },
      ],
      edges: [
        { from: 'spawn', to: 'north' },
        { from: 'north', to: 'goal' },
        { from: 'spawn', to: 'south' },
        { from: 'south', to: 'goal' },
      ],
      routes: [
        { id: 'north', nodes: ['spawn', 'north', 'goal'] },
        { id: 'south', nodes: ['spawn', 'south', 'goal'] },
      ],
      startingResources: { attacker: 100, defender: 100 },
      incomePerSecond: { attacker: 1, defender: 1 },
    },
    attacker: { profileId: 'scout', units: [{ id: 'walker', speed: 4, cost: 10, resilience: 3 }] },
    defender: { profileId: 'keeper', defenses: [{ id: 'post', cost: 40, range: 4, pressurePerSecond: 6 }] },
    ...overrides,
  };
}
