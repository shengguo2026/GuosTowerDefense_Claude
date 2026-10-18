import { mkdir, open, readFile, rename, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { SettingsSchema, type SettingsPatch } from '@gtd/protocol';
import { z } from 'zod';

export const SAVE_VERSION = 1;

export const SaveSchema = z.object({
  version: z.literal(SAVE_VERSION),
  settings: SettingsSchema,
  /** Completed levels per stage; level and difficulty unlocks are derived from this. */
  unlocks: z.object({ stages: z.record(z.string(), z.object({ completedLevels: z.array(z.string()) })) }),
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

/**
 * Brings an older save up to the current version. Version 1 is the first, so there is nothing to migrate yet; later
 * versions add a step here (1 → 2, 2 → 3, …) and never drop the player's progress.
 */
export function migrateSave(raw: unknown): SaveData | null {
  const parsed = SaveSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type LoadSource = 'save' | 'backup' | 'new';

/**
 * The one local save on the PC (spec §13). Writes are atomic: the new save goes to a temp file, is read back and
 * validated, the current save becomes the backup, and only then the temp file replaces the save. If the save is ever
 * unreadable, the backup is used.
 */
export class SaveManager {
  readonly savePath: string;
  readonly backupPath: string;
  private current: SaveData = defaultSave();
  private writes: Promise<unknown> = Promise.resolve();
  lastLoadSource: LoadSource = 'new';

  constructor(userDataDir: string) {
    this.savePath = join(userDataDir, 'saves', 'save.json');
    this.backupPath = join(userDataDir, 'backups', 'save.backup.json');
  }

  async load(): Promise<SaveData> {
    const fromSave = await readSave(this.savePath);
    const fromBackup = fromSave ? null : await readSave(this.backupPath);
    this.current = fromSave ?? fromBackup ?? defaultSave();
    this.lastLoadSource = fromSave ? 'save' : fromBackup ? 'backup' : 'new';
    return this.data;
  }

  get data(): SaveData {
    return structuredClone(this.current);
  }

  updateSettings(patch: SettingsPatch): Promise<SaveData> {
    return this.update((save) => {
      save.settings = SettingsSchema.parse({
        ...save.settings,
        ...patch,
        audio: { ...save.settings.audio, ...patch.audio },
      });
    });
  }

  completeLevel(stageId: string, levelId: string): Promise<SaveData> {
    return this.update((save) => {
      const stage = (save.unlocks.stages[stageId] ??= { completedLevels: [] });
      if (!stage.completedLevels.includes(levelId)) stage.completedLevels.push(levelId);
    });
  }

  /** Applies a change and writes it. Writes run one after another, never interleaved. */
  update(change: (save: SaveData) => void): Promise<SaveData> {
    const run = this.writes.then(async () => {
      const next = this.data;
      change(next);
      next.updatedAt = new Date().toISOString();
      await this.write(SaveSchema.parse(next));
      this.current = next;
      return this.data;
    });
    this.writes = run.catch(() => undefined);
    return run;
  }

  private async write(save: SaveData): Promise<void> {
    const text = `${JSON.stringify(save, null, 2)}\n`;
    const tempPath = `${this.savePath}.tmp`;
    await mkdir(dirname(this.savePath), { recursive: true });
    await mkdir(dirname(this.backupPath), { recursive: true });

    const handle = await open(tempPath, 'w');
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (!(await readSave(tempPath))) throw new Error('Save verification failed; the previous save was kept.');

    if (await readSave(this.savePath)) await copyFile(this.savePath, this.backupPath);
    await rename(tempPath, this.savePath);
  }
}

async function readSave(path: string): Promise<SaveData | null> {
  try {
    return migrateSave(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return null;
  }
}
