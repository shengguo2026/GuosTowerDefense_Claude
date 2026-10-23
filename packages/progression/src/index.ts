import type { Difficulty } from '@gtd/ai';
import type { MatchResult, Side, SideStats } from '@gtd/sim';

/**
 * Score, profile XP and profile levels (spec §12, masterplan §32, §58, §59). Pure rules: the server uses them to award
 * a finished match, the client to show levels and progress bars. Kept apart on purpose: score rates one match, XP
 * builds up a profile, and neither unlocks levels or difficulties.
 */

/** Bumped when the numbers below change, so a save knows which rules its scores were made with. */
export const BALANCE_VERSION = 1;

/** Who a side played against: the computer at a difficulty, or a person (hot-seat, Wi-Fi). */
export type Opponent = Difficulty | 'human';

/** How a side did in a finished match: the input for its score and XP. */
export interface SideOutcome {
  side: Side;
  result: MatchResult;
  stats: SideStats;
  /** Share of the match timer left at the end, 0–1. */
  timeLeft: number;
  /** Share of the Attacker's deployment capacity never sent, 0–1. */
  capacityLeft: number;
  opponent: Opponent;
}

// ---- Score ----

/** A stronger opponent is worth more (masterplan §58: data-driven, to be tuned through testing). */
export const DIFFICULTY_MULTIPLIER: Record<Opponent, number> = {
  easy: 1,
  medium: 1.25,
  hard: 1.5,
  human: 1.25,
};

export interface ScoreBreakdown {
  base: number;
  primary: number;
  /** Secondary objectives: none of the current levels has one yet, so this stays 0 until they arrive. */
  secondary: number;
  efficiency: number;
  tactical: number;
  multiplier: number;
  total: number;
}

const ratio = (part: number, whole: number) => (whole > 0 ? Math.min(1, Math.max(0, part / whole)) : 0);
const capped = (value: number, cap: number) => Math.min(cap, Math.max(0, value));

/**
 * (base + primary performance + secondary objectives + efficiency + tactical bonuses) × difficulty multiplier.
 * The Attacker is rated on objective progress, troops that came through, capacity and time left; the Defender on
 * protecting the objective, members turned back, a quick end and assets that held. Taking defenses apart only adds a
 * small, capped bonus, so it never dominates the Attacker's score.
 */
export function computeScore(outcome: SideOutcome): ScoreBreakdown {
  const won = outcome.result.winner === outcome.side;
  const a = outcome.stats.attacker;
  const d = outcome.stats.defender;
  const base = won ? 1000 : 250;
  let primary: number;
  let efficiency: number;
  let tactical: number;
  if (outcome.side === 'attacker') {
    const cameThrough = ratio(a.membersLaunched - a.membersTurnedBack, a.membersLaunched);
    primary = 1500 * a.bestObjectiveProgress + 500 * cameThrough;
    efficiency = won ? 300 * outcome.capacityLeft + 500 * outcome.timeLeft : 0;
    tactical =
      capped(a.checkpointsPassed * 10, 300) + capped((a.defensesDisrupted + a.defensesDismantled) * 20, 200);
  } else {
    const assetsHeld = ratio(
      d.structuresBuilt + d.patrolsDeployed - a.defensesDismantled,
      d.structuresBuilt + d.patrolsDeployed,
    );
    primary = 1500 * (1 - a.bestObjectiveProgress) + 500 * ratio(d.membersTurnedBack, a.membersLaunched);
    efficiency = (won ? 500 * outcome.timeLeft : 0) + 300 * assetsHeld;
    tactical = capped(d.wavesStopped * 40, 300) + capped(d.groupsIdentified * 15, 200);
  }
  const multiplier = DIFFICULTY_MULTIPLIER[outcome.opponent];
  const parts = {
    base,
    primary: Math.round(primary),
    secondary: 0,
    efficiency: Math.round(efficiency),
    tactical: Math.round(tactical),
  };
  const total = Math.round(
    (parts.base + parts.primary + parts.secondary + parts.efficiency + parts.tactical) * multiplier,
  );
  return { ...parts, multiplier, total };
}

// ---- XP ----

export interface XpBreakdown {
  completion: number;
  victory: number;
  difficulty: number;
  secondary: number;
  /** Earned by playing the profile (waves, builds, detections), capped so long matches do not farm XP. */
  actions: number;
  total: number;
}

export const DIFFICULTY_XP: Record<Opponent, number> = { easy: 0, medium: 40, hard: 80, human: 40 };
export const ACTION_XP_CAP = 100;

/** Completion + victory bonus + difficulty bonus + secondary + capped profile actions. A loss still earns XP. */
export function computeXp(outcome: SideOutcome): XpBreakdown {
  const won = outcome.result.winner === outcome.side;
  const a = outcome.stats.attacker;
  const d = outcome.stats.defender;
  const rawActions =
    outcome.side === 'attacker'
      ? a.wavesLaunched * 6 + a.checkpointsPassed * 2 + a.defensesDisrupted * 4
      : d.structuresBuilt * 5 + d.patrolsDeployed * 5 + d.groupsIdentified * 3 + d.wavesStopped * 4;
  const parts = {
    completion: 100,
    victory: won ? 100 : 0,
    difficulty: won ? DIFFICULTY_XP[outcome.opponent] : Math.round(DIFFICULTY_XP[outcome.opponent] / 2),
    secondary: 0,
    actions: capped(Math.round(rawActions), ACTION_XP_CAP),
  };
  return {
    ...parts,
    total: parts.completion + parts.victory + parts.difficulty + parts.secondary + parts.actions,
  };
}

// ---- Profile levels ----

/** XP needed for each profile level: level 1 at 0, level 5 (the last) at 3000. XP is stored; the level is derived. */
export const LEVEL_XP = [0, 400, 1000, 1800, 3000] as const;
export const MAX_LEVEL = LEVEL_XP.length;

export function levelForXp(xp: number): number {
  let level = 1;
  LEVEL_XP.forEach((needed, index) => {
    if (xp >= needed) level = index + 1;
  });
  return level;
}

export interface LevelProgress {
  level: number;
  /** XP earned since the current level was reached. */
  into: number;
  /** XP the current level spans; `null` at the last level. */
  span: number | null;
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelForXp(xp);
  const start = LEVEL_XP[level - 1] as number;
  const next = LEVEL_XP[level];
  return { level, into: xp - start, span: next === undefined ? null : next - start };
}
