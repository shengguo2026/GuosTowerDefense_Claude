import type { StagePack } from '@gtd/content-schema';
import { createTranslator, type Language, type Translate } from '@gtd/i18n';
import type { HighScore, Progress, Records, Statistics } from '@gtd/protocol';
import type { Side } from '@gtd/sim';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Art, initials } from '../art/Art';
import { LevelBar } from './LevelBar';
import { RankList } from './RankList';

const PAGES = ['profiles', 'highScores', 'statistics'] as const;
type Page = (typeof PAGES)[number];

/** Statistics in the order the page shows them (masterplan §38). */
const STATISTICS: (keyof Omit<Statistics, 'profileUsage'>)[] = [
  'matchesPlayed',
  'wins',
  'losses',
  'attackerWins',
  'defenderWins',
  'singlePlayerMatches',
  'hotSeatMatches',
  'wifiMatches',
  'matches1v1',
  'wavesLaunched',
  'reroutes',
  'defensesDisrupted',
  'defensesDismantled',
  'attackersStopped',
  'patrolInterceptions',
  'detections',
  'defensesBuilt',
  'abilitiesUsed',
  'bestScore',
  'playSeconds',
];

interface Props {
  stageId: string;
  language: Language;
  t: Translate;
  onBack(): void;
}

/**
 * Progress (spec §12): each profile's XP, level and unlocks, the high scores and the local statistics, all from the
 * one save on the PC (a tablet or phone shows the PC's progress).
 */
export function ProgressScreen({ stageId, language, t, onBack }: Props) {
  const [pack, setPack] = useState<StagePack | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [records, setRecords] = useState<Records | null>(null);
  const [page, setPage] = useState<Page>('profiles');
  const stageText = useMemo(() => (pack ? createTranslator(language, pack.texts) : null), [pack, language]);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.stage(stageId), api.progress(), api.records()]).then(
      ([loadedPack, loadedProgress, loadedRecords]) => {
        if (cancelled) return;
        setPack(loadedPack);
        setProgress(loadedProgress);
        setRecords(loadedRecords);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [stageId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('.overlay')) onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  return (
    <div className="screen manual-screen progress-screen" data-testid="progress">
      <div className="manual panel">
        <header className="screen-head">
          <button type="button" className="hud-button" onClick={onBack} data-testid="progress-back">
            <span aria-hidden="true">‹</span> {t('level.back')}
          </button>
          <h1>{t('progress.title')}</h1>
        </header>
        <div className="manual-layout">
          <nav className="manual-nav" aria-label={t('progress.title')}>
            {PAGES.map((id) => (
              <button
                key={id}
                type="button"
                className={page === id ? 'active' : ''}
                aria-current={page === id ? 'page' : undefined}
                onClick={() => setPage(id)}
                data-testid={`progress-${id}`}
              >
                {t(`progress.${id}`)}
              </button>
            ))}
          </nav>
          <article className="manual-page" data-testid="progress-page">
            {!pack || !stageText || !progress || !records ? (
              <p className="muted">{t('progress.loading')}</p>
            ) : page === 'profiles' ? (
              <ProfilesPage pack={pack} progress={progress} t={t} stageText={stageText} />
            ) : page === 'highScores' ? (
              <HighScoresPage pack={pack} scores={records.highScores} t={t} stageText={stageText} />
            ) : (
              <StatisticsPage pack={pack} statistics={records.statistics} t={t} stageText={stageText} />
            )}
          </article>
        </div>
      </div>
    </div>
  );
}

function ProfilesPage({
  pack,
  progress,
  t,
  stageText,
}: {
  pack: StagePack;
  progress: Progress;
  t: Translate;
  stageText: Translate;
}) {
  const xpOf = (profileId: string) => progress.profileXp[pack.manifest.id]?.[profileId] ?? 0;
  return (
    <>
      <h2>{t('progress.profiles')}</h2>
      <p className="muted">{t('progress.profilesHint')}</p>
      {(['attacker', 'defender'] as const).map((side) => (
        <section key={side}>
          <h3>{t(`seat.${side}`)}</h3>
          <ul className="progress-profiles">
            {pack.manifest.profiles[side].map((id) => {
              const profile = pack.profiles.find((p) => p.id === id);
              if (!profile) return null;
              return (
                <li key={id} className={`progress-profile ${side}`} data-testid={`progress-profile-${id}`}>
                  <div className="progress-profile-head">
                    <Art
                      id={profile.portrait}
                      alt=""
                      ratio={1}
                      tone={side}
                      className="mini-icon"
                      fallback={initials(stageText(profile.name))}
                    />
                    <div>
                      <strong>{stageText(profile.name)}</strong>
                      <LevelBar xp={xpOf(id)} t={t} />
                    </div>
                  </div>
                  <RankList profile={profile} xp={xpOf(id)} t={t} stageText={stageText} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

function HighScoresPage({
  pack,
  scores,
  t,
  stageText,
}: {
  pack: StagePack;
  scores: HighScore[];
  t: Translate;
  stageText: Translate;
}) {
  const [levelId, setLevelId] = useState(pack.levels[0]?.id ?? '');
  const [side, setSide] = useState<Side>('attacker');
  const profileName = (id: string) => {
    const profile = pack.profiles.find((p) => p.id === id);
    return profile ? stageText(profile.name) : id;
  };
  const shown = scores.filter(
    (score) => score.stageId === pack.manifest.id && score.levelId === levelId && score.side === side,
  );
  const opponents = [...new Set(shown.map((score) => score.opponent))].sort(
    (a, b) => OPPONENT_ORDER.indexOf(a) - OPPONENT_ORDER.indexOf(b),
  );
  return (
    <>
      <h2>{t('progress.highScores')}</h2>
      <div className="row progress-filters">
        <label>
          {t('progress.level')}{' '}
          <select value={levelId} onChange={(e) => setLevelId(e.target.value)} data-testid="scores-level">
            {pack.levels.map((level) => (
              <option key={level.id} value={level.id}>
                {stageText(level.title)}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented" role="group" aria-label={t('progress.side')}>
          {(['attacker', 'defender'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={side === s ? 'active' : ''}
              aria-pressed={side === s}
              onClick={() => setSide(s)}
              data-testid={`scores-${s}`}
            >
              {t(`seat.${s}`)}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 && <p className="muted">{t('progress.noScores')}</p>}
      {opponents.map((opponent) => (
        <section key={opponent}>
          <h3>{t(`progress.opponent.${opponent}`)}</h3>
          <table className="score-table" data-testid={`scores-${opponent}`}>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">{t('reward.score')}</th>
                <th scope="col">{t('progress.player')}</th>
                <th scope="col">{t('progress.result')}</th>
                <th scope="col">{t('progress.date')}</th>
              </tr>
            </thead>
            <tbody>
              {shown
                .filter((score) => score.opponent === opponent)
                .sort((a, b) => b.score - a.score)
                .map((score, index) => (
                  <tr key={`${score.date}-${index}`}>
                    <td>{index + 1}</td>
                    <td>
                      <strong>{score.score.toLocaleString()}</strong>
                    </td>
                    <td>
                      {score.players
                        .map((p) => `${p.name || t('progress.noName')} · ${profileName(p.profileId)}`)
                        .join(', ')}
                    </td>
                    <td>{score.won ? t('result.victory') : t('result.defeat')}</td>
                    <td>{new Date(score.date).toLocaleDateString()}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}

const OPPONENT_ORDER: HighScore['opponent'][] = ['easy', 'medium', 'hard', 'human'];

function StatisticsPage({
  pack,
  statistics,
  t,
  stageText,
}: {
  pack: StagePack;
  statistics: Statistics;
  t: Translate;
  stageText: Translate;
}) {
  const value = (key: (typeof STATISTICS)[number]) =>
    key === 'playSeconds'
      ? t('progress.minutes', { minutes: Math.round(statistics.playSeconds / 60) })
      : statistics[key].toLocaleString();
  return (
    <>
      <h2>{t('progress.statistics')}</h2>
      <p className="muted">{t('progress.statisticsHint')}</p>
      <dl className="stat-grid" data-testid="statistics">
        {STATISTICS.map((key) => (
          <div key={key}>
            <dt>{t(`progress.stat.${key}`)}</dt>
            <dd data-testid={`stat-${key}`}>{value(key)}</dd>
          </div>
        ))}
      </dl>
      <h3>{t('progress.profileUsage')}</h3>
      <dl className="stat-grid">
        {pack.profiles.map((profile) => (
          <div key={profile.id}>
            <dt>{stageText(profile.name)}</dt>
            <dd>{(statistics.profileUsage[profile.id] ?? 0).toLocaleString()}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
