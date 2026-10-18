import type { StagePack } from '@gtd/content-schema';
import type { Translate } from '@gtd/i18n';
import type { MatchSnapshot, Side } from '@gtd/sim';
import { TICK_MS } from '@gtd/sim';
import { Art, initials } from '../art/Art';
import { KeyHint } from './KeyHint';
import { Tooltip } from './Tooltip';

type Ability = StagePack['catalog']['abilities'][number];

interface Props {
  abilities: Ability[];
  side: Side;
  snapshot: MatchSnapshot;
  aiming: string | null;
  floating: boolean;
  t: Translate;
  stageText: Translate;
  onUse(ability: Ability): void;
}

/** Ability slots (keys F G H J K): cost in points, cooldown drawn as a shrinking shade. */
export function AbilityBar({ abilities, side, snapshot, aiming, floating, t, stageText, onUse }: Props) {
  const points = snapshot.points[side] ?? 0;
  return (
    <section
      className={`hud-panel ability-bar ${floating ? 'floating' : ''}`}
      aria-label={t('ctl.abilities')}
      data-tutorial="abilities"
    >
      {!floating && (
        <h3>
          {t('ctl.abilities')}{' '}
          <span className="muted">· {t('hud.pointsLeft', { points: Math.floor(points) })}</span>
        </h3>
      )}
      <div className="ability-slots">
        {abilities.map((ability, i) => {
          const cooldown = snapshot.cooldowns[ability.id] ?? 0;
          const total = ability.cooldownSeconds * (1000 / TICK_MS);
          const share = total > 0 ? Math.min(1, cooldown / total) : 0;
          const short = points < ability.cost;
          const name = stageText(ability.name);
          return (
            <Tooltip
              key={ability.id}
              text={`${name}: ${stageText(ability.description)} (${t('ctl.cost', { cost: ability.cost })})`}
            >
              <button
                type="button"
                className={`ability ${aiming === ability.id ? 'active' : ''} ${cooldown > 0 || short ? 'waiting' : 'ready'}`}
                onClick={() => onUse(ability)}
                aria-label={`${name}, ${cooldown > 0 ? t('hud.cooldown', { seconds: Math.ceil((cooldown * TICK_MS) / 1000) }) : short ? t('reject.notEnoughPoints') : t('ctl.ready')}`}
                data-testid={`ability-${ability.id}`}
              >
                <Art id={ability.icon} alt="" ratio={1} tone={side} fallback={initials(name)} />
                {cooldown > 0 && (
                  <span className="cooldown-shade" style={{ height: `${share * 100}%` }} aria-hidden="true" />
                )}
                {cooldown > 0 && (
                  <span className="cooldown-text" aria-hidden="true">
                    {Math.ceil((cooldown * TICK_MS) / 1000)}
                  </span>
                )}
                {!floating && <span className="card-name">{name}</span>}
                <span className="card-cost">{ability.cost}</span>
                <KeyHint action={`ability.${i + 1}`} />
              </button>
            </Tooltip>
          );
        })}
      </div>
    </section>
  );
}
