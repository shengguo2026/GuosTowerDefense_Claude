import type { SideStats } from '@gtd/sim';
import { describe, expect, it } from 'vitest';
import { computeScore, computeXp, levelForXp, levelProgress, MAX_LEVEL, type SideOutcome } from './index';

function stats(): SideStats {
  return {
    attacker: {
      wavesLaunched: 6,
      membersLaunched: 40,
      membersReachedObjective: 10,
      membersTurnedBack: 20,
      membersRetreated: 2,
      checkpointsPassed: 12,
      capacityUsed: 40,
      defensesDisrupted: 3,
      defensesDismantled: 1,
      bestObjectiveProgress: 0.6,
    },
    defender: {
      membersTurnedBack: 20,
      wavesStopped: 3,
      structuresBuilt: 5,
      patrolsDeployed: 2,
      upgrades: 1,
      groupsIdentified: 8,
      abilitiesUsed: 4,
    },
  };
}

function outcome(
  side: 'attacker' | 'defender',
  winner: 'attacker' | 'defender',
  opponent: SideOutcome['opponent'] = 'medium',
): SideOutcome {
  return {
    side,
    result: { winner, reason: winner === 'attacker' ? 'objectiveCompleted' : 'timerExpired' },
    stats: stats(),
    timeLeft: 0.25,
    capacityLeft: 0.2,
    opponent,
  };
}

describe('score', () => {
  it('rates a win above a loss and adds up its parts', () => {
    const win = computeScore(outcome('defender', 'defender'));
    const loss = computeScore(outcome('attacker', 'defender'));
    expect(win.total).toBeGreaterThan(loss.total);
    const sum = win.base + win.primary + win.secondary + win.efficiency + win.tactical;
    expect(win.total).toBe(Math.round(sum * win.multiplier));
  });

  it('is worth more against a stronger computer', () => {
    expect(computeScore(outcome('attacker', 'attacker', 'hard')).total).toBeGreaterThan(
      computeScore(outcome('attacker', 'attacker', 'easy')).total,
    );
  });

  it('never lets taking defenses apart dominate the Attacker score', () => {
    const many = outcome('attacker', 'attacker');
    many.stats.attacker.defensesDismantled = 500;
    expect(computeScore(many).tactical).toBeLessThanOrEqual(500);
  });
});

describe('XP', () => {
  it('gives a loss some XP and caps profile actions', () => {
    const loss = computeXp(outcome('attacker', 'defender'));
    expect(loss.total).toBeGreaterThan(0);
    expect(loss.victory).toBe(0);
    const farm = outcome('attacker', 'attacker', 'hard');
    farm.stats.attacker.wavesLaunched = 1000;
    expect(computeXp(farm).actions).toBe(100);
    expect(computeXp(farm).total).toBe(100 + 100 + 80 + 100);
  });
});

describe('profile levels', () => {
  it('derives five levels from XP', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(399)).toBe(1);
    expect(levelForXp(400)).toBe(2);
    expect(levelForXp(1000)).toBe(3);
    expect(levelForXp(10_000)).toBe(MAX_LEVEL);
    expect(MAX_LEVEL).toBe(5);
    expect(levelProgress(500)).toEqual({ level: 2, into: 100, span: 600 });
    expect(levelProgress(5000).span).toBeNull();
  });
});
