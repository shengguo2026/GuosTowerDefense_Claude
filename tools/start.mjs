// Builds the client if needed and starts the game server, which opens the browser.
// Used by start.bat / start.sh. A packaged build with a bundled Node runtime replaces this in milestone M6.
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(args) {
  const result = spawnSync(npm, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** Newest modification time of any file under `dir`. */
function newest(dir) {
  let latest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(dir, entry.name);
    latest = Math.max(latest, entry.isDirectory() ? newest(path) : statSync(path).mtimeMs);
  }
  return latest;
}

if (!existsSync(join(root, 'node_modules'))) {
  console.log('First start: installing the game libraries (needs internet once)…');
  run(['install', '--no-audit', '--no-fund']);
}

const builtIndex = join(root, 'apps/client/dist/index.html');
const sources = Math.max(newest(join(root, 'apps/client')), newest(join(root, 'packages')));
if (!existsSync(builtIndex) || statSync(builtIndex).mtimeMs < sources) {
  console.log('Preparing the game…');
  run(['run', 'build']);
}

const server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/main.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
server.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
