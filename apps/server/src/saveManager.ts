import { copyFile, mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DIFFICULTIES, type Difficulty } from '@gtd/ai';
import { STAGE_SCHEMA_VERSION } from '@gtd/content-schema';
import { BALANCE_VERSION } from '@gtd/progression';
import {
  HighScoreSchema,
  SettingsSchema,
  StatisticsSchema,
  type Progress,
  type Records,
  type SaveInfo,
  type SettingsPatch,
} from '@gtd/protocol';
import type { Side } from '@gtd/sim';
import { z } from 'zod';

export const SAVE_VERSION = 2;
/** Rolling backups: each write keeps the save it replaces, and the oldest beyond this many are removed. */
export const BACKUPS_KEPT = 5;

export const SaveSchema = z.object({
  version: z.literal(SAVE_VERSION),
  /** Versions tracked apart (masterplan §35): which game, content and balance rules last wrote the save. */
  meta: z
    .object({
      gameVersion: z.string().default('0.0.0'),
      contentVersion: z.string().default(''),
      balanceVersion: z.number().int().default(0),
    })
    .default({ gameVersion: '0.0.0', contentVersion: '', balanceVersion: 0 }),
  settings: SettingsSchema,
  /** Completed levels per stage; level and difficulty unlocks are derived from this. */
  unlocks: z.object({ stages: z.record(z.string(), z.object({ completedLevels: z.array(z.string()) })) }),
  /** Wins against the computer: per stage, per level, the difficulties each side has beaten. */
  records: z
    .record(
      z.string(),
      z.record(
        z.string(),
        z.object({
          attacker: z.array(z.enum(DIFFICULTIES)).default([]),
          defender: z.array(z.enum(DIFFICULTIES)).default([]),
        }),
      ),
    )
    .default({}),
  /** Profile XP per stage, then per profile (spec §12): XP is stored, the level is derived from it. */
  profiles: z
    .record(z.string(), z.record(z.string(), z.object({ xp: z.number().int().nonnegative().default(0) })))
    .default({}),
  highScores: z.array(HighScoreSchema).default([]),
  statistics: StatisticsSchema.default(StatisticsSchema.parse({})),
  /** Phones and tablets may join (kept across restarts), and the firewall explainer was shown (spec §14, G14). */
  network: z
    .object({ shareOnWifi: z.boolean().default(false), firewallExplained: z.boolean().default(false) })
    .default({ shareOnWifi: false, firewallExplained: false }),
  updatedAt: z.string(),
});
export type SaveData = z.infer<typeof SaveSchema>;

export function defaultSave(): SaveData {
  return SaveSchema.parse({
    version: SAVE_VERSION,
    settings: {},
    unlocks: { stages: {} },
    updatedAt: new Date(0).toISOString(),
  });
}

type RawSave = Record<string, unknown> & { version: number };

/**
 * One step per save version: each brings a save from version N to N + 1 and never drops the player's progress. A save
 * from a newer game than this one is not touched (it is kept aside, see `SaveManager.load`).
 */
const MIGRATIONS: Record<number, (save: RawSave) => RawSave> = {
  // Version 2 (M10) adds profile XP, high scores, statistics and the version block; everything else stays.
  1: (save) => ({ ...save, version: 2, profiles: {}, highScores: [], statistics: {} }),
};

/** Brings a save of any known version up to the current one, or returns null if it is not a readable save. */
export function migrateSave(raw: unknown): SaveData | null {
  if (typeof raw !== 'object' || raw === null || typeof (raw as RawSave).version !== 'number') return null;
  let save = raw as RawSave;
  if (save.version > SAVE_VERSION) return null;
  while (save.version < SAVE_VERSION) {
    const step = MIGRATIONS[save.version];
    if (!step) return null;
    save = step(save);
  }
  const parsed = SaveSchema.safeParse(save);
  return parsed.success ? parsed.data : null;
}

export type LoadSource = 'save' | 'backup' | 'new';

/**
 * The one local save on the PC (spec §13). Writes are atomic: the new save goes to a temp file, is read back and
 * validated, the current save joins the rolling backups, and only then the temp file replaces the save. If the save is
 * ever unreadable, it is kept aside for inspection and the newest readable backup is used. Every change is written at
 * once (autosave after matches, XP, unlocks and settings); there is no saving in the middle of a match.
 */
export class SaveManager {
  readonly savePath: string;
  readonly backupDir: string;
  /** The single backup of saves from before M10; still read if nothing newer exists. */
  readonly legacyBackupPath: string;
  private current: SaveData = defaultSave();
  private writes: Promise<unknown> = Promise.resolve();
  private backupCounter = 0;
  lastLoadSource: LoadSource = 'new';

  constructor(
    userDataDir: string,
    private readonly options: { gameVersion?: string } = {},
  ) {
    this.savePath = join(userDataDir, 'saves', 'save.json');
    this.backupDir = join(userDataDir, 'backups');
    this.legacyBackupPath = join(this.backupDir, 'save.backup.json');
  }

  async load(): Promise<SaveData> {
    const fromSave = await readSave(this.savePath);
    let fromBackup: SaveData | null = null;
    if (!fromSave) {
      // Keep a damaged save (or one from a newer game) aside instead of overwriting it later.
      if (await exists(this.savePath)) {
        await mkdir(this.backupDir, { recursive: true });
        await copyFile(this.savePath, join(this.backupDir, `damaged-${stamp()}.json`));
      }
      for (const path of [...(await this.backups()), this.legacyBackupPath]) {
        fromBackup = await readSave(path);
        if (fromBackup) break;
      }
    }
    this.current = fromSave ?? fromBackup ?? defaultSave();
    this.lastLoadSource = fromSave ? 'save' : fromBackup ? 'backup' : 'new';
    return this.data;
  }

  get data(): SaveData {
    return structuredClone(this.current);
  }

  /** Rolling backups, newest first. */
  async backups(): Promise<string[]> {
    const files = await readdir(this.backupDir).catch(() => [] as string[]);
    return files
      .filter((file) => /^save-.+\.json$/.test(file))
      .sort()
      .reverse()
      .map((file) => join(this.backupDir, file));
  }

  async info(): Promise<SaveInfo> {
    return {
      loadedFrom: this.lastLoadSource,
      updatedAt: this.current.updatedAt,
      backups: (await this.backups()).length,
      saveSchemaVersion: SAVE_VERSION,
      gameVersion: this.current.meta.gameVersion,
    };
  }

  updateSettings(patch: SettingsPatch): Promise<SaveData> {
    return this.update((save) => {
      save.settings = SettingsSchema.parse({
        ...save.settings,
        ...patch,
        audio: { ...save.settings.audio, ...patch.audio },
        accessibility: { ...save.settings.accessibility, ...patch.accessibility },
        onboarding: { ...save.settings.onboarding, ...patch.onboarding },
      });
    });
  }

  /** Turning sharing on also means the firewall explainer has been seen. */
  setSharing(sharing: boolean): Promise<SaveData> {
    return this.update((save) => {
      save.network.shareOnWifi = sharing;
      if (sharing) save.network.firewallExplained = true;
    });
  }

  completeLevel(stageId: string, levelId: string): Promise<SaveData> {
    return this.update((save) => completeLevel(save, stageId, levelId));
  }

  /** A win against the computer: completes the level (unlocking the next) and remembers the side and difficulty. */
  recordWin(stageId: string, levelId: string, side: Side, difficulty: Difficulty): Promise<SaveData> {
    return this.update((save) => recordWin(save, stageId, levelId, side, difficulty));
  }

  profileXp(stageId: string, profileId: string): number {
    return this.current.profiles[stageId]?.[profileId]?.xp ?? 0;
  }

  get progress(): Progress {
    const save = this.current;
    return structuredClone({
      completedLevels: Object.fromEntries(
        Object.entries(save.unlocks.stages).map(([id, stage]) => [id, stage.completedLevels]),
      ),
      wins: save.records,
      profileXp: Object.fromEntries(
        Object.entries(save.profiles).map(([stageId, profiles]) => [
          stageId,
          Object.fromEntries(Object.entries(profiles).map(([id, profile]) => [id, profile.xp])),
        ]),
      ),
    });
  }

  get records(): Records {
    return structuredClone({ highScores: this.current.highScores, statistics: this.current.statistics });
  }

  /**
   * Replaces the save with an exported one (any known version is migrated first). This PC's network choices stay as
   * they are, and the save it replaces is kept as a backup. Returns null if the file is not a readable save.
   */
  importSave(raw: unknown): Promise<SaveData | null> {
    const imported = migrateSave(raw);
    if (!imported) return Promise.resolve(null);
    return this.update((save) => {
      const network = save.network;
      Object.assign(save, imported, { network });
    });
  }

  /** Applies a change and writes it. Writes run one after another, never interleaved. */
  update(change: (save: SaveData) => void): Promise<SaveData> {
    const run = this.writes.then(async () => {
      const next = this.data;
      change(next);
      next.updatedAt = new Date().toISOString();
      next.meta = {
        gameVersion: this.options.gameVersion ?? next.meta.gameVersion,
        contentVersion: String(STAGE_SCHEMA_VERSION),
        balanceVersion: BALANCE_VERSION,
      };
      const valid = SaveSchema.parse(next);
      await this.write(valid);
      this.current = valid;
      return this.data;
    });
    this.writes = run.catch(() => undefined);
    return run;
  }

  private async write(save: SaveData): Promise<void> {
    const text = `${JSON.stringify(save, null, 2)}\n`;
    const tempPath = `${this.savePath}.tmp`;
    await mkdir(dirname(this.savePath), { recursive: true });
    await mkdir(this.backupDir, { recursive: true });

    const handle = await open(tempPath, 'w');
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (!(await readSave(tempPath))) throw new Error('Save verification failed; the previous save was kept.');

    if (await readSave(this.savePath))
      await copyFile(
        this.savePath,
        join(this.backupDir, `save-${stamp()}-${String(++this.backupCounter).padStart(4, '0')}.json`),
      );
    await rename(tempPath, this.savePath);
    for (const old of (await this.backups()).slice(BACKUPS_KEPT)) await rm(old, { force: true });
  }
}

export function completeLevel(save: SaveData, stageId: string, levelId: string): void {
  const stage = (save.unlocks.stages[stageId] ??= { completedLevels: [] });
  if (!stage.completedLevels.includes(levelId)) stage.completedLevels.push(levelId);
}

export function recordWin(
  save: SaveData,
  stageId: string,
  levelId: string,
  side: Side,
  difficulty: Difficulty,
): void {
  completeLevel(save, stageId, levelId);
  const level = ((save.records[stageId] ??= {})[levelId] ??= { attacker: [], defender: [] });
  if (!level[side].includes(difficulty)) level[side].push(difficulty);
}

/** A file-name-safe time stamp that sorts in time order, such as `20261023-070512-123`. */
function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '-').replace('Z', '');
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null)) !== null;
}

async function readSave(path: string): Promise<SaveData | null> {
  try {
    return migrateSave(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return null;
  }
}
