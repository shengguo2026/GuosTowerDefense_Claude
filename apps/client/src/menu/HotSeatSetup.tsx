import type { StagePack } from '@gtd/content-schema';
import { createTranslator, type Language, type Translate } from '@gtd/i18n';
import { levelForXp } from '@gtd/progression';
import type { Progress, StageSummary } from '@gtd/protocol';
import type { Side } from '@gtd/sim';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Art, initials } from '../art/Art';
import { useKeyLabel } from '../hud/KeyHint';
import type { HotSeatConfig } from '../match/matchConfig';
import { levelUnlocked } from './SinglePlayerSetup';

interface Props {
  stages: StageSummary[];
  language: Language;
  t: Translate;
  initial?: HotSeatConfig;
  onStart(config: HotSeatConfig): void;
  onBack(): void;
}

const SIDES: Side[] = ['attacker', 'defender'];

/**
 * Hot-seat setup (spec §6.1): stage and level, then each player's profile and name, then Chief Warden Guo briefs both
 * sides. The Attacker plays with the keyboard, the Defender with the mouse; there is no computer and no difficulty.
 */
export function HotSeatSetup({ stages, language, t, initial, onStart, onBack }: Props) {
  const playable = stages.filter((stage) => !stage.devOnly).sort((a, b) => a.order - b.order);
  const [stageId, setStageId] = useState(initial?.stageId ?? playable[0]?.id ?? '');
  const [pack, setPack] = useState<StagePack | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [levelId, setLevelId] = useState(initial?.levelId ?? '');
  const [profiles, setProfiles] = useState<Record<Side, string>>({
    attacker: initial?.attackerProfileId ?? '',
    defender: initial?.defenderProfileId ?? '',
  });
  const [names, setNames] = useState<Record<Side, string>>(initial?.names ?? { attacker: '', defender: '' });
  const [briefing, setBriefing] = useState(false);
  const stageText = useMemo(() => (pack ? createTranslator(language, pack.texts) : null), [pack, language]);
  const keyLabel = useKeyLabel();

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
  const config: HotSeatConfig | null =
    pack && level && levelUnlocked(pack, levelId, progress) && profiles.attacker && profiles.defender
      ? {
          stageId,
          levelId,
          attackerProfileId: profiles.attacker,
          defenderProfileId: profiles.defender,
          names: { attacker: names.attacker.trim(), defender: names.defender.trim() },
        }
      : null;

  if (briefing && config && pack && level && stageText) {
    return (
      <div className="screen briefing-screen hotseat-briefing" data-testid="briefing">
        <Art id={level.picture} alt="" className="briefing-picture" />
        <div className="briefing-card panel">
          <Art id="GUO-1-BRIEFING" alt={t('guo.name')} ratio={1} className="guo-portrait" fallback="G" />
          <div className="briefing-text">
            <p className="briefing-kicker">
              {t('briefing.title')} · {stageText(level.title)} · {t('menu.twoPlayers')}
            </p>
            <h1>{t('guo.name')}</h1>
            <div className="briefing-sides">
              {SIDES.map((side) => (
                <section key={side} className={`briefing-side ${side}`} data-testid={`briefing-${side}`}>
                  <h2>
                    {t(`seat.${side}`)}
                    {config.names[side] && ` · ${config.names[side]}`}
                  </h2>
                  <p className="briefing-speech">
                    {level.briefing ? stageText(level.briefing[side]) : t('briefing.generic')}
                  </p>
                  <p className="hint">
                    {side === 'attacker'
                      ? t('hot.controls.attacker', {
                          cursor: ['cursor.up', 'cursor.left', 'cursor.down', 'cursor.right']
                            .map((a) => keyLabel(a))
                            .join(' '),
                          routes: ['route.1', 'route.2', 'route.3'].map((a) => keyLabel(a)).join(' '),
                          launch: keyLabel('wave.launch') ?? '',
                          pause: keyLabel('match.pause') ?? '',
                        })
                      : t('hot.controls.defender')}
                  </p>
                </section>
              ))}
            </div>
            <p className="hint">{t('hot.pausesRule')}</p>
            <div className="row">
              <button
                type="button"
                className="action launch"
                onClick={() => onStart(config)}
                data-testid="start-match"
              >
                {t('briefing.start')}
              </button>
              <button type="button" className="action secondary" onClick={() => setBriefing(false)}>
                {t('level.back')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen setup-screen" data-testid="hotseat-setup">
      <header className="screen-header">
        <button type="button" className="hud-button" onClick={onBack} data-testid="setup-back">
          <span aria-hidden="true">‹</span> {t('level.back')}
        </button>
        <h1>{t('menu.twoPlayers')}</h1>
        <p className="hot-intro">{t('hot.intro')}</p>
      </header>
      <div className="setup-body">
        <section className="setup-section" aria-labelledby="hot-stage">
          <h2 id="hot-stage">{t('setup.stage')}</h2>
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
              </button>
            ))}
          </div>
        </section>

        {pack && stageText && (
          <section className="setup-section" aria-labelledby="hot-level">
            <h2 id="hot-level">{t('setup.level')}</h2>
            <div className="card-row">
              {pack.levels.map((option, index) => {
                const open = levelUnlocked(pack, option.id, progress);
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
                    {!open && <span className="lock">{t('setup.locked')}</span>}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {pack && stageText && (
          <div className="hot-players">
            {SIDES.map((side) => (
              <section
                key={side}
                className={`setup-section hot-player ${side}`}
                aria-labelledby={`hot-${side}`}
                data-testid={`player-${side}`}
              >
                <h2 id={`hot-${side}`}>
                  {t(`seat.${side}`)}{' '}
                  <span className="muted">· {t(side === 'attacker' ? 'hot.keyboard' : 'hot.mouse')}</span>
                </h2>
                <p className="hint">{t(`hot.sideHint.${side}`)}</p>
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
                          <strong>
                            {stageText(profile.name)}{' '}
                            <span className="profile-level" data-testid={`level-${profile.id}`}>
                              {t('progress.levelShort', {
                                level: levelForXp(progress?.profileXp[pack.manifest.id]?.[profile.id] ?? 0),
                              })}
                            </span>
                          </strong>
                          <span className="muted">{stageText(profile.description)}</span>
                        </span>
                      </button>
                    ))}
                </div>
                <label className="field name-field">
                  <span>{t('setup.name')}</span>
                  <input
                    type="text"
                    value={names[side]}
                    maxLength={24}
                    placeholder={t(`seat.${side}`)}
                    onChange={(event) => {
                      const value = event.target.value;
                      setNames((current) => ({ ...current, [side]: value }));
                    }}
                    data-testid={`name-${side}`}
                  />
                </label>
              </section>
            ))}
          </div>
        )}
      </div>
      <footer className="screen-footer">
        <button
          type="button"
          className="action launch"
          disabled={!config}
          onClick={() => setBriefing(true)}
          data-testid="to-briefing"
        >
          {t('setup.toBriefing')}
        </button>
      </footer>
    </div>
  );
}
