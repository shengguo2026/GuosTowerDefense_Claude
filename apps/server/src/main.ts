/**
 * Game server entry point, started by start.bat / start.sh (or `npm start`).
 *
 * Environment:
 *   GTD_PORT       first port to try (default 3000); in dev mode the exact port
 *   GTD_HOST       interface to listen on (default 127.0.0.1; Wi-Fi play opens this up in a later milestone)
 *   GTD_USER_DATA  user-data folder (default <game folder>/user-data)
 *   GTD_DEV=1      dev mode: Vite serves the client, developer-only stages are visible
 *   GTD_NO_OPEN=1  do not open the browser
 */
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { loadAllStages } from '@gtd/content-schema/node';
import { createGameServer, listen } from './gameServer';
import { openBrowser } from './openBrowser';
import { findFreePort } from './ports';
import { SaveManager } from './saveManager';
import { prepareUserData } from './userData';

const gameRoot = resolve(import.meta.dirname, '../../..');
const devMode = process.env.GTD_DEV === '1';
const host = process.env.GTD_HOST ?? '127.0.0.1';
const firstPort = Number(process.env.GTD_PORT ?? 3000);
const userDataDir = resolve(process.env.GTD_USER_DATA ?? resolve(gameRoot, 'user-data'));

async function main(): Promise<void> {
  const { version } = JSON.parse(await readFile(resolve(gameRoot, 'package.json'), 'utf8')) as {
    version: string;
  };
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

  const server = createGameServer({
    version,
    stages: report.stages,
    saves,
    clientDir: devMode ? undefined : resolve(gameRoot, 'apps/client/dist'),
    showDevStages: devMode,
    artDir: resolve(gameRoot, 'assets/art'),
  });
  const port = devMode ? firstPort : await findFreePort(firstPort, host);
  const running = await listen(server, port, host);
  console.log(`Game server running at ${running.url}`);
  // Listening on every interface: say which address a phone or tablet on the same Wi-Fi should open.
  if (host === '0.0.0.0')
    for (const address of lanAddresses())
      console.log(
        `On a phone or tablet in the same Wi-Fi, open http://${address}:${running.url.split(':').pop()}`,
      );
  console.log(`User data: ${userDataDir}`);

  if (!devMode && process.env.GTD_NO_OPEN !== '1') openBrowser(running.url);

  const shutdown = () => {
    console.log('Stopping the game server…');
    void running.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/** The PC's IPv4 addresses in the local network. */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((net) => net && net.family === 'IPv4' && !net.internal)
    .map((net) => (net as { address: string }).address);
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
