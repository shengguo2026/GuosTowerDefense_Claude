import type { Side } from '@gtd/sim';

/**
 * Keyboard shortcuts for single player and for the Attacker in hot-seat (spec §5.2 and §15). Bindings are physical key positions
 * (`KeyboardEvent.code`), so `T Z U` stays three neighbouring keys on a German QWERTZ keyboard. Ability and command
 * slots follow the profile's own lists, so a new stage gets shortcuts without code.
 */
export interface KeyAction {
  id: string;
  /** Interface text key for the action name. */
  label: string;
  /** Which side's HUD uses it; `both` for match-wide actions. */
  side: Side | 'both';
  defaultKey: string;
  /** Number shown with the label (slot 1, route 2 …). */
  slot?: number;
}

const slots = (prefix: string, label: string, side: Side | 'both', keys: string[]): KeyAction[] =>
  keys.map((key, i) => ({ id: `${prefix}.${i + 1}`, label, side, defaultKey: key, slot: i + 1 }));

export const KEY_ACTIONS: KeyAction[] = [
  { id: 'match.pause', label: 'keys.pause', side: 'both', defaultKey: 'KeyP' },
  { id: 'match.speed', label: 'keys.speed', side: 'both', defaultKey: 'KeyQ' },
  { id: 'match.menu', label: 'keys.menu', side: 'both', defaultKey: 'F10' },
  ...slots('ability', 'keys.ability', 'both', ['KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK']),
  ...slots('command', 'keys.command', 'both', ['KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM']),
  ...slots('unit', 'keys.unit', 'attacker', ['Digit1', 'Digit2', 'Digit3', 'Digit4']),
  ...slots('route', 'keys.route', 'attacker', ['KeyT', 'KeyY', 'KeyU']),
  // The junction cursor on the hot-seat route schematic.
  { id: 'cursor.up', label: 'keys.cursorUp', side: 'attacker', defaultKey: 'KeyW' },
  { id: 'cursor.left', label: 'keys.cursorLeft', side: 'attacker', defaultKey: 'KeyA' },
  { id: 'cursor.down', label: 'keys.cursorDown', side: 'attacker', defaultKey: 'KeyS' },
  { id: 'cursor.right', label: 'keys.cursorRight', side: 'attacker', defaultKey: 'KeyD' },
  { id: 'wave.formation', label: 'keys.formation', side: 'attacker', defaultKey: 'KeyR' },
  { id: 'wave.addGroup', label: 'keys.addGroup', side: 'attacker', defaultKey: 'Enter' },
  { id: 'wave.launch', label: 'keys.launch', side: 'attacker', defaultKey: 'Space' },
  { id: 'group.next', label: 'keys.nextGroup', side: 'attacker', defaultKey: 'Tab' },
  ...slots('build', 'keys.build', 'defender', ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6']),
  { id: 'asset.next', label: 'keys.nextAsset', side: 'defender', defaultKey: 'Tab' },
];

export const DEFAULT_BINDINGS: Record<string, string> = Object.fromEntries(
  KEY_ACTIONS.map((action) => [action.id, action.defaultKey]),
);

/** The key for every action: the player's changes over the defaults. */
export function resolveBindings(overrides: Record<string, string>): Record<string, string> {
  const resolved = { ...DEFAULT_BINDINGS };
  for (const [id, key] of Object.entries(overrides)) if (id in resolved) resolved[id] = key;
  return resolved;
}

/** Actions of one side that share a key (both sides' actions may share, they are never active together). */
export function findConflicts(bindings: Record<string, string>): Set<string> {
  const conflicts = new Set<string>();
  for (const side of ['attacker', 'defender'] as const) {
    const active = KEY_ACTIONS.filter((a) => a.side === side || a.side === 'both');
    const byKey = new Map<string, string[]>();
    for (const action of active) {
      const key = bindings[action.id];
      if (!key) continue;
      byKey.set(key, [...(byKey.get(key) ?? []), action.id]);
    }
    for (const ids of byKey.values()) if (ids.length > 1) ids.forEach((id) => conflicts.add(id));
  }
  return conflicts;
}

/** The action a key press triggers for a side, if any. */
export function actionForKey(code: string, side: Side, bindings: Record<string, string>): string | null {
  for (const action of KEY_ACTIONS) {
    if (action.side !== side && action.side !== 'both') continue;
    if (bindings[action.id] === code) return action.id;
  }
  return null;
}

/** Keys that can never be bound: they leave the game or are needed by the browser and screen readers. */
export const RESERVED_KEYS = new Set([
  'Escape',
  'F5',
  'F11',
  'F12',
  'MetaLeft',
  'MetaRight',
  'AltLeft',
  'AltRight',
]);

/**
 * A readable name for a physical key in the player's own layout where the browser can tell (Chrome's keyboard map),
 * otherwise from the US layout.
 */
export function keyLabel(code: string, layout?: Map<string, string>): string {
  const mapped = layout?.get(code);
  if (mapped && mapped.trim()) return mapped.toUpperCase();
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  const names: Record<string, string> = {
    Space: 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: '⌫',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift',
    ControlLeft: 'Ctrl',
    ControlRight: 'Ctrl',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
  };
  return names[code] ?? code;
}

interface KeyboardLayoutMap {
  get(code: string): string | undefined;
  entries(): IterableIterator<[string, string]>;
}

/** Reads the player's keyboard layout where the browser offers it (Chrome, Edge); elsewhere resolves to undefined. */
export async function readKeyboardLayout(): Promise<Map<string, string> | undefined> {
  const keyboard = (navigator as { keyboard?: { getLayoutMap?: () => Promise<KeyboardLayoutMap> } }).keyboard;
  if (!keyboard?.getLayoutMap) return undefined;
  try {
    return new Map((await keyboard.getLayoutMap()).entries());
  } catch {
    return undefined;
  }
}
