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
/** Id of a Codex picture in assets/art (e.g. `LEVEL-01-LION`); the game shows a placeholder until the file exists. */
const artId = z.string().regex(/^[A-Z0-9]+(-[A-Z0-9]+)*$/, 'art ids use capital letters, digits and dashes');
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
  /** One or two sentences for the stage select. */
  description: textKey.optional(),
  /** Stage info picture for the stage select and briefings. */
  picture: artId.optional(),
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

export const TERRAINS = ['open', 'cover'] as const;

/** Anti-stalemate timer when a level does not set its own (spec §6.2). */
export const DEFAULT_TIMER_SECONDS = 20 * 60;

/**
 * When a tutorial step is done. Steps are data so every stage can teach its own levels; the client checks them against
 * what the player does and what the match shows.
 */
export const TutorialConditionSchema = z.discriminatedUnion('type', [
  /** The player reads the text and presses Next; the match waits meanwhile. */
  z.object({ type: z.literal('continue') }),
  z.object({ type: z.literal('phase'), phase: z.enum(['combat']) }),
  /** The Defender has an asset of this type (any asset when left out). */
  z.object({ type: z.literal('build'), defense: id.optional() }),
  z.object({ type: z.literal('upgrade') }),
  z.object({ type: z.literal('launch') }),
  /** An ability (any of the side's when left out) is cooling down after use. */
  z.object({ type: z.literal('ability'), ability: id.optional() }),
  /** The player gave a group or an asset this order. */
  z.object({
    type: z.literal('order'),
    order: z.enum(['hold', 'advance', 'reroute', 'retreat', 'formation', 'priority', 'guard', 'patrol']),
  }),
  z.object({ type: z.literal('select'), kind: z.enum(['group', 'defense']) }),
  /** Defender: a group has been detected. Attacker: a defense has been seen. */
  z.object({ type: z.literal('spotted') }),
  z.object({ type: z.literal('objective') }),
]);

export const TutorialStepSchema = z.object({
  text: textKey,
  /** HUD element to point at (its `data-tutorial` name). */
  highlight: z.string().min(1).optional(),
  until: TutorialConditionSchema,
});
const terrainModifiers = z.object({ speed: z.number().positive(), detection: z.number().positive() });

export const LevelSchema = z.object({
  id,
  title: textKey,
  /** Level that must be completed first; null means unlocked from the start. */
  unlockedBy: id.nullable(),
  /** One or two sentences for the level select. */
  description: textKey.optional(),
  /** Level info picture for the level select and the briefing. */
  picture: artId.optional(),
  /** What Chief Warden Guo tells each side before the match. */
  briefing: z.object({ attacker: textKey, defender: textKey }).optional(),
  /** Guided tutorial for each side on this level (spec §15). */
  tutorial: z
    .object({ attacker: z.array(TutorialStepSchema).min(1), defender: z.array(TutorialStepSchema).min(1) })
    .partial()
    .optional(),
  /** Length of the combat phase; preparation comes on top. */
  timerSeconds: z.number().positive().default(DEFAULT_TIMER_SECONDS),
  preparationSeconds: z.number().nonnegative().default(30),
  objective: z.object({
    nodeId: id,
    holdSeconds: z.number().positive(),
    /** Radius of the objective zone; a Defender patrol inside it pauses the hold timer. */
    radius: z.number().positive().default(4.5),
  }),
  map: z.object({
    nodes: z.array(MapNodeSchema).min(2),
    edges: z
      .array(
        z.object({ from: id, to: id, via: z.array(point).optional(), terrain: z.enum(TERRAINS).optional() }),
      )
      .min(1),
  }),
  routes: z.array(z.object({ id, name: textKey.optional(), nodes: z.array(id).min(2) })).min(1),
  scene: SceneSchema.optional(),
  /** Total capacity the Attacker can deploy over the whole match. */
  deploymentCapacity: z.number().positive().default(40),
  launchCooldownSeconds: z.number().nonnegative().default(15),
  maxActiveWaves: z.number().int().positive().default(2),
  startingResources: sideValues,
  incomePerSecond: sideValues,
  /** The profile's second resource (e.g. Recon Points), spent on abilities. */
  startingPoints: sideValues.default({ attacker: 20, defender: 20 }),
  pointsPerSecond: sideValues.default({ attacker: 0.5, defender: 0.5 }),
  bonuses: z
    .object({
      checkpointPass: z.number().nonnegative(),
      memberTurnedBack: z.number().nonnegative(),
      waveStopped: z.number().nonnegative(),
      retreatRefund: z.number().min(0).max(1),
    })
    .default({ checkpointPass: 10, memberTurnedBack: 3, waveStopped: 20, retreatRefund: 0.5 }),
  /** Open Ground Exposure: open ground is faster but easier to detect, cover slower but safer. */
  terrain: z
    .object({ open: terrainModifiers, cover: terrainModifiers })
    .default({ open: { speed: 1.15, detection: 1.3 }, cover: { speed: 0.85, detection: 0.6 } }),
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
  /** For `boost`: what is raised (default speed). */
  stat: z.enum(['speed', 'detectionRange']).optional(),
  /** For passives: when the effect applies, e.g. `knownRoute` (a route an earlier wave already used). */
  condition: z.enum(['knownRoute']).optional(),
});

export const ActionSchema = z.object({
  id,
  name: textKey,
  icon: artId.optional(),
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
  icon: artId.optional(),
  speed: z.number().positive(),
  /** Supplies per member. */
  cost: z.number().nonnegative(),
  /** Deployment capacity per member. */
  capacity: z.number().positive().default(1),
  /** Pressure needed to turn back one member. */
  resilience: z.number().positive(),
  visibility: z.enum(['normal', 'concealed', 'stealth']).default('normal'),
  /** How close the unit must come to a defense to see it. */
  sightRange: z.number().positive().default(12),
});

export const DefenseSchema = z.object({
  id,
  name: textKey,
  icon: artId.optional(),
  cost: z.number().nonnegative(),
  /** Mobile assets (patrols) move along the route graph. */
  mobile: z.boolean().default(false),
  /** Build zones, route nodes, or either. Mobile assets always start on a route node. */
  placement: z.enum(['buildZone', 'routeNode', 'any']).default('buildZone'),
  /** Reach of interception and slowing. */
  range: z.number().positive(),
  /** Defaults to `range`. */
  detectionRange: z.number().positive().optional(),
  pressurePerSecond: z.number().nonnegative(),
  /** Share of speed groups in reach lose. */
  slow: z.number().min(0).max(1).default(0),
  speed: z.number().nonnegative().default(0),
  /** How many the Defender may have at once. */
  maxCount: z.number().int().positive().optional(),
  /** On a route node, stops groups like a roadblock. The Defender may never block every route. */
  blocksNode: z.boolean().default(false),
  maxLevel: z.number().int().positive().default(3),
  upgradeCostFactor: z.number().nonnegative().default(0.75),
  /** Condition a roadblock loses per second for each member pushing against it. */
  wearPerMemberSecond: z.number().nonnegative().default(0),
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
  portrait: artId.optional(),
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
export type Effect = z.infer<typeof EffectSchema>;
export type Texts = z.infer<typeof TextsSchema>;
export type TutorialStep = z.infer<typeof TutorialStepSchema>;
export type TutorialCondition = z.infer<typeof TutorialConditionSchema>;

/** A fully loaded and validated stage pack. */
export interface StagePack {
  manifest: StageManifest;
  levels: Level[];
  profiles: Profile[];
  catalog: Catalog;
  texts: Record<Language, Texts>;
}
