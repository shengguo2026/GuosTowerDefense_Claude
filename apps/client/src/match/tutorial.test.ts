import type { TutorialStep } from '@gtd/content-schema';
import type { MatchSnapshot } from '@gtd/sim';
import { describe, expect, it } from 'vitest';
import { conditionMet, nextStep, noActions } from './tutorial';

function snapshot(patch: Partial<MatchSnapshot> = {}): MatchSnapshot {
  return {
    tick: 0,
    phase: 'preparation',
    result: null,
    viewer: 'defender',
    resources: {},
    points: {},
    capacity: { total: 40, remaining: 40 },
    objective: { nodeId: 'o', x: 0, z: 0, radius: 4, heldTicks: 0, requiredTicks: 100, contested: false },
    remainingTicks: 100,
    preparationRemainingTicks: 10,
    launchCooldownRemainingTicks: 0,
    activeWaves: 0,
    cooldowns: {},
    areaEffects: [],
    closures: [],
    entities: [],
    stats: {
      attacker: {
        wavesLaunched: 0,
        membersLaunched: 0,
        membersReachedObjective: 0,
        membersTurnedBack: 0,
        membersRetreated: 0,
        checkpointsPassed: 0,
        capacityUsed: 0,
        defensesDisrupted: 0,
        defensesDismantled: 0,
        bestObjectiveProgress: 0,
      },
      defender: {
        membersTurnedBack: 0,
        wavesStopped: 0,
        structuresBuilt: 0,
        patrolsDeployed: 0,
        upgrades: 0,
        groupsIdentified: 0,
        abilitiesUsed: 0,
      },
    },
    ...patch,
  };
}

const post = {
  id: 1,
  kind: 'defense' as const,
  defenseTypeId: 'observation-post',
  mobile: false,
  nodeId: 'n',
  level: 1,
  condition: 100,
  blocking: false,
  priority: 'first' as const,
  focusGroupId: null,
  targetGroupId: null,
  order: null,
  boosted: false,
  disrupted: false,
  statuses: [],
  expiresAtTick: null,
  spent: 30,
  x: 0,
  z: 0,
};

describe('tutorial steps', () => {
  it('waits for the Next button on continue steps', () => {
    expect(conditionMet({ type: 'continue' }, snapshot(), 'defender', noActions(), [])).toBe(false);
  });

  it('sees a built defense of the asked type only', () => {
    const view = snapshot({ entities: [post] });
    expect(
      conditionMet({ type: 'build', defense: 'observation-post' }, view, 'defender', noActions(), []),
    ).toBe(true);
    expect(conditionMet({ type: 'build', defense: 'ranger-patrol' }, view, 'defender', noActions(), [])).toBe(
      false,
    );
  });

  it('counts an ability as used while it cools down', () => {
    const view = snapshot({ cooldowns: { intercept: 40 } });
    expect(conditionMet({ type: 'ability', ability: 'intercept' }, view, 'defender', noActions(), [])).toBe(
      true,
    );
    expect(conditionMet({ type: 'ability' }, view, 'defender', noActions(), ['rapid-response'])).toBe(false);
  });

  it('remembers orders and picks the snapshot cannot show', () => {
    const actions = noActions();
    actions.orders.add('hold');
    actions.selected.add('group');
    expect(conditionMet({ type: 'order', order: 'hold' }, snapshot(), 'attacker', actions, [])).toBe(true);
    expect(conditionMet({ type: 'select', kind: 'defense' }, snapshot(), 'attacker', actions, [])).toBe(
      false,
    );
  });

  it('skips steps that are already done but stops at a continue step', () => {
    const steps: TutorialStep[] = [
      { text: 'a', until: { type: 'build' } },
      { text: 'b', until: { type: 'phase', phase: 'combat' } },
      { text: 'c', until: { type: 'continue' } },
    ];
    const view = snapshot({ entities: [post], phase: 'combat' });
    expect(nextStep(steps, 0, view, 'defender', noActions(), [])).toBe(2);
    expect(nextStep(steps, 0, null, 'defender', noActions(), [])).toBe(0);
  });
});
