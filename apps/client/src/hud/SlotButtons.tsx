import type { Action } from '@gtd/content-schema';
import type { Translate } from '@gtd/i18n';
import { TICK_RATE, type MatchSnapshot, type Side } from '@gtd/sim';
import { slotBlocked, slotKey } from './commandSlots';
import { KeyHint } from './KeyHint';
import { Tooltip } from './Tooltip';

interface Props {
  /** Every slot of the profile, for the key of each. */
  slots: Action[];
  /** The slots drawn here. */
  shown: Action[];
  side: Side;
  snapshot: MatchSnapshot;
  t: Translate;
  stageText: Translate;
  /** A slot that is running for the selection (Focus Defense while taking something apart). */
  active?(action: Action): boolean;
  label?(action: Action): string | undefined;
  onUse(action: Action): void;
}

/** Buttons for a profile's own command slots (Focus Defense, Rush, Fortify …), with cost, recharge and key. */
export function SlotButtons({ slots, shown, side, snapshot, t, stageText, active, label, onUse }: Props) {
  if (shown.length === 0) return null;
  return (
    <div className="order-buttons slot-buttons">
      {shown.map((action) => {
        const blocked = slotBlocked(snapshot, action, side);
        const cooldown = Math.ceil((snapshot.cooldowns[action.id] ?? 0) / TICK_RATE);
        return (
          <Tooltip key={action.id} text={stageText(action.description)}>
            <button
              type="button"
              className={`order slot ${active?.(action) ? 'active' : ''}`}
              onClick={() => onUse(action)}
              aria-disabled={blocked !== null}
              data-testid={`slot-${action.id}`}
            >
              {label?.(action) ?? stageText(action.name)}
              {cooldown > 0 ? (
                <span className="slot-meta">{t('hud.cooldown', { seconds: cooldown })}</span>
              ) : (
                action.cost > 0 && (
                  <span className="slot-meta">{t('hud.pointsLeft', { points: action.cost })}</span>
                )
              )}
              <KeyHint action={slotKey(slots, action)} />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
