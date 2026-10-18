// Developer mode: game server with auto-restart plus the Vite dev server with hot reload.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverPort = process.env.GTD_SERVER_PORT ?? '3100';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!existsSync(resolve(root, 'node_modules'))) {
  console.error('Run "npm install" first.');
  process.exit(1);
}

const children = [
  spawn(process.execPath, ['--import', 'tsx', '--watch', 'apps/server/src/main.ts'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, GTD_DEV: '1', GTD_PORT: serverPort, GTD_NO_OPEN: '1' },
  }),
  spawn(npm, ['run', 'dev', '-w', '@gtd/client', '--', '--open'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, GTD_SERVER_PORT: serverPort },
  }),
];

const stop = () => children.forEach((child) => child.kill());
for (const child of children) child.on('exit', stop);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
