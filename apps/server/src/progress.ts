import type { Difficulty } from '@gtd/ai';
import type { StagePack } from '@gtd/content-schema';
import { computeScore, computeXp, levelForXp, type Opponent, type SideOutcome } from '@gtd/progression';
import { HIGH_SCORES_KEPT, type HighScore, type MatchMode, type SideReward } from '@gtd/protocol';
import { TICK_RATE, type MatchEvent, type MatchSetup, type MatchSnapshot, type Side } from '@gtd/sim';
import { recordWin, type SaveData } from './saveManager';

const SIDES: readonly Side[] = ['attacker', 'defender'];

/** Who played a side of a finished match. */
export interface PlayedSide {
  profileId: string;
  /** A person's side earns XP and high scores, also if the computer stood in while their device was away. */
  controller: 'human' | 'ai';
  name: string;
}

/** A finished match as the save needs it (tutorials and debug matches never get here). */
export interface FinishedMatch {
  stageId: string;
  levelId: string;
  mode: MatchMode;
  /** How well the computer played its side; `null` when people played both sides. */
  difficulty: Difficulty | null;
  sides: Record<Side, PlayedSide>;
  /** The end state in the full view (result, stats, time and capacity left). */
  snapshot: MatchSnapshot;
  timerSeconds: number;
  /** Counted from the event log: what the stats in the snapshot do not hold. */
  counts: { reroutes: number; patrolInterceptions: number; abilitiesUsed: Record<Side, number> };
  playSeconds: number;
}

/** Reads a finished match out of the simulation: end state, timer and the counts taken from its event log. */
export function finishedMatch(
  base: Omit<FinishedMatch, 'snapshot' | 'timerSeconds' | 'counts' | 'playSeconds'>,
  setup: MatchSetup,
  snapshot: MatchSnapshot,
  events: readonly MatchEvent[],
): FinishedMatch {
  const mobile = new Set(setup.defender.defenses.filter((d) => d.mobile).map((d) => d.id));
  const patrols = new Set<number>();
  const counts: FinishedMatch['counts'] = {
    reroutes: 0,
    patrolInterceptions: 0,
    abilitiesUsed: { attacker: 0, defender: 0 },
  };
  for (const event of events) {
    if (event.type === 'defensePlaced' && mobile.has(event.defenseTypeId)) patrols.add(event.defenseId);
    else if (event.type === 'groupRerouted') counts.reroutes++;
    else if (event.type === 'memberTurnedBack' && patrols.has(event.byDefenseId))
      counts.patrolInterceptions++;
    else if (event.type === 'abilityUsed') counts.abilitiesUsed[event.side]++;
  }
  return {
    ...base,
    snapshot,
    timerSeconds: setup.level.timerSeconds,
    counts,
    playSeconds: Math.round(snapshot.tick / TICK_RATE),
  };
}

/**
 * Writes a finished match into the save (spec §12): score for both sides, XP and high scores for the sides people
 * played, statistics, and a win against the computer unlocks the next level. Returns what each side got.
 */
export function applyMatch(
  save: SaveData,
  match: FinishedMatch,
  pack: StagePack | undefined,
  date: string,
): Partial<Record<Side, SideReward>> {
  const { snapshot, sides } = match;
  const result = snapshot.result;
  if (!result) return {};
  const timerTicks = match.timerSeconds * TICK_RATE;
  const rewards: Partial<Record<Side, SideReward>> = {};
  const stats = save.statistics;
  stats.matchesPlayed++;
  stats.matches1v1++;
  stats[
    match.mode === 'single'
      ? 'singlePlayerMatches'
      : match.mode === 'hotSeat'
        ? 'hotSeatMatches'
        : 'wifiMatches'
  ]++;
  stats.playSeconds += match.playSeconds;

  for (const side of SIDES) {
    const played = sides[side];
    const other = sides[side === 'attacker' ? 'defender' : 'attacker'];
    const opponent: Opponent = other.controller === 'ai' && match.difficulty ? match.difficulty : 'human';
    const outcome: SideOutcome = {
      side,
      result,
      stats: snapshot.stats,
      timeLeft: timerTicks > 0 ? Math.min(1, snapshot.remainingTicks / timerTicks) : 0,
      capacityLeft: snapshot.capacity.total > 0 ? snapshot.capacity.remaining / snapshot.capacity.total : 0,
      opponent,
    };
    const score = computeScore(outcome);
    const reward: SideReward = {
      profileId: played.profileId,
      controller: played.controller,
      opponent,
      score,
      xp: null,
      highScorePlace: null,
    };
    rewards[side] = reward;
    if (played.controller !== 'human') continue;

    const won = result.winner === side;
    // XP: only people's profiles earn it (AI-controlled profiles get none, masterplan §59).
    const profile = ((save.profiles[match.stageId] ??= {})[played.profileId] ??= { xp: 0 });
    const gained = computeXp(outcome);
    const before = profile.xp;
    profile.xp += gained.total;
    const [levelBefore, levelAfter] = [levelForXp(before), levelForXp(profile.xp)];
    const ranks = pack?.profiles.find((p) => p.id === played.profileId)?.ranks ?? [];
    reward.xp = {
      gained,
      before,
      after: profile.xp,
      unlocked: ranks
        .map((rank) => rank.level)
        .filter((level) => level > levelBefore && level <= levelAfter)
        .sort((a, b) => a - b),
    };

    // High scores, per stage, level, side, opponent and team size.
    const entry: HighScore = {
      stageId: match.stageId,
      levelId: match.levelId,
      side,
      opponent,
      teamSize: 1,
      score: score.total,
      players: [{ name: played.name, profileId: played.profileId, controller: played.controller }],
      mode: match.mode,
      won,
      date,
    };
    const sameList = (h: HighScore) =>
      h.stageId === entry.stageId &&
      h.levelId === entry.levelId &&
      h.side === entry.side &&
      h.opponent === entry.opponent &&
      h.teamSize === entry.teamSize;
    // A tie keeps the older score ahead.
    const list = [...save.highScores.filter(sameList), entry]
      .sort((a, b) => b.score - a.score)
      .slice(0, HIGH_SCORES_KEPT);
    const place = list.indexOf(entry);
    reward.highScorePlace = place >= 0 ? place + 1 : null;
    save.highScores = [...save.highScores.filter((h) => !sameList(h)), ...list];

    // Statistics for the side a person played.
    stats[won ? 'wins' : 'losses']++;
    if (won) stats[side === 'attacker' ? 'attackerWins' : 'defenderWins']++;
    stats.profileUsage[played.profileId] = (stats.profileUsage[played.profileId] ?? 0) + 1;
    stats.abilitiesUsed += match.counts.abilitiesUsed[side];
    stats.bestScore = Math.max(stats.bestScore, score.total);
    const { attacker: a, defender: d } = snapshot.stats;
    if (side === 'attacker') {
      stats.wavesLaunched += a.wavesLaunched;
      stats.reroutes += match.counts.reroutes;
      stats.defensesDisrupted += a.defensesDisrupted;
      stats.defensesDismantled += a.defensesDismantled;
    } else {
      stats.attackersStopped += d.membersTurnedBack;
      stats.patrolInterceptions += match.counts.patrolInterceptions;
      stats.detections += d.groupsIdentified;
      stats.defensesBuilt += d.structuresBuilt + d.patrolsDeployed;
    }

    // A win against the computer completes the level (unlocking the next) and records the difficulty.
    if (won && opponent !== 'human') recordWin(save, match.stageId, match.levelId, side, opponent);
  }
  return rewards;
}
