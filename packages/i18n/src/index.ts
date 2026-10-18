import de from '../locales/de.json';
import en from '../locales/en.json';
import zhCN from '../locales/zh-CN.json';

export const LANGUAGES = ['en', 'de', 'zh-CN'] as const;
export type Language = (typeof LANGUAGES)[number];
export const FALLBACK_LANGUAGE: Language = 'en';

export type TextKey = keyof typeof en;
export type Dictionary = Record<string, string>;

export const interfaceTexts: Record<Language, Dictionary> = { en, de, 'zh-CN': zhCN };

/** Each language's name written in that language, for the language picker. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', de: 'Deutsch', 'zh-CN': '简体中文' };

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * Picks the first supported language from the browser's preference list (e.g. `navigator.languages`).
 * Any Chinese variant maps to Simplified Chinese; returns null when nothing matches.
 */
export function detectLanguage(preferred: readonly string[]): Language | null {
  for (const tag of preferred) {
    const lower = tag.toLowerCase();
    if (lower === 'zh' || lower.startsWith('zh-')) return 'zh-CN';
    if (lower === 'de' || lower.startsWith('de-')) return 'de';
    if (lower === 'en' || lower.startsWith('en-')) return 'en';
  }
  return null;
}

export type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Returns a lookup for one language. Missing texts fall back to English, then to the key itself, so a gap never
 * shows an empty label. Stage packs pass their own dictionaries the same way.
 */
export function createTranslator(
  language: Language,
  dictionaries: Record<Language, Dictionary> = interfaceTexts,
): Translate {
  const primary = dictionaries[language];
  const fallback = dictionaries[FALLBACK_LANGUAGE];
  return (key, params) => {
    const text = primary[key] ?? fallback[key] ?? key;
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    );
  };
}
