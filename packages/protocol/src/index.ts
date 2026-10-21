import { DIFFICULTIES, type AiThought, type Difficulty } from '@gtd/ai';
import { LANGUAGES } from '@gtd/i18n';
import type { Command, MatchSnapshot, Side } from '@gtd/sim';
import { z } from 'zod';

/** Bumped whenever a message changes shape, so an old browser tab gets a clear "please reload" instead of errors. */
export const PROTOCOL_VERSION = 7;
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

/** `GET /api/network`: whether phones and tablets in the PC's network can join, and where (spec §3). */
export interface NetworkInfo {
  /** This browser runs on the PC that hosts the game (only the PC can turn sharing on or off). */
  host: boolean;
  /** Phones and tablets in the network can open the game. */
  sharing: boolean;
  /** The game was started for every network (`GTD_HOST=0.0.0.0`), so sharing cannot be turned off here. */
  fixed: boolean;
  /** The port the game runs on; join addresses use it. */
  port: number;
  /** Addresses for phones and tablets, best guess first, such as `http://192.168.1.20:3000/`. */
  addresses: string[];
  /** Addresses that could not be opened, for example because another program uses the port there. */
  failed: string[];
  /** The PC runs Windows, which asks a firewall question the first time the game opens to the network. */
  windows: boolean;
  /** The firewall explainer was shown once already. */
  firewallExplained: boolean;
  /** Phones and tablets connected right now (one per network address). */
  guests: number;
}

/** `PUT /api/network`, from the PC only. */
export const NetworkPatchSchema = z.object({ sharing: z.boolean() });
export type NetworkPatch = z.infer<typeof NetworkPatchSchema>;

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
  /** `nodeId`: hold at that junction ahead instead of the next one (hot-seat junction cursor). */
  z.object({ type: z.literal('holdGroup'), side: attacker, groupId: entityId, nodeId: contentId.optional() }),
  z.object({ type: z.literal('advanceGroup'), side: attacker, groupId: entityId }),
  /** `nodeId`: switch on arriving at that node ahead, without stopping (hot-seat junction cursor). */
  z.object({
    type: z.literal('rerouteGroup'),
    side: attacker,
    groupId: entityId,
    routeId: contentId,
    nodeId: contentId.optional(),
  }),
  z.object({ type: z.literal('retreatGroup'), side: attacker, groupId: entityId }),
  z.object({ type: z.literal('setFormation'), side: attacker, groupId: entityId, formation }),
  /** Focus Defense: take apart an asset in sight (`defenseId` left out: the nearest one; `null`: stop). */
  z.object({
    type: z.literal('focusDefense'),
    side: attacker,
    groupId: entityId,
    defenseId: entityId.nullable().optional(),
  }),
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
    nodeId: contentId.optional(),
  }),
  /** A command slot with effects, used from the selected group (Attacker) or asset (Defender). */
  z.object({
    type: z.literal('useCommand'),
    side: z.enum(['attacker', 'defender']),
    commandId: contentId,
    groupId: entityId.optional(),
    defenseId: entityId.optional(),
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

/** Hot-seat (spec §5.2): each player may pause the match this many times, for up to this long each. */
export const PLANNING_PAUSES = 3;
export const PLANNING_PAUSE_SECONDS = 20;

/** The planning pauses of a hot-seat match: how many each player has left, and the one running now. */
export interface PlanningPauses {
  left: Record<Side, number>;
  /** Who paused the match, while a planning pause runs. */
  by: Side | null;
  /** Seconds until the running pause ends by itself. */
  secondsLeft: number;
}

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
  /** Two people on one PC (one seat plays both sides). */
  hotSeat?: true;
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
    /** Two people on one PC (spec §5.2): needs the `both` seat and no computer; planning pauses instead of pause. */
    hotSeat: z.boolean().optional(),
  }),
  z.object({ type: z.literal('joinMatch'), matchId: contentId, seat: z.enum(SEATS) }),
  z.object({ type: z.literal('leaveMatch') }),
  z.object({ type: z.literal('listMatches') }),
  z.object({ type: z.literal('command'), command: MatchCommandSchema }),
  /** Single player only (a person against the computer): pause or resume, and 1× or 2× speed (spec §6.2). */
  z.object({ type: z.literal('setPaused'), paused: z.boolean() }),
  z.object({ type: z.literal('setSpeed'), speed: z.union([z.literal(1), z.literal(2)]) }),
  /** Hot-seat: one player takes a planning pause; `setPaused` with `paused: false` lets either player end it early. */
  z.object({ type: z.literal('planningPause'), side }),
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
  /**
   * Whether the match clock runs and how fast; `canControl` is true in single player, where pause and speed work.
   * Hot-seat matches add their planning pauses.
   */
  | {
      type: 'clock';
      matchId: string;
      paused: boolean;
      speed: MatchSpeed;
      canControl: boolean;
      planning?: PlanningPauses;
    }
  | { type: 'matches'; matches: MatchSummary[] }
  /** Why the simulation refused one of this connection's commands (e.g. `notEnoughResources`). */
  | { type: 'commandRejected'; command: string; reason: string; side: Side }
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
        | 'notSinglePlayer'
        | 'notHotSeat'
        | 'noPausesLeft';
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
