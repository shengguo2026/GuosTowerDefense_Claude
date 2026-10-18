import { describe, expect, it } from 'vitest';
import { LANGUAGES, createTranslator, detectLanguage, interfaceTexts } from './index';

describe('interface texts', () => {
  it('has every text in every language', () => {
    const keys = Object.keys(interfaceTexts.en).sort();
    for (const language of LANGUAGES) {
      expect(Object.keys(interfaceTexts[language]).sort(), language).toEqual(keys);
      for (const key of keys)
        expect(interfaceTexts[language][key]?.trim(), `${language} ${key}`).toBeTruthy();
    }
  });

  it('uses the localized game titles from the specification', () => {
    expect(interfaceTexts.en['app.title']).toBe("Guo's Tower Defense");
    expect(interfaceTexts.de['app.title']).toBe('Guos Tower Defense');
    expect(interfaceTexts['zh-CN']['app.title']).toBe('盛国的塔防游戏');
  });

  it('never uses violent wording', () => {
    const banned = /\b(kill|killed|shoot|shot|dead|erschießen|getötet)\b|杀/i;
    for (const language of LANGUAGES) {
      for (const text of Object.values(interfaceTexts[language])) expect(text).not.toMatch(banned);
    }
  });
});

describe('detectLanguage', () => {
  it('maps browser language tags to supported languages', () => {
    expect(detectLanguage(['de-AT', 'en'])).toBe('de');
    expect(detectLanguage(['zh-TW'])).toBe('zh-CN');
    expect(detectLanguage(['fr-FR', 'en-GB'])).toBe('en');
    expect(detectLanguage(['fr-FR'])).toBeNull();
  });
});

describe('createTranslator', () => {
  it('fills parameters and falls back to English, then to the key', () => {
    const t = createTranslator('de', { en: { a: 'A {n}', b: 'B' }, de: { a: 'Ä {n}' }, 'zh-CN': {} });
    expect(t('a', { n: 2 })).toBe('Ä 2');
    expect(t('b')).toBe('B');
    expect(t('missing')).toBe('missing');
  });
});
