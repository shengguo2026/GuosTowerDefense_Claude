import { DIFFICULTIES, type Difficulty } from '@gtd/ai';
import type { StagePack } from '@gtd/content-schema';
import { createTranslator, type Language, type Translate } from '@gtd/i18n';
import type { Progress, StageSummary } from '@gtd/protocol';
import type { Side } from '@gtd/sim';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Art, initials } from '../art/Art';
import type { MatchConfig } from '../match/matchConfig';

interface Props {
  stages: StageSummary[];
  language: Language;
  t: Translate;
  playerName: string;
  /** The last choices, so Replay and coming back keep them. */
  initial?: Partial<MatchConfig>;
  onName(name: string): void;
  onStart(config: MatchConfig): void;
  onBack(): void;
}

/** Whether a level is open: it has no requirement, or the level it needs has been won once (either side). */
export function levelUnlocked(pack: StagePack, levelId: string, progress: Progress | null): boolean {
  const level = pack.levels.find((l) => l.id === levelId);
  if (!level) return false;
  if (level.unlockedBy === null) return true;
  return progress?.completedLevels[pack.manifest.id]?.includes(level.unlockedBy) ?? false;
}

/**
 * Single-player setup (spec §6.1): stage, level, side, profile, optional name and difficulty on one page, then the
 * briefing with Chief Warden Guo.
 */
export function SinglePlayerSetup({
  stages,
  language,
  t,
  playerName,
  initial,
  onName,
  onStart,
  onBack,
}: Props) {
  const playable = stages.filter((stage) => !stage.devOnly).sort((a, b) => a.order - b.order);
  const [stageId, setStageId] = useState(initial?.stageId ?? playable[0]?.id ?? '');
  const [pack, setPack] = useState<StagePack | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [levelId, setLevelId] = useState(initial?.levelId ?? '');
  const [side, setSide] = useState<Side>(initial?.side ?? 'attacker');
  const [profiles, setProfiles] = useState<Record<Side, string>>({
    attacker: initial?.attackerProfileId ?? '',
    defender: initial?.defenderProfileId ?? '',
  });
  const [difficulty, setDifficulty] = useState<Difficulty>(initial?.difficulty ?? 'easy');
  const [showReasoning, setShowReasoning] = useState(initial?.showAiReasoning ?? false);
  const [name, setName] = useState(playerName);
  const [briefing, setBriefing] = useState(false);
  const stageText = useMemo(() => (pack ? createTranslator(language, pack.texts) : null), [pack, language]);

  useEffect(() => {
    api.progress().then(setProgress, () => setProgress(null));
  }, []);
  useEffect(() => {
    if (!stageId) return;
    let cancelled = false;
    setPack(null);
    api.stage(stageId).then((loaded) => {
      if (cancelled) return;
      setPack(loaded);
      setLevelId((current) =>
        loaded.levels.some((l) => l.id === current) ? current : (loaded.levels[0]?.id ?? ''),
      );
      setProfiles((current) => ({
        attacker: loaded.manifest.profiles.attacker.includes(current.attacker)
          ? current.attacker
          : (loaded.manifest.profiles.attacker[0] ?? ''),
        defender: loaded.manifest.profiles.defender.includes(current.defender)
          ? current.defender
          : (loaded.manifest.profiles.defender[0] ?? ''),
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [stageId]);

  const level = pack?.levels.find((l) => l.id === levelId);
  const ready = pack && level && stageText && levelUnlocked(pack, levelId, progress) && profiles[side];
  const config: MatchConfig | null = ready
    ? {
        stageId,
        levelId,
        side,
        attackerProfileId: profiles.attacker,
        defenderProfileId: profiles.defender,
        difficulty,
        tutorial: false,
        showAiReasoning: showReasoning,
      }
    : null;

  if (briefing && config && pack && level && stageText) {
    return (
      <Briefing
        pack={pack}
        config={config}
        t={t}
        stageText={stageText}
        onStart={() => onStart(config)}
        onBack={() => setBriefing(false)}
      />
    );
  }

  const wins = progress?.wins[stageId]?.[levelId];
  return (
    <div className="screen setup-screen" data-testid="setup">
      <header className="screen-header">
        <button type="button" className="hud-button" onClick={onBack} data-testid="setup-back">
          <span aria-hidden="true">‹</span> {t('level.back')}
        </button>
        <h1>{t('menu.singlePlayer')}</h1>
      </header>
      <div className="setup-body">
        <section className="setup-section" aria-labelledby="setup-stage">
          <h2 id="setup-stage">{t('setup.stage')}</h2>
          <div className="card-row">
            {playable.map((stage) => (
              <button
                key={stage.id}
                type="button"
                className={`pick-card stage ${stage.id === stageId ? 'selected' : ''}`}
                aria-pressed={stage.id === stageId}
                onClick={() => setStageId(stage.id)}
                data-testid={`stage-${stage.id}`}
              >
                <Art
                  id={stage.id === pack?.manifest.id ? pack.manifest.picture : undefined}
                  alt=""
                  ratio={16 / 9}
                  fallback={initials(stage.title[language])}
                />
                <strong>{stage.title[language]}</strong>
                {stage.id === pack?.manifest.id && pack.manifest.description && stageText && (
                  <span className="muted">{stageText(pack.manifest.description)}</span>
                )}
              </button>
            ))}
          </div>
        </section>

        {pack && stageText && (
          <section className="setup-section" aria-labelledby="setup-level">
            <h2 id="setup-level">{t('setup.level')}</h2>
            <div className="card-row">
              {pack.levels.map((option, index) => {
                const open = levelUnlocked(pack, option.id, progress);
                const record = progress?.wins[stageId]?.[option.id];
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`pick-card level ${option.id === levelId ? 'selected' : ''}`}
                    aria-pressed={option.id === levelId}
                    disabled={!open}
                    onClick={() => setLevelId(option.id)}
                    data-testid={`level-${option.id}`}
                  >
                    <Art id={option.picture} alt="" ratio={16 / 9} fallback={String(index + 1)} />
                    <strong>
                      {index + 1}. {stageText(option.title)}
                    </strong>
                    {option.description && <span className="muted">{stageText(option.description)}</span>}
                    {!open && <span className="lock">{t('setup.locked')}</span>}
                    {record && (record.attacker.length > 0 || record.defender.length > 0) && (
                      <span className="wins" data-testid="level-wins">
                        {(['attacker', 'defender'] as const)
                          .filter((s) => record[s].length > 0)
                          .map(
                            (s) =>
                              `${t(`seat.${s}`)}: ${record[s].map((d) => t(`difficulty.${d}`)).join(', ')}`,
                          )
                          .join(' · ')}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {pack.manifest.levels.length > pack.levels.length && (
              <p className="hint">{t('setup.moreLevels')}</p>
            )}
          </section>
        )}

        {pack && stageText && (
          <section className="setup-section" aria-labelledby="setup-side">
            <h2 id="setup-side">{t('setup.side')}</h2>
            <div className="side-picker" role="radiogroup" aria-labelledby="setup-side">
              {(['attacker', 'defender'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={side === option}
                  className={`side-choice ${option} ${side === option ? 'selected' : ''}`}
                  onClick={() => setSide(option)}
                  data-testid={`side-${option}`}
                >
                  <strong>{t(`seat.${option}`)}</strong>
                  <span>{t(`setup.sideHint.${option}`)}</span>
                </button>
              ))}
            </div>
            <h3>{t('setup.profile')}</h3>
            <div className="card-row profiles">
              {pack.profiles
                .filter((profile) => profile.side === side)
                .map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    className={`pick-card profile ${side} ${profiles[side] === profile.id ? 'selected' : ''}`}
                    aria-pressed={profiles[side] === profile.id}
                    onClick={() => setProfiles((current) => ({ ...current, [side]: profile.id }))}
                    data-testid={`profile-${profile.id}`}
                  >
                    <Art
                      id={profile.portrait}
                      alt=""
                      ratio={1}
                      tone={side}
                      fallback={initials(stageText(profile.name))}
                      className="portrait"
                    />
                    <span className="profile-text">
                      <strong>{stageText(profile.name)}</strong>
                      <span className="muted">{stageText(profile.description)}</span>
                      <span className="passive">
                        {stageText(profile.passive.name)}: {stageText(profile.passive.description)}
                      </span>
                    </span>
                  </button>
                ))}
            </div>
            <label className="field name-field">
              <span>{t('setup.name')}</span>
              <input
                type="text"
                value={name}
                maxLength={24}
                placeholder={t('setup.namePlaceholder')}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => name.trim() !== playerName && onName(name.trim())}
                data-testid="player-name"
              />
            </label>
          </section>
        )}

        {pack && (
          <section className="setup-section" aria-labelledby="setup-difficulty">
            <h2 id="setup-difficulty">{t('seat.difficulty')}</h2>
            <div className="difficulty-picker" role="radiogroup" aria-labelledby="setup-difficulty">
              {DIFFICULTIES.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={difficulty === option}
                  className={`difficulty ${difficulty === option ? 'active' : ''}`}
                  onClick={() => setDifficulty(option)}
                  data-testid={`difficulty-${option}`}
                >
                  {t(`difficulty.${option}`)}
                  {wins?.[side].includes(option) && (
                    <span className="beaten" title={t('setup.beaten')}>
                      ✓
                    </span>
                  )}
                </button>
              ))}
            </div>
            <p className="hint">{t(`setup.difficultyHint.${difficulty}`)}</p>
            <label className="check-row">
              <input
                type="checkbox"
                checked={showReasoning}
                onChange={(event) => setShowReasoning(event.target.checked)}
                data-testid="show-ai-reasoning"
              />
              {t('seat.showReasoning')}
            </label>
          </section>
        )}
      </div>
      <footer className="screen-footer">
        <button
          type="button"
          className="action launch"
          disabled={!config}
          onClick={() => {
            if (name.trim() !== playerName) onName(name.trim());
            setBriefing(true);
          }}
          data-testid="to-briefing"
        >
          {t('setup.toBriefing')}
        </button>
      </footer>
    </div>
  );
}

interface BriefingProps {
  pack: StagePack;
  config: MatchConfig;
  t: Translate;
  stageText: Translate;
  onStart(): void;
  onBack(): void;
}

/** Chief Warden Guo explains the level to the chosen side (spec §16), over the level picture. */
export function Briefing({ pack, config, t, stageText, onStart, onBack }: BriefingProps) {
  const level = pack.levels.find((l) => l.id === config.levelId);
  const profileId = config.side === 'attacker' ? config.attackerProfileId : config.defenderProfileId;
  const profile = pack.profiles.find((p) => p.id === profileId);
  if (!level) return null;
  return (
    <div className="screen briefing-screen" data-testid="briefing">
      <Art id={level.picture} alt="" className="briefing-picture" />
      <div className="briefing-card panel">
        <Art id="GUO-1-BRIEFING" alt={t('guo.name')} ratio={1} className="guo-portrait" fallback="G" />
        <div className="briefing-text">
          <p className="briefing-kicker">
            {t('briefing.title')} · {stageText(level.title)} · {t(`seat.${config.side}`)}
            {profile && ` (${stageText(profile.name)})`} · {t(`difficulty.${config.difficulty}`)}
          </p>
          <h1>{t('guo.name')}</h1>
          <p className="briefing-speech" data-testid="briefing-text">
            {level.briefing ? stageText(level.briefing[config.side]) : t('briefing.generic')}
          </p>
          <p className="hint">{t('briefing.controlsHint')}</p>
          <div className="row">
            <button type="button" className="action launch" onClick={onStart} data-testid="start-match">
              {t('briefing.start')}
            </button>
            <button type="button" className="action secondary" onClick={onBack}>
              {t('level.back')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
