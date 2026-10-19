import type { Translate } from '@gtd/i18n';
import type { Seat } from '@gtd/protocol';
import type { MatchResult, MatchSnapshot, Side } from '@gtd/sim';
import { Art } from '../art/Art';

interface Props {
  result: MatchResult;
  stats: MatchSnapshot['stats'];
  seat: Seat;
  t: Translate;
  onPlayAgain(): void;
  onBack(): void;
  /** A line from Chief Warden Guo for the player (single player). */
  quip?: { text: string; won: boolean; name: string };
  /** Hot-seat: the two players' names, shown on their halves. */
  names?: Partial<Record<Side, string>>;
}

const ATTACKER_STATS = [
  'wavesLaunched',
  'membersLaunched',
  'checkpointsPassed',
  'membersReachedObjective',
  'membersRetreated',
] as const;
const DEFENDER_STATS = [
  'membersTurnedBack',
  'wavesStopped',
  'structuresBuilt',
  'patrolsDeployed',
  'groupsIdentified',
] as const;

/**
 * The 50/50 result screen: Attacker always on the left, Defender on the right, the winner emphasised, and both sides'
 * performance shown, also for the side that lost.
 */
export function ResultScreen({ result, stats, seat, t, onPlayAgain, onBack, quip, names }: Props) {
  const half = (side: Side) => {
    const won = result.winner === side;
    const rows: [string, string][] =
      side === 'attacker'
        ? [
            ...ATTACKER_STATS.map((key): [string, string] => [key, String(stats.attacker[key])]),
            ['bestObjectiveProgress', `${Math.round(stats.attacker.bestObjectiveProgress * 100)}%`],
          ]
        : DEFENDER_STATS.map((key): [string, string] => [key, String(stats.defender[key])]);
    const mine = seat === side;
    return (
      <section className={`result-half ${side} ${won ? 'won' : 'lost'}`} data-testid={`result-${side}`}>
        <p className="result-side">
          {t(`seat.${side}`)}
          {names?.[side] && <span className="result-name"> · {names[side]}</span>}
        </p>
        <h2>{won ? t('result.victory') : t('result.defeat')}</h2>
        <dl>
          {rows.map(([key, value]) => (
            <div key={key}>
              <dt>{t(`result.stat.${key}`)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {mine && <span className="you" aria-hidden="true" />}
      </section>
    );
  };
  return (
    <div
      className="result-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby="result-title"
      data-testid="result-screen"
    >
      <div className="result-halves">
        {half('attacker')}
        {half('defender')}
      </div>
      <div className="result-banner panel">
        <h1 id="result-title">{t(`result.wins.${result.winner}`)}</h1>
        <p>{t(`result.reason.${result.reason}`)}</p>
        {quip && (
          <div className="guo-quip" data-testid="guo-quip">
            <Art
              id={quip.won ? 'GUO-2-HAPPY' : 'GUO-3-CONCERNED'}
              alt={quip.name}
              ratio={1}
              className="guo-mini"
              fallback="G"
            />
            <p>
              <strong>{quip.name}:</strong> {quip.text}
            </p>
          </div>
        )}
        <div className="row">
          <button type="button" className="action" onClick={onPlayAgain} data-testid="play-again">
            {t('result.playAgain')}
          </button>
          <button type="button" className="action secondary" onClick={onBack}>
            {t('result.back')}
          </button>
        </div>
      </div>
    </div>
  );
}
