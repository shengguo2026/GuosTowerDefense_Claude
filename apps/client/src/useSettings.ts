import { createTranslator, detectLanguage, FALLBACK_LANGUAGE, type Language } from '@gtd/i18n';
import { SettingsSchema, type Settings, type SettingsPatch } from '@gtd/protocol';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { sounds } from './audio/sound';
import { resolveBindings } from './input/bindings';

/** Defaults until the save has answered, so screens never wait on settings. */
const DEFAULTS: Settings = SettingsSchema.parse({});

/**
 * Settings live in the save on the PC, so every device sees the same choice. Until the player has picked a language
 * (first launch) the browser's language is used as the suggestion. Changes show at once and are saved in the
 * background.
 */
export function useSettings() {
  const [stored, setStored] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const suggested: Language = useMemo(() => detectLanguage(navigator.languages) ?? FALLBACK_LANGUAGE, []);
  const settings = stored ?? DEFAULTS;
  const language = settings.language ?? suggested;
  const t = useMemo(() => createTranslator(language), [language]);
  const bindings = useMemo(() => resolveBindings(settings.keyBindings), [settings.keyBindings]);

  useEffect(() => {
    api.settings().then(setStored, (error: Error) => setLoadError(error.message));
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = t('app.title');
  }, [language, t]);

  const { uiScale, textScale, reducedEffects } = settings.accessibility;
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('--ui-scale', String(uiScale));
    root.setProperty('--text-scale', String(textScale));
    document.documentElement.classList.toggle('reduced-effects', reducedEffects);
  }, [uiScale, textScale, reducedEffects]);

  const { master, effects } = settings.audio;
  useEffect(() => sounds.setVolume(master * effects), [master, effects]);

  const update = useCallback(async (patch: SettingsPatch) => {
    setStored((current) => (current ? merge(current, patch) : current));
    try {
      setStored(await api.updateSettings(patch));
    } catch (error) {
      setLoadError((error as Error).message);
    }
  }, []);

  /** Reads the settings again (after a save was imported). */
  const reload = useCallback(async () => {
    setStored(await api.settings());
  }, []);

  return {
    settings,
    reload,
    loaded: stored !== null,
    loadError,
    language,
    suggested,
    needsLanguageChoice: stored !== null && stored.language === null,
    bindings,
    t,
    update,
  };
}

export type SettingsState = ReturnType<typeof useSettings>;

function merge(current: Settings, patch: SettingsPatch): Settings {
  return {
    ...current,
    ...patch,
    audio: { ...current.audio, ...patch.audio },
    accessibility: { ...current.accessibility, ...patch.accessibility },
    onboarding: { ...current.onboarding, ...patch.onboarding },
    keyBindings: patch.keyBindings ?? current.keyBindings,
  };
}
