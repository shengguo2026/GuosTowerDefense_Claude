import type { MatchSetup, SimAbility, SimEffect, VisionArea } from '@gtd/sim';
import type { Action, Effect, Profile, Rank, StagePack, VisionAreaData } from './schema';

export interface MatchChoice {
  levelId: string;
  attackerProfileId: string;
  defenderProfileId: string;
  seed: number;
  /** Profile XP levels of the sides a person plays (G11); a side left out plays the starting kit. */
  ranks?: ProfileLevels;
}

/** The profile level each side plays with, 1 (starting kit) to PROFILE_LEVELS. */
export type ProfileLevels = Partial<Record<'attacker' | 'defender', number>>;

/** The ranks a profile has unlocked at a profile level, lowest first. */
export function unlockedRanks(profile: Profile, level: number): Rank[] {
  return profile.ranks.filter((rank) => rank.level <= level).sort((a, b) => a.level - b.level);
}

/**
 * The stage pack as a match with these profile levels plays it: the catalog entries the sides' unlocked ranks improve
 * carry the improved numbers. The server builds the match from it, and the HUD shows costs and cooldowns from it.
 */
export function withRanks(
  pack: StagePack,
  profiles: { attackerProfileId: string; defenderProfileId: string },
  levels: ProfileLevels | undefined,
): StagePack {
  const ranks = (['attacker', 'defender'] as const).flatMap((side) => {
    const level = levels?.[side] ?? 1;
    const id = side === 'attacker' ? profiles.attackerProfileId : profiles.defenderProfileId;
    const profile = pack.profiles.find((p) => p.id === id && p.side === side);
    return profile && level > 1 ? unlockedRanks(profile, level) : [];
  });
  if (ranks.length === 0) return pack;
  const improve = <T extends { id: string }>(entry: T, target: string | undefined, rank: Rank): T => {
    if (entry.id !== target) return entry;
    const next: Record<string, unknown> = { ...entry };
    for (const [key, factor] of Object.entries(rank.changes)) {
      if (key === 'magnitude' && 'effects' in entry) {
        next.effects = (entry.effects as Effect[]).map((effect) =>
          effect.magnitude === undefined
            ? effect
            : { ...effect, magnitude: round(effect.magnitude * factor) },
        );
      } else if (typeof next[key] === 'number') {
        // Costs stay whole numbers, so the HUD never shows a fraction of a supply or point.
        const value = (next[key] as number) * factor;
        next[key] = key === 'cost' ? Math.round(value) : round(value);
      } else if (key === 'detectionRange' && typeof next.range === 'number') {
        // A defense without its own detection range detects as far as it reaches.
        next.detectionRange = round((next.range as number) * factor);
      }
    }
    return next as T;
  };
  let { units, defenses, abilities } = pack.catalog;
  for (const rank of ranks) {
    units = units.map((unit) => improve(unit, rank.unit, rank));
    defenses = defenses.map((defense) => improve(defense, rank.defense, rank));
    abilities = abilities.map((ability) => improve(ability, rank.ability, rank));
  }
  return { ...pack, catalog: { ...pack.catalog, units, defenses, abilities } };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Turns stage-pack data into the plain input the simulation runs on. */
export function createMatchSetup(basePack: StagePack, choice: MatchChoice): MatchSetup {
  const pack = withRanks(basePack, choice, choice.ranks);
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
      vision: level.vision.map(toVisionArea),
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

export function toVisionArea(area: VisionAreaData): VisionArea {
  const { id, kind, circle, wall, los, cover, exposure, vantage } = area;
  return {
    id,
    kind,
    ...(circle ? { circle } : {}),
    ...(wall ? { wall: { width: wall.width, points: wall.points.map(([x, z]) => ({ x, z })) } } : {}),
    los,
    cover,
    exposure,
    vantage,
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
