import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** User data is kept apart from the replaceable game files (spec §3), so copying the folder keeps progress. */
export const USER_DATA_FOLDERS = [
  'saves',
  'backups',
  'settings',
  'screenshots',
  'logs',
  'telemetry',
] as const;

/** Creates the user-data folders and proves they are writable; throws a readable error otherwise. */
export async function prepareUserData(userDataDir: string): Promise<void> {
  try {
    for (const folder of USER_DATA_FOLDERS) await mkdir(join(userDataDir, folder), { recursive: true });
    const probe = join(userDataDir, '.write-test');
    await writeFile(probe, 'ok');
    await rm(probe);
  } catch (error) {
    throw new Error(
      `The game cannot write to its user-data folder (${userDataDir}). ` +
        `Move the game to a folder you can write to, such as Documents. Details: ${(error as Error).message}`,
    );
  }
}
