import { LANGUAGES } from '@gtd/i18n';
import type { Command, MatchSnapshot, Side } from '@gtd/sim';
import { z } from 'zod';

/** Bumped whenever a message changes shape, so an old browser tab gets a clear "please reload" instead of errors. */
export const PROTOCOL_VERSION = 3;
export const WEBSOCKET_PATH = '/ws';

const language = z.enum(LANGUAGES);

// ---- Settings (stored in the save on the PC, edited from any device) ----

/** `auto` picks a preset per device (phones low, tablets medium, PCs high), since all devices share one save. */
export const GRAPHICS_PRESETS = ['auto', 'low', 'medium', 'high', 'ultra'] as const;
export type GraphicsPreset = (typeof GRAPHICS_PRESETS)[number];
const volume = z.number().min(0).max(1);

export const SettingsSchema = z.object({
  /** null until the player has picked a language on first launch. */
  language: language.nullable().default(null),
  graphics: z.enum(GRAPHICS_PRESETS).default('auto'),
  audio: z
    .object({ master: volume.default(0.8), music: volume.default(0.6), effects: volume.default(0.8) })
    .default({ master: 0.8, music: 0.6, effects: 0.8 }),
});
export type Settings = z.infer<typeof SettingsSchema>;

/** A partial update; only the given fields change. */
export const SettingsPatchSchema = z
  .object({
    language: language.nullable(),
    graphics: z.enum(GRAPHICS_PRESETS),
    audio: z.object({ master: volume, music: volume, effects: volume }).partial(),
  })
  .partial();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

// ---- HTTP API ----

export interface StageSummary {
  id: string;
  order: number;
  devOnly: boolean;
  title: Record<(typeof LANGUAGES)[number], string>;
  levelCount: number;
}

export interface HealthResponse {
  ok: true;
  name: 'guos-tower-defense';
  version: string;
  protocolVersion: number;
  stages: StageSummary[];
}

// ---- Match commands (checked here, then by the simulation's own rules) ----

const entityId = z.number().int().positive();
const contentId = z.string().min(1).max(64);
const formation = z.enum(['column', 'spread']);
const attacker = z.literal('attacker');
const defender = z.literal('defender');

export const MatchCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('launchWave'),
    side: attacker,
    groups: z
      .array(
        z.object({
          unitTypeId: contentId,
          count: z.number().int().min(1).max(999),
          formation,
          routeId: contentId,
          delaySeconds: z.number().min(0).max(600),
        }),
      )
      .min(1)
      .max(8),
  }),
  z.object({ type: z.literal('holdGroup'), side: attacker, groupId: entityId }),
  z.object({ type: z.literal('advanceGroup'), side: attacker, groupId: entityId }),
  z.object({ type: z.literal('rerouteGroup'), side: attacker, groupId: entityId, routeId: contentId }),
  z.object({ type: z.literal('retreatGroup'), side: attacker, groupId: entityId }),
  z.object({ type: z.literal('setFormation'), side: attacker, groupId: entityId, formation }),
  z.object({ type: z.literal('placeDefense'), side: defender, defenseTypeId: contentId, nodeId: contentId }),
  z.object({ type: z.literal('upgradeDefense'), side: defender, defenseId: entityId }),
  z.object({ type: z.literal('repairDefense'), side: defender, defenseId: entityId }),
  z.object({ type: z.literal('sellDefense'), side: defender, defenseId: entityId }),
  z.object({
    type: z.literal('orderDefense'),
    side: defender,
    defenseId: entityId,
    order: z.discriminatedUnion('type', [
      z.object({ type: z.literal('guard'), nodeId: contentId }),
      z.object({ type: z.literal('patrol'), nodeIds: z.tuple([contentId, contentId]) }),
    ]),
  }),
  z.object({
    type: z.literal('setPriority'),
    side: defender,
    defenseId: entityId,
    priority: z.enum(['first', 'last', 'strongest', 'weakest', 'fastest']),
  }),
  z.object({
    type: z.literal('focusTarget'),
    side: defender,
    defenseId: entityId,
    groupId: entityId.nullable(),
  }),
  z.object({
    type: z.literal('useAbility'),
    side: z.enum(['attacker', 'defender']),
    abilityId: contentId,
    x: z.number().finite().optional(),
    z: z.number().finite().optional(),
    groupId: entityId.optional(),
    routeId: contentId.optional(),
  }),
]);
/** A command as a client sends it; the server adds the tick. */
export type MatchCommand = z.infer<typeof MatchCommandSchema>;
/** The simulation command for a checked client command (the type check proves the two stay in step). */
export function withTick(command: MatchCommand, tick: number): Command {
  return { ...command, tick };
}

/** In a debug match a connection plays one side, both sides (hot-seat style), or only watches. */
export const SEATS = ['attacker', 'defender', 'both', 'spectator'] as const;
export type Seat = (typeof SEATS)[number];

export function seatControls(seat: Seat, side: Side): boolean {
  return seat === 'both' || seat === side;
}

export interface MatchSummary {
  matchId: string;
  stageId: string;
  levelId: string;
  /** Seats taken by connected players. */
  seats: Seat[];
  phase: MatchSnapshot['phase'];
}

// ---- WebSocket messages ----

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    protocolVersion: z.number().int(),
    clientId: z.string().min(1).max(64),
  }),
  z.object({ type: z.literal('ping'), sentAt: z.number() }),
  /** Watch a match the server plays by itself on a level (the level preview until real matches arrive in M2). */
  z.object({ type: z.literal('watchDemo'), stageId: z.string().min(1), levelId: z.string().min(1) }),
  z.object({ type: z.literal('stopWatching') }),
  /** Start a match between people on this server (debug controls until the real HUD arrives in M4). */
  z.object({
    type: z.literal('createMatch'),
    stageId: contentId,
    levelId: contentId,
    attackerProfileId: contentId.optional(),
    defenderProfileId: contentId.optional(),
    seat: z.enum(SEATS),
  }),
  z.object({ type: z.literal('joinMatch'), matchId: contentId, seat: z.enum(SEATS) }),
  z.object({ type: z.literal('leaveMatch') }),
  z.object({ type: z.literal('listMatches') }),
  z.object({ type: z.literal('command'), command: MatchCommandSchema }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type ServerMessage =
  | { type: 'welcome'; serverVersion: string; protocolVersion: number; stages: StageSummary[] }
  | { type: 'pong'; sentAt: number }
  | {
      type: 'matchStarted';
      matchId: string;
      stageId: string;
      levelId: string;
      attackerProfileId: string;
      defenderProfileId: string;
    }
  | { type: 'snapshot'; matchId: string; snapshot: MatchSnapshot }
  | { type: 'joined'; matchId: string; seat: Seat }
  | { type: 'matches'; matches: MatchSummary[] }
  /** Why the simulation refused one of this connection's commands (e.g. `notEnoughResources`). */
  | { type: 'commandRejected'; command: string; reason: string }
  | {
      type: 'error';
      code:
        'badMessage' | 'protocolMismatch' | 'unknownLevel' | 'unknownMatch' | 'notYourSide' | 'notInMatch';
      message: string;
    };

/** How often the server sends match snapshots; clients interpolate between them. */
export const SNAPSHOT_EVERY_TICKS = 2;

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const parsed = ClientMessageSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
