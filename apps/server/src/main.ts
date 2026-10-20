/**
 * Game server entry point, started by start.bat / start.sh (or `npm start`).
 *
 * Environment:
 *   GTD_PORT       first port to try (default 3000); in dev mode the exact port
 *   GTD_STRICT_PORT=1  use exactly GTD_PORT (the launcher has already picked a free one)
 *   GTD_HOST       interface to listen on (default 127.0.0.1: only this PC; phones and tablets join once the player
 *                  turns on "Play on tablet or phone"; 0.0.0.0 opens every network from the start)
 *   GTD_ROOT       game folder with content/ and assets/ (default: three folders up from this file)
 *   GTD_CLIENT_DIR built client (default <game folder>/apps/client/dist)
 *   GTD_USER_DATA  user-data folder (default <game folder>/user-data)
 *   GTD_DEV=1      dev mode: Vite serves the client, developer-only stages are visible
 *   GTD_NO_OPEN=1  do not open the browser
 *   GTD_PLATFORM   pretend to run on this operating system (tests of the Windows firewall explainer)
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadAllStages } from '@gtd/content-schema/node';
import { createGameServer, listen } from './gameServer';
import { openBrowser } from './openBrowser';
import { LanSharing, lanAddresses } from './network';
import { findFreePort } from './ports';
import { SaveManager } from './saveManager';
import { prepareUserData } from './userData';

const gameRoot = resolve(process.env.GTD_ROOT ?? resolve(import.meta.dirname, '../../..'));
const devMode = process.env.GTD_DEV === '1';
const host = process.env.GTD_HOST ?? '127.0.0.1';
const firstPort = Number(process.env.GTD_PORT ?? 3000);
const strictPort = devMode || process.env.GTD_STRICT_PORT === '1';
const userDataDir = resolve(process.env.GTD_USER_DATA ?? resolve(gameRoot, 'user-data'));
const clientDir = resolve(process.env.GTD_CLIENT_DIR ?? resolve(gameRoot, 'apps/client/dist'));
/** Set by the packaged build, which has no package.json. */
declare const __GTD_VERSION__: string | undefined;

async function main(): Promise<void> {
  const version =
    typeof __GTD_VERSION__ === 'string'
      ? __GTD_VERSION__
      : (JSON.parse(await readFile(resolve(gameRoot, 'package.json'), 'utf8')) as { version: string })
          .version;
  console.log(`Guo's Tower Defense ${version}${devMode ? ' (dev mode)' : ''}`);

  await prepareUserData(userDataDir);
  const saves = new SaveManager(userDataDir);
  await saves.load();
  if (saves.lastLoadSource === 'backup') console.warn('The save could not be read; the backup was restored.');

  const report = await loadAllStages(resolve(gameRoot, 'content/stages'));
  for (const warning of report.warnings) console.warn(`Skipped stage pack: ${warning}`);
  if (report.errors.length > 0) {
    for (const error of report.errors) console.error(`Broken core stage pack: ${error}`);
    throw new Error('A required stage pack is broken; the game cannot start.');
  }

  const lan = new LanSharing();
  const server = createGameServer({
    version,
    stages: report.stages,
    saves,
    clientDir: devMode ? undefined : clientDir,
    showDevStages: devMode,
    artDir: resolve(gameRoot, 'assets/art'),
    lan,
    listensEverywhere: host === '0.0.0.0',
    platform: (process.env.GTD_PLATFORM as NodeJS.Platform | undefined) ?? process.platform,
  });
  const port = strictPort ? firstPort : await findFreePort(firstPort, host);
  const running = await listen(server, port, host);
  console.log(`Game server running at ${running.url}`);
  // The player shared the game with phones and tablets last time: share again (Windows remembers its answer).
  if (saves.data.network.shareOnWifi && host !== '0.0.0.0') await lan.start(server, running.port);
  const shared = host === '0.0.0.0' ? lanAddresses() : lan.open;
  for (const address of shared)
    console.log(`On a phone or tablet in the same Wi-Fi, open http://${address}:${running.port}`);
  console.log(`User data: ${userDataDir}`);

  if (!devMode && process.env.GTD_NO_OPEN !== '1') openBrowser(running.url);

  const shutdown = () => {
    console.log('Stopping the game server…');
    void running.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
