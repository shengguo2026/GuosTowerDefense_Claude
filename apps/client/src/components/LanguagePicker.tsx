import { createTranslator, LANGUAGE_NAMES, LANGUAGES, type Language } from '@gtd/i18n';
import { useState } from 'react';

interface Props {
  suggested: Language;
  onChoose(language: Language): void;
}

/** Shown once on first launch (spec §1); the browser's language is preselected. */
export function LanguagePicker({ suggested, onChoose }: Props) {
  const [choice, setChoice] = useState<Language>(suggested);
  const t = createTranslator(choice);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="language-title">
      <div className="panel language-picker">
        <h1 id="language-title">{t('language.pickerTitle')}</h1>
        <div className="language-options" role="radiogroup" aria-label={t('language.label')}>
          {LANGUAGES.map((language) => (
            <button
              key={language}
              type="button"
              role="radio"
              aria-checked={choice === language}
              lang={language}
              className={choice === language ? 'language-option selected' : 'language-option'}
              onClick={() => setChoice(language)}
            >
              {LANGUAGE_NAMES[language]}
            </button>
          ))}
        </div>
        <p className="hint">{t('language.pickerHint')}</p>
        <button type="button" className="primary" onClick={() => onChoose(choice)}>
          {t('language.continue')}
        </button>
      </div>
    </div>
  );
}
