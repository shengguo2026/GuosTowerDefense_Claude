import type { TutorialCondition, TutorialStep } from '@gtd/content-schema';
import type { MatchSnapshot, Side } from '@gtd/sim';

/** What the player did in this match that the snapshot cannot show (orders, picks on the map). */
export interface PlayerActions {
  orders: Set<string>;
  selected: Set<'group' | 'defense'>;
  upgraded: boolean;
}

export function noActions(): PlayerActions {
  return { orders: new Set(), selected: new Set(), upgraded: false };
}

/**
 * Whether a tutorial step is done. `continue` steps wait for the Next button and are never done here. Everything else
 * is read from the player's own view of the match, so the check works the same whatever the computer does.
 */
export function conditionMet(
  condition: TutorialCondition,
  snapshot: MatchSnapshot,
  side: Side,
  actions: PlayerActions,
  sideAbilities: string[],
): boolean {
  switch (condition.type) {
    case 'continue':
      return false;
    case 'phase':
      return snapshot.phase === condition.phase || snapshot.phase === 'ended';
    case 'build':
      return snapshot.entities.some(
        (e) =>
          e.kind === 'defense' &&
          !e.remembered &&
          (!condition.defense || e.defenseTypeId === condition.defense),
      );
    case 'upgrade':
      return actions.upgraded || snapshot.entities.some((e) => e.kind === 'defense' && e.level > 1);
    case 'launch':
      return snapshot.stats.attacker.wavesLaunched > 0;
    case 'ability': {
      const ids = condition.ability ? [condition.ability] : sideAbilities;
      return ids.some((id) => (snapshot.cooldowns[id] ?? 0) > 0);
    }
    case 'order':
      return actions.orders.has(condition.order);
    case 'select':
      return actions.selected.has(condition.kind);
    case 'spotted':
      return side === 'defender'
        ? snapshot.entities.some((e) => e.kind === 'group' && e.detection !== 'unknown')
        : snapshot.entities.some((e) => e.kind === 'defense');
    case 'objective':
      return snapshot.objective.heldTicks > 0;
  }
}

/** The first step that is not yet done, starting at `from` (steps already passed stay passed). */
export function nextStep(
  steps: TutorialStep[],
  from: number,
  snapshot: MatchSnapshot | null,
  side: Side,
  actions: PlayerActions,
  sideAbilities: string[],
): number {
  let index = from;
  while (snapshot && index < steps.length) {
    const step = steps[index] as TutorialStep;
    if (!conditionMet(step.until, snapshot, side, actions, sideAbilities)) break;
    index += 1;
  }
  return index;
}
