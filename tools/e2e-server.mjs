// Starts the game server for the browser tests with a fresh user-data folder, so every run begins as a first launch.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const userData = resolve(root, 'test-results/e2e-user-data');
rmSync(userData, { recursive: true, force: true });

const server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/main.ts'], {
  cwd: root,
  stdio: 'inherit',
  // Windows, so the firewall explainer shows before the game opens to the network.
  env: { ...process.env, GTD_USER_DATA: userData, GTD_NO_OPEN: '1', GTD_PLATFORM: 'win32' },
});
server.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
