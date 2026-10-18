import type { MatchSetup, SimAbility, SimEffect } from '@gtd/sim';
import type { Effect, StagePack } from './schema';

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
      preparationSeconds: level.preparationSeconds,
      objective: level.objective,
      nodes: level.map.nodes,
      edges: level.map.edges,
      routes: level.routes,
      deploymentCapacity: level.deploymentCapacity,
      launchCooldownSeconds: level.launchCooldownSeconds,
      maxActiveWaves: level.maxActiveWaves,
      startingResources: level.startingResources,
      incomePerSecond: level.incomePerSecond,
      startingPoints: level.startingPoints,
      pointsPerSecond: level.pointsPerSecond,
      bonuses: level.bonuses,
      terrain: level.terrain,
    },
    attacker: {
      profileId: attacker.id,
      units: pack.catalog.units
        .filter((unit) => attacker.units.includes(unit.id))
        .map(({ name: _name, ...unit }) => unit),
      abilities: abilitiesOf(pack, attacker.abilities),
      passive: attacker.passive.effects.map(effectOf),
    },
    defender: {
      profileId: defender.id,
      defenses: pack.catalog.defenses
        .filter((defense) => defender.defenses.includes(defense.id))
        .map(({ name: _name, detectionRange, maxCount, ...defense }) => ({
          ...defense,
          detectionRange: detectionRange ?? defense.range,
          ...(maxCount === undefined ? {} : { maxCount }),
        })),
      abilities: abilitiesOf(pack, defender.abilities),
      passive: defender.passive.effects.map(effectOf),
    },
  };
}

function abilitiesOf(pack: StagePack, ids: string[]): SimAbility[] {
  return pack.catalog.abilities
    .filter((ability) => ids.includes(ability.id))
    .map(({ id, target, effects, range, durationSeconds, cost, cooldownSeconds }) => ({
      id,
      target,
      effects: effects.map(effectOf),
      range,
      durationSeconds,
      cost,
      cooldownSeconds,
    }));
}

function effectOf(effect: Effect): SimEffect {
  const out: SimEffect = { type: effect.type };
  if (effect.magnitude !== undefined) out.magnitude = effect.magnitude;
  if (effect.stat !== undefined) out.stat = effect.stat;
  if (effect.condition !== undefined) out.condition = effect.condition;
  return out;
}

function findProfile(pack: StagePack, id: string, side: 'attacker' | 'defender') {
  const profile = pack.profiles.find((p) => p.id === id);
  if (!profile || profile.side !== side)
    throw new Error(`Stage "${pack.manifest.id}" has no ${side} profile "${id}"`);
  return profile;
}
