import { z } from 'zod';

/** Stage pack format version. Bump when the format changes in a way older loaders cannot read. */
export const STAGE_SCHEMA_VERSION = 1;

export const LANGUAGES = ['en', 'de', 'zh-CN'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Limits from the specification (§2.1): the HUD has room for this many ability and command slots per profile. */
export const MAX_ABILITY_SLOTS = 5;
export const MAX_COMMAND_SLOTS = 6;

const id = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'ids use lowercase letters, digits and dashes');
/** Key into the stage's texts/<language>.json files. Player-facing text never lives directly in data files. */
const textKey = z.string().min(1);
const sideValues = z.object({ attacker: z.number().nonnegative(), defender: z.number().nonnegative() });

export const StageManifestSchema = z.object({
  schemaVersion: z.literal(STAGE_SCHEMA_VERSION),
  id,
  order: z.number().int(),
  /** A core stage must load; a broken optional stage is skipped with a warning. */
  core: z.boolean().default(false),
  /** Only shown in developer mode and tests. */
  devOnly: z.boolean().default(false),
  title: textKey,
  levels: z.array(id).min(1),
  profiles: z.object({ attacker: z.array(id).min(1), defender: z.array(id).min(1) }),
  /** Stage plugins for mechanics the building blocks cannot express. Loaded from the pack's plugins folder. */
  plugins: z.array(z.object({ id, entry: z.string().min(1) })).default([]),
});

export const NODE_KINDS = ['spawn', 'junction', 'checkpoint', 'connector', 'objective', 'buildZone'] as const;

export const MapNodeSchema = z.object({
  id,
  x: z.number(),
  z: z.number(),
  kind: z.enum(NODE_KINDS).optional(),
  buildable: z.boolean().optional(),
});

const point = z.tuple([z.number(), z.number()]);

/**
 * How the level looks. `kit` names the world builder in the client (e.g. `savanna`); landmarks and animals are
 * placed by the level so the same kit serves several levels.
 */
export const SceneSchema = z.object({
  kit: z.string().min(1),
  /** Seed for scattering trees, rocks and grass, so the level looks the same every time. */
  seed: z.number().int(),
  /** Width and depth of the terrain in map units. */
  size: z.number().positive(),
  /** Route whose path carves a dry streambed into the terrain. */
  streambedRoute: id.optional(),
  landmarks: z
    .array(
      z.object({
        id,
        kind: z.string().min(1),
        x: z.number(),
        z: z.number(),
        radius: z.number().positive().default(6),
        rotation: z.number().default(0),
        label: textKey.optional(),
      }),
    )
    .default([]),
  animals: z
    .array(
      z.object({
        kind: z.string().min(1),
        x: z.number(),
        z: z.number(),
        rotation: z.number().default(0),
        pose: z.enum(['standing', 'lying']).default('standing'),
      }),
    )
    .default([]),
  /** Where the camera starts: the point it looks at, plus angle and distance. */
  camera: z
    .object({
      x: z.number(),
      z: z.number(),
      yaw: z.number(),
      pitch: z.number(),
      distance: z.number().positive(),
    })
    .optional(),
});

export const LevelSchema = z.object({
  id,
  title: textKey,
  /** Level that must be completed first; null means unlocked from the start. */
  unlockedBy: id.nullable(),
  timerSeconds: z.number().positive(),
  objective: z.object({ nodeId: id, holdSeconds: z.number().positive() }),
  map: z.object({
    nodes: z.array(MapNodeSchema).min(2),
    edges: z.array(z.object({ from: id, to: id, via: z.array(point).optional() })).min(1),
  }),
  routes: z.array(z.object({ id, name: textKey.optional(), nodes: z.array(id).min(2) })).min(1),
  scene: SceneSchema.optional(),
  startingResources: sideValues,
  incomePerSecond: sideValues,
});

/** Generic building blocks that abilities and commands are composed of (spec §2.1). */
export const EFFECT_TYPES = [
  'slow',
  'reveal',
  'conceal',
  'protect',
  'disrupt',
  'boost',
  'move',
  'spawn',
  'blockBranch',
  'resource',
] as const;
export const TARGET_TYPES = ['self', 'area', 'unit', 'route', 'junction'] as const;

export const EffectSchema = z.object({
  type: z.enum(EFFECT_TYPES),
  /** Strength of the effect; its meaning depends on the type (e.g. 0.3 = 30% slow). */
  magnitude: z.number().optional(),
  /** For `spawn`: the unit or defense id to create. */
  spawn: id.optional(),
});

export const ActionSchema = z.object({
  id,
  name: textKey,
  description: textKey,
  target: z.enum(TARGET_TYPES),
  effects: z.array(EffectSchema).min(1),
  range: z.number().nonnegative().default(0),
  durationSeconds: z.number().nonnegative().default(0),
  cost: z.number().nonnegative().default(0),
  cooldownSeconds: z.number().nonnegative().default(0),
});

export const UnitSchema = z.object({
  id,
  name: textKey,
  speed: z.number().positive(),
  cost: z.number().nonnegative(),
  resilience: z.number().positive(),
});

export const DefenseSchema = z.object({
  id,
  name: textKey,
  cost: z.number().nonnegative(),
  range: z.number().positive(),
  pressurePerSecond: z.number().nonnegative(),
});

export const CatalogSchema = z.object({
  units: z.array(UnitSchema).default([]),
  defenses: z.array(DefenseSchema).default([]),
  abilities: z.array(ActionSchema).default([]),
  commands: z.array(ActionSchema).default([]),
});

export const ProfileSchema = z.object({
  id,
  side: z.enum(['attacker', 'defender']),
  name: textKey,
  description: textKey,
  resource: z.object({ id, name: textKey }),
  passive: z.object({ name: textKey, description: textKey, effects: z.array(EffectSchema).default([]) }),
  /** Attacker profiles list units, Defender profiles list defenses. */
  units: z.array(id).default([]),
  defenses: z.array(id).default([]),
  abilities: z.array(id).max(MAX_ABILITY_SLOTS),
  commands: z.array(id).max(MAX_COMMAND_SLOTS),
});

export const TextsSchema = z.record(z.string(), z.string());

export type StageManifest = z.infer<typeof StageManifestSchema>;
export type Level = z.infer<typeof LevelSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type Catalog = z.infer<typeof CatalogSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type Texts = z.infer<typeof TextsSchema>;

/** A fully loaded and validated stage pack. */
export interface StagePack {
  manifest: StageManifest;
  levels: Level[];
  profiles: Profile[];
  catalog: Catalog;
  texts: Record<Language, Texts>;
}
