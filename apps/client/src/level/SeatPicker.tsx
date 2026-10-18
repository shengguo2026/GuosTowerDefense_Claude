import { DIFFICULTIES, type Difficulty } from '@gtd/ai';
import type { Translate } from '@gtd/i18n';
import type { MatchSummary, Seat } from '@gtd/protocol';
import { useState } from 'react';

/** How a new match is set up: against the computer at a difficulty, with or without its reasoning on screen. */
export interface MatchOptions {
  opponent?: Difficulty;
  showAiReasoning?: boolean;
}

interface Props {
  matches: MatchSummary[];
  t: Translate;
  onCreate(seat: Seat, options?: MatchOptions): void;
  onJoin(matchId: string, seat: Seat): void;
}

const NEW_SEATS: Seat[] = ['both', 'attacker', 'defender'];

/**
 * Choose how to take part: play one side against the computer, start a match on one side (or both) for people, or
 * join one another device started.
 */
export function SeatPicker({ matches, t, onCreate, onJoin }: Props) {
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [showReasoning, setShowReasoning] = useState(false);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="seat-title">
      <div className="panel seat-picker" data-testid="seat-picker">
        <h2 id="seat-title">{t('seat.title')}</h2>

        <h3>{t('seat.vsComputer')}</h3>
        <div className="difficulty-picker" role="radiogroup" aria-label={t('seat.difficulty')}>
          {DIFFICULTIES.map((level) => (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={difficulty === level}
              className={`difficulty ${difficulty === level ? 'active' : ''}`}
              onClick={() => setDifficulty(level)}
              data-testid={`difficulty-${level}`}
            >
              {t(`difficulty.${level}`)}
            </button>
          ))}
        </div>
        <div className="seat-options two">
          {(['attacker', 'defender'] as const).map((seat) => (
            <button
              key={seat}
              type="button"
              className={`seat-option ${seat}`}
              onClick={() => onCreate(seat, { opponent: difficulty, showAiReasoning: showReasoning })}
              data-testid={`vs-ai-${seat}`}
            >
              {t(`seat.playAs.${seat}`)}
            </button>
          ))}
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={showReasoning}
            onChange={(event) => setShowReasoning(event.target.checked)}
            data-testid="show-ai-reasoning"
          />
          {t('seat.showReasoning')}
        </label>

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
            (side) =>
              !match.seats.includes(side) && !match.seats.includes('both') && match.computer?.side !== side,
          );
          return (
            <div className="entity-row" key={match.matchId} data-testid="open-match">
              <span className="muted">
                {match.matchId} · {t(`phase.${match.phase}`)} ·{' '}
                {t('seat.taken', { seats: match.seats.map((s) => t(`seat.${s}`)).join(', ') || '–' })}
                {match.computer &&
                  ` · ${t('seat.computerPlays', {
                    side: t(`seat.${match.computer.side}`),
                    difficulty: t(`difficulty.${match.computer.difficulty}`),
                  })}`}
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
