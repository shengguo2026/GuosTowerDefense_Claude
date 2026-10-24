// The launcher behind start.bat / start.sh (spec §3): checks the game files and the user-data folder, picks a free
// port (3001, then 3002, …), starts the game server, waits until it answers and opens the browser. The packaged build
// runs it with the bundled Node runtime; the development build (tools/start.mjs) with the installed one.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

const HEALTH_TIMEOUT_MS = 60_000;

/**
 * @param {{
 *   root: string,
 *   serverArgs: string[],
 *   clientDir: string,
 *   required?: string[],
 * }} options `serverArgs` start the server with this Node runtime; `required` are files the game cannot run without.
 */
export async function launch({ root, serverArgs, clientDir, required = [] }) {
  console.log("Guo's Tower Defense is starting…");

  const missing = required.filter((file) => !existsSync(resolve(root, file)));
  if (missing.length > 0)
    fail(`Game files are missing: ${missing.join(', ')}. Unzip the game again into a new folder.`);

  const userData = resolve(process.env.GTD_USER_DATA ?? join(root, 'user-data'));
  try {
    await checkWritable(userData);
  } catch (error) {
    fail(
      `The game cannot write to its user-data folder (${userData}). Move the game folder somewhere you can write ` +
        `to, such as Documents, and start it again. Details: ${error.message}`,
    );
  }

  const port = await findFreePort(Number(process.env.GTD_PORT ?? 3001));
  const server = spawn(process.execPath, serverArgs, {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      GTD_ROOT: root,
      GTD_CLIENT_DIR: clientDir,
      GTD_USER_DATA: userData,
      GTD_PORT: String(port),
      GTD_STRICT_PORT: '1',
      GTD_NO_OPEN: '1',
    },
  });
  let exited = false;
  server.on('exit', (code) => {
    exited = true;
    if (code) console.error('The game stopped because of the error above.');
    process.exit(code ?? 0);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));

  const url = `http://localhost:${port}`;
  if (!(await waitForHealth(port, () => exited))) {
    server.kill();
    fail(`The game did not answer at ${url} within ${HEALTH_TIMEOUT_MS / 1000} seconds.`);
  }
  console.log('');
  console.log(`  The game is running: ${url}`);
  console.log('  Tablets and phones: main menu › Tablet or phone.');
  console.log('  Keep this window open while playing; closing it stops the game.');
  console.log('');
  if (process.env.GTD_NO_OPEN !== '1') openBrowser(url);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function checkWritable(dir) {
  await mkdir(dir, { recursive: true });
  const probe = join(dir, '.launcher-write-test');
  await writeFile(probe, 'ok');
  await rm(probe);
}

/** The first port from `start` upward that is free on this PC. */
export async function findFreePort(start, attempts = 50) {
  for (let port = start; port < start + attempts; port++) {
    const free = await new Promise((done) => {
      const probe = createServer();
      probe.once('error', () => done(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => done(true)));
    });
    if (free) return port;
  }
  fail(`No free port between ${start} and ${start + attempts - 1}. Close other programs and start again.`);
}

/** Polls the health check until the game server answers as this game, the server stops, or time runs out. */
async function waitForHealth(port, stopped) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline && !stopped()) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok && (await response.json()).name === 'guos-tower-defense') return true;
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  return false;
}

/** Opens the default browser. Failure is not fatal: the address is printed in the window as well. */
function openBrowser(url) {
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // The URL is printed above.
  }
}
