import type { Action, StagePack } from '@gtd/content-schema';
import type { MatchSnapshot } from '@gtd/sim';
import { describe, expect, it } from 'vitest';
import { commandSlots, extraSlots, orderKey, slotBlocked, slotKey } from './commandSlots';

const action = (id: string, extra: Partial<Action> = {}): Action => ({
  id,
  name: `command.${id}.name`,
  description: `command.${id}.description`,
  target: 'unit',
  effects: [],
  range: 0,
  durationSeconds: 0,
  cost: 0,
  cooldownSeconds: 0,
  ...extra,
});

const catalog = [
  action('hold', { order: 'hold' }),
  action('advance', { order: 'advance' }),
  action('focus-defense', { order: 'dismantle' }),
  action('rush', { effects: [{ type: 'boost', stat: 'speed', magnitude: 0.5 }], cost: 8 }),
];
const pack = { catalog: { commands: catalog } } as unknown as StagePack;

describe('command slots from profile data', () => {
  it('keeps the profile’s key order and skips unknown ids', () => {
    const slots = commandSlots(pack, { commands: ['rush', 'hold', 'nowhere', 'focus-defense'] });
    expect(slots.map((s) => s.id)).toEqual(['rush', 'hold', 'focus-defense']);
    expect(orderKey(slots, 'hold')).toBe('command.2');
    expect(orderKey(slots, 'advance')).toBeUndefined();
    expect(slotKey(slots, slots[2] as Action)).toBe('command.3');
  });

  it('gives own buttons to everything that is not a base order', () => {
    const slots = commandSlots(pack, { commands: ['hold', 'advance', 'focus-defense', 'rush'] });
    expect(extraSlots(slots, 'attacker').map((s) => s.id)).toEqual(['focus-defense', 'rush']);
  });

  it('checks recharge and points for effect commands only', () => {
    const snapshot = { cooldowns: { rush: 10 }, points: { attacker: 20 } } as unknown as MatchSnapshot;
    expect(slotBlocked(snapshot, catalog[3] as Action, 'attacker')).toBe('cooldown');
    expect(slotBlocked({ ...snapshot, cooldowns: {} }, catalog[3] as Action, 'attacker')).toBeNull();
    expect(
      slotBlocked({ ...snapshot, cooldowns: {}, points: { attacker: 2 } }, catalog[3] as Action, 'attacker'),
    ).toBe('notEnoughPoints');
    expect(slotBlocked(snapshot, catalog[0] as Action, 'attacker')).toBeNull();
  });
});
