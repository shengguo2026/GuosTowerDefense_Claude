import type { StagePack } from '@gtd/content-schema';
import { createTranslator, type Language, type Translate } from '@gtd/i18n';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Art, initials } from '../art/Art';
import { useKeyLabel } from '../hud/KeyHint';
import { KEY_ACTIONS } from '../input/bindings';

const RULE_PAGES = ['basics', 'attacker', 'defender', 'detection', 'hotseat', 'devices', 'controls'] as const;
type Page = (typeof RULE_PAGES)[number] | `profile:${string}`;

interface Props {
  stageId: string;
  language: Language;
  t: Translate;
  onBack(): void;
}

/**
 * The manual (spec §6.3): the rules in a few short pages, plus a page per side profile made from the stage data, so
 * the numbers there are always the numbers in the game.
 */
export function ManualScreen({ stageId, language, t, onBack }: Props) {
  const [pack, setPack] = useState<StagePack | null>(null);
  const [page, setPage] = useState<Page>('basics');
  const stageText = useMemo(() => (pack ? createTranslator(language, pack.texts) : null), [pack, language]);
  useEffect(() => {
    let cancelled = false;
    api.stage(stageId).then(
      (loaded) => !cancelled && setPack(loaded),
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

  const profile = page.startsWith('profile:')
    ? pack?.profiles.find((p) => `profile:${p.id}` === page)
    : undefined;
  return (
    <div className="screen manual-screen" data-testid="manual">
      <div className="manual panel">
        <header className="screen-head">
          <button type="button" className="hud-button" onClick={onBack} data-testid="manual-back">
            <span aria-hidden="true">‹</span> {t('level.back')}
          </button>
          <h1>{t('manual.title')}</h1>
        </header>
        <div className="manual-layout">
          <nav className="manual-nav" aria-label={t('manual.title')}>
            {RULE_PAGES.map((id) => (
              <button
                key={id}
                type="button"
                className={page === id ? 'active' : ''}
                aria-current={page === id ? 'page' : undefined}
                onClick={() => setPage(id)}
                data-testid={`manual-${id}`}
              >
                {t(`manual.${id}.title`)}
              </button>
            ))}
            {pack &&
              stageText &&
              pack.profiles.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={page === `profile:${p.id}` ? 'active' : ''}
                  aria-current={page === `profile:${p.id}` ? 'page' : undefined}
                  onClick={() => setPage(`profile:${p.id}`)}
                  data-testid={`manual-profile-${p.id}`}
                >
                  {stageText(p.name)} <span className="muted">· {t(`seat.${p.side}`)}</span>
                </button>
              ))}
          </nav>
          <article className="manual-page" data-testid="manual-page">
            {profile && pack && stageText ? (
              <ProfilePage pack={pack} profileId={profile.id} t={t} stageText={stageText} />
            ) : page === 'controls' ? (
              <ControlsPage t={t} />
            ) : (
              <RulePage id={page as (typeof RULE_PAGES)[number]} t={t} />
            )}
          </article>
        </div>
      </div>
    </div>
  );
}

function RulePage({ id, t }: { id: (typeof RULE_PAGES)[number]; t: Translate }) {
  return (
    <>
      <h2>{t(`manual.${id}.title`)}</h2>
      {[1, 2, 3].map((n) => (
        <p key={n}>{t(`manual.${id}.p${n}`)}</p>
      ))}
    </>
  );
}

function ControlsPage({ t }: { t: Translate }) {
  const keyLabel = useKeyLabel();
  return (
    <>
      <h2>{t('manual.controls.title')}</h2>
      <p>{t('manual.controls.p1')}</p>
      <p>{t('manual.controls.p2')}</p>
      <p>{t('manual.controls.p3')}</p>
      <table className="key-table">
        <tbody>
          {KEY_ACTIONS.map((action) => (
            <tr key={action.id}>
              <th scope="row">
                {t(action.label)}
                {action.slot !== undefined && ` ${action.slot}`}
                {action.side !== 'both' && <span className="muted"> · {t(`seat.${action.side}`)}</span>}
              </th>
              <td>
                <kbd>{keyLabel(action.id)}</kbd>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ProfilePage({
  pack,
  profileId,
  t,
  stageText,
}: {
  pack: StagePack;
  profileId: string;
  t: Translate;
  stageText: Translate;
}) {
  const profile = pack.profiles.find((p) => p.id === profileId);
  if (!profile) return null;
  const units = pack.catalog.units.filter((u) => profile.units.includes(u.id));
  const defenses = pack.catalog.defenses.filter((d) => profile.defenses.includes(d.id));
  const abilities = pack.catalog.abilities.filter((a) => profile.abilities.includes(a.id));
  return (
    <>
      <div className="profile-head">
        <Art
          id={profile.portrait}
          alt=""
          ratio={1}
          tone={profile.side}
          className="manual-portrait"
          fallback={initials(stageText(profile.name))}
        />
        <div>
          <h2>{stageText(profile.name)}</h2>
          <p>{stageText(profile.description)}</p>
          <p>
            <strong>{stageText(profile.passive.name)}:</strong> {stageText(profile.passive.description)}
          </p>
          <p className="muted">{t('manual.resource', { name: stageText(profile.resource.name) })}</p>
        </div>
      </div>
      {units.length > 0 && (
        <>
          <h3>{t('manual.units')}</h3>
          <ul className="manual-cards">
            {units.map((u) => (
              <li key={u.id}>
                <Art
                  id={u.icon}
                  alt=""
                  ratio={1}
                  tone="attacker"
                  className="mini-icon"
                  fallback={initials(stageText(u.name))}
                />
                <div>
                  <strong>{stageText(u.name)}</strong>
                  <span className="muted">
                    {t('manual.unitStats', {
                      cost: u.cost,
                      capacity: u.capacity,
                      speed: u.speed,
                      resilience: u.resilience,
                    })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {defenses.length > 0 && (
        <>
          <h3>{t('manual.defenses')}</h3>
          <ul className="manual-cards">
            {defenses.map((d) => (
              <li key={d.id}>
                <Art
                  id={d.icon}
                  alt=""
                  ratio={1}
                  tone="defender"
                  className="mini-icon"
                  fallback={initials(stageText(d.name))}
                />
                <div>
                  <strong>{stageText(d.name)}</strong>
                  <span className="muted">
                    {t('manual.defenseStats', {
                      cost: d.cost,
                      range: d.range,
                      sight: d.detectionRange ?? d.range,
                    })}
                    {d.mobile && ` · ${t('manual.mobile')}`}
                    {d.blocksNode && ` · ${t('manual.blocks')}`}
                    {d.maxCount !== undefined && ` · ${t('manual.maxCount', { count: d.maxCount })}`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>{t('ctl.abilities')}</h3>
      <ul className="manual-cards">
        {abilities.map((a) => (
          <li key={a.id}>
            <Art
              id={a.icon}
              alt=""
              ratio={1}
              tone={profile.side}
              className="mini-icon"
              fallback={initials(stageText(a.name))}
            />
            <div>
              <strong>{stageText(a.name)}</strong>
              <span>{stageText(a.description)}</span>
              <span className="muted">
                {t('manual.abilityStats', { cost: a.cost, cooldown: a.cooldownSeconds })}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
