import type { Action, StagePack } from '@gtd/content-schema';
import type { MatchSnapshot, OrderType, Side } from '@gtd/sim';

/**
 * Orders every Attacker or Defender has, whether or not the profile puts them on a key: they always show in the orders
 * panel. Anything else a profile slots (Focus Defense, Rush, Fortify …) gets its own button next to them.
 */
export const BASE_ORDERS: Record<Side, readonly OrderType[]> = {
  attacker: ['hold', 'advance', 'retreat', 'reroute', 'formation'],
  defender: ['upgrade', 'repair', 'sell', 'priority', 'focus', 'guard', 'patrol'],
};

/** A profile's command slots from the catalog, in key order (`command.1` is the first). */
export function commandSlots(pack: StagePack, profile: { commands: string[] } | undefined): Action[] {
  return (profile?.commands ?? []).flatMap((id) => pack.catalog.commands.find((c) => c.id === id) ?? []);
}

/** The key action of the slot standing for an order, if the profile slots it. */
export function orderKey(slots: Action[], order: OrderType): string | undefined {
  const index = slots.findIndex((slot) => slot.order === order);
  return index < 0 ? undefined : `command.${index + 1}`;
}

/** The key action of a slot. */
export function slotKey(slots: Action[], action: Action): string {
  return `command.${slots.indexOf(action) + 1}`;
}

/** Slotted commands that are not one of the side's base orders, so they need their own buttons. */
export function extraSlots(slots: Action[], side: Side): Action[] {
  return slots.filter((slot) => !slot.order || !BASE_ORDERS[side].includes(slot.order));
}

/** Why an effect command cannot be used right now (a rejection reason), or null. */
export function slotBlocked(snapshot: MatchSnapshot, action: Action, side: Side): string | null {
  if (action.order) return null;
  if ((snapshot.cooldowns[action.id] ?? 0) > 0) return 'cooldown';
  if ((snapshot.points[side] ?? 0) < action.cost) return 'notEnoughPoints';
  return null;
}

/** Catalog entries in the order a profile lists them, so keys 1 2 3 … and F G H … follow the profile. */
export function inProfileOrder<T extends { id: string }>(items: T[], ids: string[] | undefined): T[] {
  return (ids ?? []).flatMap((id) => items.find((item) => item.id === id) ?? []);
}
