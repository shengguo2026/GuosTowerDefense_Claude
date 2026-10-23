import { describe, expect, it } from 'vitest';
import { SettingsPatchSchema, SettingsSchema, formatRoomCode, joinUrl, parseClientMessage } from './index';

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

  it('carries Focus Defense, command slots and junction abilities, and checks their sides', () => {
    const command = (body: object) => parseClientMessage(JSON.stringify({ type: 'command', command: body }));
    expect(command({ type: 'focusDefense', side: 'attacker', groupId: 3 })).not.toBeNull();
    expect(command({ type: 'focusDefense', side: 'attacker', groupId: 3, defenseId: null })).not.toBeNull();
    expect(command({ type: 'focusDefense', side: 'defender', groupId: 3 })).toBeNull();
    expect(
      command({ type: 'useCommand', side: 'defender', commandId: 'fortify', defenseId: 2 }),
    ).not.toBeNull();
    expect(
      command({
        type: 'useAbility',
        side: 'defender',
        abilityId: 'habitat-lockdown',
        nodeId: 'acacia-junction',
      }),
    ).toMatchObject({ command: { nodeId: 'acacia-junction' } });
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

describe('Wi-Fi rooms', () => {
  it('shows a room code in two groups and puts it into the QR address', () => {
    expect(formatRoomCode('247433')).toBe('247 433');
    expect(joinUrl('http://192.168.1.20:3001/', '007433')).toBe('http://192.168.1.20:3001/?join=007433');
    expect(joinUrl('http://192.168.1.20:3001', '007433')).toBe('http://192.168.1.20:3001/?join=007433');
  });

  it('takes room codes and tokens only in their exact shape', () => {
    const join = (code: string) =>
      parseClientMessage(JSON.stringify({ type: 'joinRoom', code, name: 'Mia' }));
    expect(join('247433')).not.toBeNull();
    expect(join('247 433')).toBeNull();
    expect(join('24743')).toBeNull();
    const rejoin = (token: string) =>
      parseClientMessage(JSON.stringify({ type: 'rejoinRoom', code: '247433', token }));
    expect(rejoin('0123456789abcdef0123456789abcdef')).not.toBeNull();
    expect(rejoin('not-a-token')).toBeNull();
  });
});
