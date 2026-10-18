import { LANGUAGE_NAMES, LANGUAGES, isLanguage, type Language, type Translate } from '@gtd/i18n';

interface Props {
  language: Language;
  t: Translate;
  onLanguage(language: Language): void;
  onClose(): void;
}

export function SettingsPanel({ language, t, onLanguage, onClose }: Props) {
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
        <button type="button" className="primary" onClick={onClose}>
          {t('settings.close')}
        </button>
      </div>
    </div>
  );
}
