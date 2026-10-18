import { describe, expect, it } from 'vitest';
import { SettingsSchema, parseClientMessage } from './index';

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
      graphics: 'high',
      audio: { master: 0.8, music: 0.6, effects: 0.8 },
    });
  });
});
