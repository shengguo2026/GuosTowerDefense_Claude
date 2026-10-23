import type { StagePack } from '@gtd/content-schema';
import type { Translate } from '@gtd/i18n';
import { levelForXp } from '@gtd/progression';
import type { Seat, SideReward } from '@gtd/protocol';
import type { MatchResult, MatchSnapshot, Side } from '@gtd/sim';
import type { ReactNode } from 'react';
import { Art } from '../art/Art';
import { LevelBar } from '../progress/LevelBar';

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
  /** Buttons instead of Play again and Back (Wi-Fi: the host's Rematch and Lobby, the guest waits). */
  actions?: ReactNode;
  /** Score, XP and high scores, once the PC has saved them (not for tutorials). */
  rewards?: Partial<Record<Side, SideReward>> | null;
  /** The stage, for the names of unlocked ranks. */
  pack?: StagePack;
  stageText?: Translate;
}

const ATTACKER_STATS = [
  'wavesLaunched',
  'membersLaunched',
  'checkpointsPassed',
  'membersReachedObjective',
  'membersRetreated',
  'defensesDisrupted',
  'defensesDismantled',
] as const;
const DEFENDER_STATS = [
  'membersTurnedBack',
  'wavesStopped',
  'structuresBuilt',
  'patrolsDeployed',
  'groupsIdentified',
  'abilitiesUsed',
] as const;

/**
 * The 50/50 result screen: Attacker always on the left, Defender on the right, the winner emphasised, and both sides'
 * performance shown, also for the side that lost.
 */
export function ResultScreen({
  result,
  stats,
  seat,
  t,
  onPlayAgain,
  onBack,
  quip,
  names,
  actions,
  rewards,
  pack,
  stageText,
}: Props) {
  const rewardOf = (side: Side) => {
    const reward = rewards?.[side];
    if (!reward) return null;
    const profile = pack?.profiles.find((p) => p.id === reward.profileId);
    const xp = reward.xp;
    return (
      <div className="result-reward" data-testid={`reward-${side}`}>
        <p className="reward-score">
          <span>{t('reward.score')}</span>
          <strong data-testid={`score-${side}`}>{reward.score.total.toLocaleString()}</strong>
          {reward.highScorePlace !== null && (
            <span className="reward-badge" data-testid={`high-score-${side}`}>
              {reward.highScorePlace === 1
                ? t('reward.bestScore')
                : t('reward.highScore', { place: reward.highScorePlace })}
            </span>
          )}
        </p>
        <p className="reward-parts">
          {t('reward.parts', {
            base: reward.score.base,
            performance: reward.score.primary,
            efficiency: reward.score.efficiency,
            tactical: reward.score.tactical,
            multiplier: reward.score.multiplier,
          })}
        </p>
        {xp ? (
          <>
            <p className="reward-xp">
              <strong>{t('reward.xpGained', { xp: xp.gained.total })}</strong>
              {levelForXp(xp.after) > levelForXp(xp.before) && (
                <span className="reward-badge level-up">
                  {t('reward.levelUp', { level: levelForXp(xp.after) })}
                </span>
              )}
            </p>
            <LevelBar xp={xp.after} t={t} />
            {xp.unlocked.map((level) => {
              const rank = profile?.ranks.find((r) => r.level === level);
              return (
                rank &&
                stageText && (
                  <p key={level} className="reward-unlock" data-testid="reward-unlock">
                    {t('reward.unlocked', { name: stageText(rank.name) })} {stageText(rank.description)}
                  </p>
                )
              );
            })}
          </>
        ) : (
          <p className="reward-parts">{t('reward.computerNoXp')}</p>
        )}
      </div>
    );
  };
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
        {rewardOf(side)}
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
          {actions ?? (
            <>
              <button type="button" className="action" onClick={onPlayAgain} data-testid="play-again">
                {t('result.playAgain')}
              </button>
              <button type="button" className="action secondary" onClick={onBack}>
                {t('result.back')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
