import { LANGUAGE_NAMES, LANGUAGES, isLanguage } from '@gtd/i18n';
import { GRAPHICS_PRESETS } from '@gtd/protocol';
import { useEffect, useMemo, useState } from 'react';
import { sounds } from '../audio/sound';
import { useKeyLabel } from '../hud/KeyHint';
import { DEFAULT_BINDINGS, KEY_ACTIONS, RESERVED_KEYS, findConflicts } from '../input/bindings';
import type { SettingsState } from '../useSettings';

type Tab = 'general' | 'audio' | 'controls' | 'accessibility' | 'help';
const TABS: Tab[] = ['general', 'audio', 'controls', 'accessibility', 'help'];

interface Props {
  settings: SettingsState;
  /** Replays a side's tutorial (closes the settings and starts it). */
  onReplayTutorial?(side: 'attacker' | 'defender'): void;
  onClose(): void;
}

/** Settings (spec §6.4): language, graphics, audio, controls with the key binding editor, accessibility and hints. */
export function SettingsPanel({ settings, onReplayTutorial, onClose }: Props) {
  const { t, language, update } = settings;
  const current = settings.settings;
  const [tab, setTab] = useState<Tab>('general');
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('.key-capture')) {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onClick={onClose}
    >
      <div className="panel settings" onClick={(event) => event.stopPropagation()} data-testid="settings">
        <h2 id="settings-title">{t('settings.title')}</h2>
        <div className="settings-tabs" role="tablist">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`side-tab ${tab === id ? 'active' : ''}`}
              onClick={() => setTab(id)}
              data-testid={`settings-tab-${id}`}
            >
              {t(`settings.tab.${id}`)}
            </button>
          ))}
        </div>

        <div className="settings-body" role="tabpanel">
          {tab === 'general' && (
            <>
              <label className="field">
                <span>{t('language.label')}</span>
                <select
                  value={language}
                  data-testid="language-select"
                  onChange={(event) => {
                    if (isLanguage(event.target.value)) void update({ language: event.target.value });
                  }}
                >
                  {LANGUAGES.map((option) => (
                    <option key={option} value={option} lang={option}>
                      {LANGUAGE_NAMES[option]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t('graphics.label')}</span>
                <select
                  value={current.graphics}
                  data-testid="graphics-select"
                  onChange={(event) => {
                    const choice = GRAPHICS_PRESETS.find((preset) => preset === event.target.value);
                    if (choice) void update({ graphics: choice });
                  }}
                >
                  {GRAPHICS_PRESETS.map((option) => (
                    <option key={option} value={option}>
                      {t(`graphics.${option}`)}
                    </option>
                  ))}
                </select>
              </label>
              <NameField
                value={current.playerName}
                label={t('setup.playerName')}
                onSave={(name) => void update({ playerName: name })}
              />
            </>
          )}

          {tab === 'audio' && (
            <>
              {(['master', 'effects', 'music'] as const).map((channel) => (
                <label className="field slider" key={channel}>
                  <span>{t(`settings.audio.${channel}`)}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(current.audio[channel] * 100)}
                    onChange={(event) =>
                      void update({ audio: { [channel]: Number(event.target.value) / 100 } })
                    }
                    onPointerUp={() => sounds.play('select')}
                    data-testid={`volume-${channel}`}
                  />
                  <output>{Math.round(current.audio[channel] * 100)}%</output>
                </label>
              ))}
              <p className="hint">{t('settings.audio.musicLater')}</p>
            </>
          )}

          {tab === 'controls' && <BindingEditor settings={settings} />}

          {tab === 'accessibility' && (
            <>
              {(['uiScale', 'textScale'] as const).map((key) => (
                <label className="field slider" key={key}>
                  <span>{t(`settings.access.${key}`)}</span>
                  <input
                    type="range"
                    min={80}
                    max={160}
                    step={10}
                    value={Math.round(current.accessibility[key] * 100)}
                    onChange={(event) =>
                      void update({ accessibility: { [key]: Number(event.target.value) / 100 } })
                    }
                    data-testid={`scale-${key}`}
                  />
                  <output>{Math.round(current.accessibility[key] * 100)}%</output>
                </label>
              ))}
              {(['highContrastRoutes', 'reducedEffects'] as const).map((key) => (
                <label className="field check" key={key}>
                  <input
                    type="checkbox"
                    checked={current.accessibility[key]}
                    onChange={(event) => void update({ accessibility: { [key]: event.target.checked } })}
                    data-testid={`access-${key}`}
                  />
                  <span>
                    {t(`settings.access.${key}`)}
                    <span className="muted"> · {t(`settings.access.${key}Tip`)}</span>
                  </span>
                </label>
              ))}
            </>
          )}

          {tab === 'help' && (
            <>
              <p>{t('settings.help.hintsText', { count: current.onboarding.hintsSeen.length })}</p>
              <button
                type="button"
                className="action secondary"
                onClick={() => void update({ onboarding: { hintsSeen: [] } })}
                disabled={current.onboarding.hintsSeen.length === 0}
                data-testid="reset-hints"
              >
                {t('settings.help.resetHints')}
              </button>
              {onReplayTutorial && (
                <div className="row">
                  <button
                    type="button"
                    className="action secondary"
                    onClick={() => onReplayTutorial('attacker')}
                    data-testid="replay-attacker"
                  >
                    {t('settings.help.replay', { side: t('seat.attacker') })}
                  </button>
                  <button
                    type="button"
                    className="action secondary"
                    onClick={() => onReplayTutorial('defender')}
                    data-testid="replay-defender"
                  >
                    {t('settings.help.replay', { side: t('seat.defender') })}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <button type="button" className="primary" onClick={onClose}>
          {t('settings.close')}
        </button>
      </div>
    </div>
  );
}

function NameField({ value, label, onSave }: { value: string; label: string; onSave(name: string): void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="text"
        maxLength={24}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => draft.trim() !== value && onSave(draft.trim())}
        data-testid="settings-name"
      />
    </label>
  );
}

/** Key binding editor: click an action, press a key. Clashes within one side are marked; reset restores all keys. */
function BindingEditor({ settings }: { settings: SettingsState }) {
  const { t, bindings, update } = settings;
  const overrides = settings.settings.keyBindings;
  const keyLabel = useKeyLabel();
  const [capturing, setCapturing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const conflicts = useMemo(() => findConflicts(bindings), [bindings]);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') return setCapturing(null);
      if (RESERVED_KEYS.has(event.code)) return setMessage(t('keys.reserved'));
      const next = { ...overrides };
      if (DEFAULT_BINDINGS[capturing] === event.code) delete next[capturing];
      else next[capturing] = event.code;
      void update({ keyBindings: next });
      setMessage(null);
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, overrides, update, t]);

  const groups: { title: string; side: string }[] = [
    { title: t('keys.groupMatch'), side: 'both' },
    { title: t('seat.attacker'), side: 'attacker' },
    { title: t('seat.defender'), side: 'defender' },
  ];
  return (
    <div className="binding-editor" data-testid="binding-editor">
      <p className="hint">{t('keys.help')}</p>
      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}
      {conflicts.size > 0 && (
        <p className="warning" role="status" data-testid="key-conflicts">
          {t('keys.conflicts')}
        </p>
      )}
      {groups.map((group) => (
        <section key={group.side}>
          <h3>{group.title}</h3>
          <ul>
            {KEY_ACTIONS.filter((a) => a.side === group.side).map((action) => (
              <li key={action.id} className={conflicts.has(action.id) ? 'conflict' : ''}>
                <span>
                  {t(action.label)}
                  {action.slot !== undefined && ` ${action.slot}`}
                </span>
                <button
                  type="button"
                  className={`key-button ${capturing === action.id ? 'key-capture' : ''}`}
                  onClick={() => setCapturing(capturing === action.id ? null : action.id)}
                  aria-label={`${t(action.label)}${action.slot !== undefined ? ` ${action.slot}` : ''}: ${keyLabel(action.id) ?? ''}`}
                  data-testid={`bind-${action.id}`}
                >
                  {capturing === action.id ? t('keys.press') : <kbd>{keyLabel(action.id)}</kbd>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <button
        type="button"
        className="action secondary"
        onClick={() => void update({ keyBindings: {} })}
        disabled={Object.keys(overrides).length === 0}
        data-testid="reset-keys"
      >
        {t('keys.reset')}
      </button>
    </div>
  );
}
