import { describe, expect, it } from 'vitest';
import { SettingsPatchSchema, SettingsSchema, parseClientMessage } from './index';

describe('client messages', () => {
  it('accepts a valid hello and rejects junk', () => {
    expect(
      parseClientMessage(JSON.stringify({ type: 'hello', protocolVersion: 1, clientId: 'tab-1' })),
    ).toEqual({
      type: 'hello',
      protocolVersion: 1,
      clientId: 'tab-1',
    });
    expect(parseClientMessage('{"type":"launch"}')).toBeNull();
    expect(parseClientMessage('not json')).toBeNull();
  });
});

describe('settings', () => {
  it('fills defaults for a first launch', () => {
    expect(SettingsSchema.parse({})).toEqual({
      language: null,
      graphics: 'auto',
      audio: { master: 0.8, music: 0.6, effects: 0.8 },
      keyBindings: {},
      accessibility: { uiScale: 1, textScale: 1, highContrastRoutes: false, reducedEffects: false },
      onboarding: { hintsSeen: [], tutorialsDone: [], tutorialOffered: false },
      playerName: '',
    });
  });

  it('refuses key codes and scales outside the allowed range', () => {
    expect(SettingsPatchSchema.safeParse({ keyBindings: { 'match.pause': 'Key P' } }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ accessibility: { uiScale: 3 } }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ keyBindings: { 'match.pause': 'KeyO' } }).success).toBe(true);
  });
});
