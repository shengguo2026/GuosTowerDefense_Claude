import type { Translate } from '@gtd/i18n';
import type { MatchSummary, Seat } from '@gtd/protocol';

interface Props {
  matches: MatchSummary[];
  t: Translate;
  onCreate(seat: Seat): void;
  onJoin(matchId: string, seat: Seat): void;
}

const NEW_SEATS: Seat[] = ['both', 'attacker', 'defender'];

/** Choose how to take part: start a match on one side (or both), or join one another device started. */
export function SeatPicker({ matches, t, onCreate, onJoin }: Props) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="seat-title">
      <div className="panel seat-picker" data-testid="seat-picker">
        <h2 id="seat-title">{t('seat.title')}</h2>
        <h3>{t('seat.newMatch')}</h3>
        <div className="seat-options">
          {NEW_SEATS.map((seat) => (
            <button
              key={seat}
              type="button"
              className={`seat-option ${seat}`}
              onClick={() => onCreate(seat)}
              data-testid={`seat-${seat}`}
            >
              {t(`seat.${seat}`)}
            </button>
          ))}
        </div>
        <h3>{t('seat.join')}</h3>
        {matches.length === 0 && <p className="muted">{t('seat.noMatches')}</p>}
        {matches.map((match) => {
          const open = (['attacker', 'defender'] as const).filter(
            (side) => !match.seats.includes(side) && !match.seats.includes('both'),
          );
          return (
            <div className="entity-row" key={match.matchId} data-testid="open-match">
              <span className="muted">
                {match.matchId} · {t(`phase.${match.phase}`)} ·{' '}
                {t('seat.taken', { seats: match.seats.map((s) => t(`seat.${s}`)).join(', ') || '–' })}
              </span>
              <div className="row">
                {[...open, 'spectator' as const].map((seat) => (
                  <button
                    key={seat}
                    type="button"
                    className="small"
                    onClick={() => onJoin(match.matchId, seat)}
                    data-testid={`join-${seat}`}
                  >
                    {t('seat.joinAs', { seat: t(`seat.${seat}`) })}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <p className="hint">{t('seat.hint')}</p>
      </div>
    </div>
  );
}
