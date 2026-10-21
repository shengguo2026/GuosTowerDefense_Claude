import type { MatchSetup, SimAbility, SimEffect } from '@gtd/sim';
import type { Action, Effect, StagePack } from './schema';

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
        .map(({ name: _name, icon: _icon, description: _description, model: _model, ...unit }) => unit),
      abilities: abilitiesOf(pack, attacker.abilities),
      commands: commandsOf(pack, attacker.commands),
      passive: attacker.passive.effects.map(effectOf),
    },
    defender: {
      profileId: defender.id,
      defenses: pack.catalog.defenses
        .filter((defense) => defender.defenses.includes(defense.id))
        .map(
          ({
            name: _name,
            icon: _icon,
            description: _description,
            model: _model,
            detectionRange,
            maxCount,
            lifetimeSeconds,
            ...defense
          }) => ({
            ...defense,
            detectionRange: detectionRange ?? defense.range,
            ...(maxCount === undefined ? {} : { maxCount }),
            ...(lifetimeSeconds === undefined ? {} : { lifetimeSeconds }),
          }),
        ),
      abilities: abilitiesOf(pack, defender.abilities),
      commands: commandsOf(pack, defender.commands),
      passive: defender.passive.effects.map(effectOf),
    },
  };
}

function abilitiesOf(pack: StagePack, ids: string[]): SimAbility[] {
  return pack.catalog.abilities.filter((ability) => ids.includes(ability.id)).map(actionOf);
}

/** Command slots keep the profile's order: it is the key order (X C V B N M). */
function commandsOf(pack: StagePack, ids: string[]): SimAbility[] {
  return ids
    .map((id) => pack.catalog.commands.find((command) => command.id === id))
    .filter((command) => command !== undefined)
    .map(actionOf);
}

function actionOf(action: Action): SimAbility {
  const { id, target, effects, order, range, durationSeconds, cost, cooldownSeconds } = action;
  return {
    id,
    target,
    effects: effects.map(effectOf),
    ...(order === undefined ? {} : { order }),
    range,
    durationSeconds,
    cost,
    cooldownSeconds,
  };
}

function effectOf(effect: Effect): SimEffect {
  const out: SimEffect = { type: effect.type };
  if (effect.magnitude !== undefined) out.magnitude = effect.magnitude;
  if (effect.stat !== undefined) out.stat = effect.stat;
  if (effect.condition !== undefined) out.condition = effect.condition;
  if (effect.spawn !== undefined) out.spawn = effect.spawn;
  if (effect.pool !== undefined) out.pool = effect.pool;
  return out;
}

function findProfile(pack: StagePack, id: string, side: 'attacker' | 'defender') {
  const profile = pack.profiles.find((p) => p.id === id);
  if (!profile || profile.side !== side)
    throw new Error(`Stage "${pack.manifest.id}" has no ${side} profile "${id}"`);
  return profile;
}
