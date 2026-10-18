import { createTranslator, detectLanguage, FALLBACK_LANGUAGE, type Language } from '@gtd/i18n';
import type { Settings, SettingsPatch } from '@gtd/protocol';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';

/**
 * Settings live in the save on the PC, so every device sees the same choice. Until the player has picked a language
 * (first launch) the browser's language is used as the suggestion.
 */
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const suggested: Language = useMemo(() => detectLanguage(navigator.languages) ?? FALLBACK_LANGUAGE, []);
  const language = settings?.language ?? suggested;
  const t = useMemo(() => createTranslator(language), [language]);

  useEffect(() => {
    api.settings().then(setSettings, (error: Error) => setLoadError(error.message));
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = t('app.title');
  }, [language, t]);

  const update = useCallback(async (patch: SettingsPatch) => {
    setSettings(await api.updateSettings(patch));
  }, []);

  return {
    settings,
    loadError,
    language,
    suggested,
    needsLanguageChoice: settings !== null && settings.language === null,
    t,
    update,
  };
}
