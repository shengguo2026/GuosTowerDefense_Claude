import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, actionForKey, findConflicts, keyLabel, resolveBindings } from './bindings';

describe('key bindings', () => {
  it('uses the spec defaults: T Z U routes by physical position, F G H abilities, Space launches', () => {
    expect(DEFAULT_BINDINGS['route.1']).toBe('KeyT');
    expect(DEFAULT_BINDINGS['route.2']).toBe('KeyY');
    expect(DEFAULT_BINDINGS['ability.3']).toBe('KeyH');
    expect(DEFAULT_BINDINGS['command.6']).toBe('KeyM');
    expect(DEFAULT_BINDINGS['wave.launch']).toBe('Space');
    expect(findConflicts(DEFAULT_BINDINGS).size).toBe(0);
  });

  it('applies changed keys and ignores unknown actions', () => {
    const bindings = resolveBindings({ 'match.pause': 'KeyO', 'nonsense.action': 'KeyA' });
    expect(bindings['match.pause']).toBe('KeyO');
    expect('nonsense.action' in bindings).toBe(false);
  });

  it('finds keys used twice by one side, but lets the two sides share keys', () => {
    expect(DEFAULT_BINDINGS['unit.1']).toBe(DEFAULT_BINDINGS['build.1']);
    const clash = resolveBindings({ 'wave.formation': 'KeyF' });
    expect([...findConflicts(clash)].sort()).toEqual(['ability.1', 'wave.formation']);
  });

  it('turns a key press into the action of the side being played', () => {
    expect(actionForKey('Digit1', 'attacker', DEFAULT_BINDINGS)).toBe('unit.1');
    expect(actionForKey('Digit1', 'defender', DEFAULT_BINDINGS)).toBe('build.1');
    expect(actionForKey('KeyP', 'defender', DEFAULT_BINDINGS)).toBe('match.pause');
    expect(actionForKey('KeyW', 'attacker', DEFAULT_BINDINGS)).toBe('cursor.up');
    expect(actionForKey('KeyW', 'defender', DEFAULT_BINDINGS)).toBeNull();
  });

  it('labels keys in the player layout when known', () => {
    expect(keyLabel('KeyY')).toBe('Y');
    expect(keyLabel('KeyY', new Map([['KeyY', 'z']]))).toBe('Z');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('Space')).toBe('Space');
  });
});
