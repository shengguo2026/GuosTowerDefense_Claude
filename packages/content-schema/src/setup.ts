import type { MatchSetup } from '@gtd/sim';
import type { StagePack } from './schema';

export interface MatchChoice {
  levelId: string;
  attackerProfileId: string;
  defenderProfileId: string;
  seed: number;
}

/** Turns stage-pack data into the plain input the simulation runs on. */
export function createMatchSetup(pack: StagePack, choice: MatchChoice): MatchSetup {
  const level = pack.levels.find((l) => l.id === choice.levelId);
  if (!level) throw new Error(`Stage "${pack.manifest.id}" has no level "${choice.levelId}"`);
  const attacker = findProfile(pack, choice.attackerProfileId, 'attacker');
  const defender = findProfile(pack, choice.defenderProfileId, 'defender');
  return {
    seed: choice.seed,
    level: {
      id: level.id,
      timerSeconds: level.timerSeconds,
      objective: level.objective,
      nodes: level.map.nodes,
      edges: level.map.edges,
      routes: level.routes,
      startingResources: level.startingResources,
      incomePerSecond: level.incomePerSecond,
    },
    attacker: {
      profileId: attacker.id,
      units: pack.catalog.units
        .filter((unit) => attacker.units.includes(unit.id))
        .map(({ id, speed, cost, resilience }) => ({ id, speed, cost, resilience })),
    },
    defender: {
      profileId: defender.id,
      defenses: pack.catalog.defenses
        .filter((defense) => defender.defenses.includes(defense.id))
        .map(({ id, cost, range, pressurePerSecond }) => ({ id, cost, range, pressurePerSecond })),
    },
  };
}

function findProfile(pack: StagePack, id: string, side: 'attacker' | 'defender') {
  const profile = pack.profiles.find((p) => p.id === id);
  if (!profile || profile.side !== side)
    throw new Error(`Stage "${pack.manifest.id}" has no ${side} profile "${id}"`);
  return profile;
}
