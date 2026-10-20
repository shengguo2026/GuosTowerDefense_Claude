// Builds the player package (spec §3, masterplan §96–99): one zip with the game, its own Node runtime and start.bat,
// so nobody needs to install Node.js or npm. Unzip anywhere, double-click start.bat, play.
//
//   npm run package                      Windows 64-bit (the default)
//   npm run package -- --target linux-x64
//   npm run package -- --target darwin-arm64
//
// The result is release/GuosTowerDefense-<version>-<target>.zip. Pictures in assets/art are packed as they are on this
// PC, so build the package where Codex art has been copied in. The Node runtime is downloaded once from nodejs.org,
// checked against the official SHA-256 list and kept in .cache/node.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { unzipSync, zipSync } from 'fflate';

/** The bundled runtime: the current Node 22 LTS ("Jod"). */
const NODE_VERSION = 'v22.23.3';
const TARGETS = {
  'win-x64': { archive: 'zip', node: 'node.exe', start: 'start.bat' },
  'linux-x64': { archive: 'tar.gz', node: 'bin/node', start: 'start.sh' },
  'darwin-arm64': { archive: 'tar.gz', node: 'bin/node', start: 'start.sh' },
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetName = process.argv.includes('--target')
  ? process.argv[process.argv.indexOf('--target') + 1]
  : 'win-x64';
const target = TARGETS[targetName];
if (!target) {
  console.error(`Unknown target "${targetName}". Use one of: ${Object.keys(TARGETS).join(', ')}.`);
  process.exit(1);
}
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const top = 'GuosTowerDefense';

/** Packed files: path inside the zip → contents and whether it is a program to run. */
const files = new Map();
const add = (path, data, executable = false) =>
  files.set(`${top}/${path}`, {
    data: typeof data === 'string' ? Buffer.from(data, 'utf8') : data,
    executable,
  });
function addFolder(from, to, skip = () => false) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const path = join(from, entry.name);
    if (skip(entry.name)) continue;
    if (entry.isDirectory()) addFolder(path, `${to}/${entry.name}`, skip);
    else add(`${to}/${entry.name}`, readFileSync(path));
  }
}

console.log(`Packaging Guo's Tower Defense ${version} for ${targetName}…`);

// 1. The client (built fresh) and the server bundled into one file with its libraries.
run('npm', ['run', 'build']);
addFolder(join(root, 'apps/client/dist'), 'app/client');
const server = await build({
  entryPoints: [join(root, 'apps/server/src/main.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  write: false,
  minify: false,
  legalComments: 'inline',
  define: { __GTD_VERSION__: JSON.stringify(version) },
  // ws loads these native speed-ups only if they are installed; the game does not need them.
  external: ['bufferutil', 'utf-8-validate'],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'warning',
});
add('app/server.mjs', server.outputFiles[0].contents);
add('app/launcher.mjs', readFileSync(join(root, 'tools/launcher.mjs')));
add(
  'app/start.mjs',
  `// Started by ${target.start}: the launcher with the bundled runtime and the bundled server.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './launcher.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await launch({
  root,
  serverArgs: [join(root, 'app/server.mjs')],
  clientDir: join(root, 'app/client'),
  required: ['app/server.mjs', 'app/client/index.html', 'content/stages'],
});
`,
);

// 2. Content and pictures.
addFolder(join(root, 'content/stages'), 'content/stages');
addFolder(join(root, 'assets/art'), 'assets/art', (name) => name.endsWith('.md'));
add('favicon.svg', readFileSync(join(root, 'favicon.svg')));

// 3. The runtime.
const runtime = await nodeRuntime();
add(`runtime/${target.node}`, runtime.binary, true);
add('runtime/LICENSE', runtime.license);

// 4. Start files and a short read-me.
const runtimePath = target.node.split('/').join(targetName === 'win-x64' ? '\\' : '/');
if (target.start === 'start.bat') {
  add(
    'start.bat',
    [
      '@echo off',
      "title Guo's Tower Defense",
      'cd /d "%~dp0"',
      `"%~dp0runtime\\${runtimePath}" "%~dp0app\\start.mjs"`,
      'if errorlevel 1 pause',
      '',
    ].join('\r\n'),
  );
} else {
  add(
    'start.sh',
    [
      '#!/usr/bin/env sh',
      'cd "$(dirname "$0")" || exit 1',
      `exec ./runtime/${runtimePath} app/start.mjs`,
      '',
    ].join('\n'),
    true,
  );
}
add('README.txt', readme(target.start).replace(/\n/g, targetName === 'win-x64' ? '\r\n' : '\n'));

// 5. The zip.
await mkdir(join(root, 'release'), { recursive: true });
const zipPath = join(root, 'release', `${top}-${version}-${targetName}.zip`);
const entries = {};
for (const [path, file] of files) {
  // Unix permissions in the zip, so start.sh and the runtime stay runnable after unzipping on Linux and macOS.
  entries[path] = [
    file.data,
    { os: 3, attrs: ((file.executable ? 0o755 : 0o644) | 0o100000) << 16, level: 9 },
  ];
}
await writeFile(zipPath, zipSync(entries));
console.log(
  `Done: ${relative(root, zipPath)} (${(statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB, ${files.size} files)`,
);

function run(command, args) {
  const result = spawnSync(process.platform === 'win32' ? `${command}.cmd` : command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** The official Node.js build for the target, downloaded once and checked against nodejs.org's SHA-256 list. */
async function nodeRuntime() {
  const name = `node-${NODE_VERSION}-${targetName}`;
  const file = `${name}.${target.archive}`;
  const cacheDir = join(root, '.cache/node');
  const cached = join(cacheDir, file);
  if (!existsSync(cached)) {
    console.log(`Downloading the Node.js runtime (${file})…`);
    const base = `https://nodejs.org/dist/${NODE_VERSION}`;
    const sums = await (await download(`${base}/SHASUMS256.txt`)).toString('utf8');
    const expected = sums
      .split('\n')
      .find((line) => line.endsWith(`  ${file}`))
      ?.split(' ')[0];
    if (!expected) throw new Error(`${file} is not in the official list of ${NODE_VERSION}.`);
    const archive = await download(`${base}/${file}`);
    const actual = createHash('sha256').update(archive).digest('hex');
    if (actual !== expected) throw new Error(`${file} does not match its official checksum; not using it.`);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cached, archive);
  }
  const archive = await readFile(cached);
  const wanted = { binary: `${name}/${target.node}`, license: `${name}/LICENSE` };
  const found =
    target.archive === 'zip'
      ? unzipSync(archive, { filter: (f) => Object.values(wanted).includes(f.name) })
      : untar(gunzipSync(archive), Object.values(wanted));
  if (!found[wanted.binary] || !found[wanted.license])
    throw new Error(`${file} does not contain the runtime.`);
  return { binary: Buffer.from(found[wanted.binary]), license: Buffer.from(found[wanted.license]) };
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${url} (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

/** Reads the wanted files out of a tar archive (enough for the official Node.js tarballs). */
function untar(tar, wanted) {
  const found = {};
  let offset = 0;
  let longName = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, length) =>
      header
        .subarray(start, start + length)
        .toString('utf8')
        .replace(/\0.*$/s, '');
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1);
    const prefix = field(345, 155);
    let name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    longName = null;
    const body = tar.subarray(offset + 512, offset + 512 + size);
    if (type === 'L') longName = body.toString('utf8').replace(/\0.*$/s, '');
    else if (wanted.includes(name)) found[name] = body;
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return found;
}

function readme(start) {
  return `Guo's Tower Defense ${version}

Start
  Double-click ${start}. A window opens and then the game in your web browser.
  Keep that window open while playing; closing it stops the game.
  Nothing needs to be installed: the game brings its own runtime (Node.js ${NODE_VERSION}).

Tablets and phones
  In the main menu on this PC, choose "Tablet or phone" and scan the code with the tablet or phone.
  It must be in the same Wi-Fi as this PC. On Windows, allow "Private networks" when Windows asks.

Your progress
  Settings, unlocks and saves are in the user-data folder next to this file.
  Copy the whole folder to keep them; when updating, copy user-data into the new folder.

Pictures
  Codex pictures go into the assets/art folder.
`;
}
