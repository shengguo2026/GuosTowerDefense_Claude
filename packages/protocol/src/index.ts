import { LANGUAGES } from '@gtd/i18n';
import type { MatchSnapshot } from '@gtd/sim';
import { z } from 'zod';

/** Bumped whenever a message changes shape, so an old browser tab gets a clear "please reload" instead of errors. */
export const PROTOCOL_VERSION = 2;
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
  | { type: 'error'; code: 'badMessage' | 'protocolMismatch' | 'unknownLevel'; message: string };

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
