import type { CloseContact } from './types';

/**
 * Close Contact and Ambush Zones (Rhinoceros). In dense bush engagements are short and close: an asset presses
 * harder within the level's contact range and weaker beyond it, so long-range structures lose their edge and mobile
 * defenders that close in matter more. Nobody stays hidden at arm's length.
 */

/**
 * Share of its sight range at which the Attacker spots a Defender asset standing in an Ambush Zone: a Scout (16) sees a
 * patrol there just before it is in its reach, a team (10) only once it is.
 */
export const AMBUSH_SIGHT = 0.4;
/** How long a group caught in an ambush stops in surprise. */
export const AMBUSH_PIN_SECONDS = 1.5;
/** How long a group caught in an ambush takes extra pressure, and how much more. */
export const AMBUSH_SECONDS = 4;
export const AMBUSH_PRESSURE = 0.5;

/** Factor on an asset's pressure on a group `gap` away: `near` within the contact range, `far` beyond it. */
export function contactFactor(contact: CloseContact | undefined, gap: number): number {
  if (!contact) return 1;
  return gap <= contact.range ? contact.near : contact.far;
}

/** Whether two things are within the contact range, where line of sight past cover no longer matters. */
export function inContact(contact: CloseContact | undefined, gap: number): boolean {
  return contact !== undefined && gap <= contact.range;
}
