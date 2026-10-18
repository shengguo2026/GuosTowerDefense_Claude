import { LANGUAGE_NAMES, LANGUAGES, isLanguage, type Language, type Translate } from '@gtd/i18n';
import { GRAPHICS_PRESETS, type GraphicsPreset } from '@gtd/protocol';

interface Props {
  language: Language;
  graphics: GraphicsPreset;
  t: Translate;
  onLanguage(language: Language): void;
  onGraphics(preset: GraphicsPreset): void;
  onClose(): void;
}

export function SettingsPanel({ language, graphics, t, onLanguage, onGraphics, onClose }: Props) {
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onClick={onClose}
    >
      <div className="panel settings" onClick={(event) => event.stopPropagation()}>
        <h2 id="settings-title">{t('settings.title')}</h2>
        <label className="field">
          <span>{t('language.label')}</span>
          <select
            value={language}
            data-testid="language-select"
            onChange={(event) => {
              if (isLanguage(event.target.value)) onLanguage(event.target.value);
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
            value={graphics}
            data-testid="graphics-select"
            onChange={(event) => {
              const choice = GRAPHICS_PRESETS.find((preset) => preset === event.target.value);
              if (choice) onGraphics(choice);
            }}
          >
            {GRAPHICS_PRESETS.map((option) => (
              <option key={option} value={option}>
                {t(`graphics.${option}`)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="primary" onClick={onClose}>
          {t('settings.close')}
        </button>
      </div>
    </div>
  );
}
