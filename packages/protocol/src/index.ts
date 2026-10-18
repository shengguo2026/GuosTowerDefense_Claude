import { DIFFICULTIES, type AiThought, type Difficulty } from '@gtd/ai';
import { LANGUAGES } from '@gtd/i18n';
import type { Command, MatchSnapshot, Side } from '@gtd/sim';
import { z } from 'zod';

/** Bumped whenever a message changes shape, so an old browser tab gets a clear "please reload" instead of errors. */
export const PROTOCOL_VERSION = 5;
export const WEBSOCKET_PATH = '/ws';

const language = z.enum(LANGUAGES);

// ---- Settings (stored in the save on the PC, edited from any device) ----

/** `auto` picks a preset per device (phones low, tablets medium, PCs high), since all devices share one save. */
export const GRAPHICS_PRESETS = ['auto', 'low', 'medium', 'high', 'ultra'] as const;
export type GraphicsPreset = (typeof GRAPHICS_PRESETS)[number];
const volume = z.number().min(0).max(1);
const side = z.enum(['attacker', 'defender']);
/** A key binding is the physical key position (`KeyboardEvent.code`), so `T Z U` stays the same keys on QWERTZ. */
const keyCode = z.string().regex(/^[A-Za-z0-9]{1,24}$/);
const actionName = z.string().regex(/^[a-z][a-zA-Z0-9.]{0,48}$/);
const scale = z.number().min(0.8).max(1.6);

const accessibilityFields = {
  /** Size of the whole interface. */
  uiScale: scale,
  /** Size of text on top of the interface size. */
  textScale: scale,
  /** Stronger, wider route markers on the map. */
  highContrastRoutes: z.boolean(),
  /** Fewer moving effects (also follows the system's reduced-motion setting). */
  reducedEffects: z.boolean(),
};

export const SettingsSchema = z.object({
  /** null until the player has picked a language on first launch. */
  language: language.nullable().default(null),
  graphics: z.enum(GRAPHICS_PRESETS).default('auto'),
  audio: z
    .object({ master: volume.default(0.8), music: volume.default(0.6), effects: volume.default(0.8) })
    .default({ master: 0.8, music: 0.6, effects: 0.8 }),
  /** Keys the player changed; every other action keeps its default key. */
  keyBindings: z.record(actionName, keyCode).default({}),
  accessibility: z
    .object({
      uiScale: scale.default(1),
      textScale: scale.default(1),
      highContrastRoutes: z.boolean().default(false),
      reducedEffects: z.boolean().default(false),
    })
    .default({ uiScale: 1, textScale: 1, highContrastRoutes: false, reducedEffects: false }),
  /** First-time hints already shown, and the sides whose tutorial was finished or skipped. */
  onboarding: z
    .object({
      hintsSeen: z.array(actionName).max(200).default([]),
      tutorialsDone: z.array(side).default([]),
      tutorialOffered: z.boolean().default(false),
    })
    .default({ hintsSeen: [], tutorialsDone: [], tutorialOffered: false }),
  /** Optional name shown in matches and results. */
  playerName: z.string().trim().max(24).default(''),
});
export type Settings = z.infer<typeof SettingsSchema>;

/** A partial update; only the given fields change (nested groups are merged, `keyBindings` is replaced). */
export const SettingsPatchSchema = z
  .object({
    language: language.nullable(),
    graphics: z.enum(GRAPHICS_PRESETS),
    audio: z.object({ master: volume, music: volume, effects: volume }).partial(),
    keyBindings: z.record(actionName, keyCode),
    accessibility: z.object(accessibilityFields).partial(),
    onboarding: z
      .object({
        hintsSeen: z.array(actionName).max(200),
        tutorialsDone: z.array(side),
        tutorialOffered: z.boolean(),
      })
      .partial(),
    playerName: z.string().trim().max(24),
  })
  .partial();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

// ---- Progress (stored in the save on the PC) ----

/** Single-player wins per level: which difficulties each side has beaten. */
export type LevelRecord = Record<Side, Difficulty[]>;

export interface Progress {
  /** Completed levels per stage; a completed level unlocks the next one. */
  completedLevels: Record<string, string[]>;
  /** Wins per stage, then per level. */
  wins: Record<string, Record<string, LevelRecord>>;
}

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

export type MatchSpeed = 1 | 2;

/** The side the computer plays in a match against the AI, and how well. */
export interface ComputerPlayer {
  side: Side;
  difficulty: Difficulty;
}

export interface MatchSummary {
  matchId: string;
  stageId: string;
  levelId: string;
  /** Seats taken by connected players. */
  seats: Seat[];
  /** Set when the computer plays one side; that seat cannot be joined. */
  computer?: ComputerPlayer;
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
  /**
   * Start a match on this server (debug controls until the real HUD arrives in M4). With `opponent` the computer plays
   * the side the seat leaves free, at that difficulty; `showAiReasoning` streams the AI's thinking (developer view).
   */
  z.object({
    type: z.literal('createMatch'),
    stageId: contentId,
    levelId: contentId,
    attackerProfileId: contentId.optional(),
    defenderProfileId: contentId.optional(),
    seat: z.enum(SEATS),
    opponent: z.enum(DIFFICULTIES).optional(),
    showAiReasoning: z.boolean().optional(),
    /** A guided tutorial match: it does not count for progress. */
    tutorial: z.boolean().optional(),
  }),
  z.object({ type: z.literal('joinMatch'), matchId: contentId, seat: z.enum(SEATS) }),
  z.object({ type: z.literal('leaveMatch') }),
  z.object({ type: z.literal('listMatches') }),
  z.object({ type: z.literal('command'), command: MatchCommandSchema }),
  /** Single player only (a person against the computer): pause or resume, and 1× or 2× speed (spec §6.2). */
  z.object({ type: z.literal('setPaused'), paused: z.boolean() }),
  z.object({ type: z.literal('setSpeed'), speed: z.union([z.literal(1), z.literal(2)]) }),
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
      computer?: ComputerPlayer;
    }
  | { type: 'snapshot'; matchId: string; snapshot: MatchSnapshot }
  /** One round of the computer's reasoning, sent only when the match was started with `showAiReasoning`. */
  | { type: 'aiThought'; matchId: string; thought: AiThought }
  | { type: 'joined'; matchId: string; seat: Seat }
  /** Whether the match clock runs and how fast; `canControl` is true in single player, where pause and speed work. */
  | { type: 'clock'; matchId: string; paused: boolean; speed: MatchSpeed; canControl: boolean }
  | { type: 'matches'; matches: MatchSummary[] }
  /** Why the simulation refused one of this connection's commands (e.g. `notEnoughResources`). */
  | { type: 'commandRejected'; command: string; reason: string }
  | {
      type: 'error';
      code:
        | 'badMessage'
        | 'protocolMismatch'
        | 'unknownLevel'
        | 'unknownMatch'
        | 'notYourSide'
        | 'notInMatch'
        | 'seatTaken'
        | 'notSinglePlayer';
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
