import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadAllStages } from '@gtd/content-schema/node';
import { PROTOCOL_VERSION, type HealthResponse, type ServerMessage } from '@gtd/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createGameServer, listen, type RunningGameServer } from './gameServer';
import { findFreePort } from './ports';
import { SaveManager, defaultSave } from './saveManager';
import { USER_DATA_FOLDERS, prepareUserData } from './userData';

let dir: string;
const running: RunningGameServer[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gtd-server-'));
});
afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
  await rm(dir, { recursive: true, force: true });
});

async function startServer(userDataDir = join(dir, 'user-data'), clientDir?: string) {
  await prepareUserData(userDataDir);
  const saves = new SaveManager(userDataDir);
  await saves.load();
  const { stages } = await loadAllStages(resolve(import.meta.dirname, '../../../content/stages'));
  const server = await listen(
    createGameServer({ version: '9.9.9', stages, saves, clientDir, showDevStages: true }),
    0,
    '127.0.0.1',
  );
  running.push(server);
  return server;
}

describe('SaveManager', () => {
  it('starts with defaults when there is no save yet', async () => {
    const saves = new SaveManager(dir);
    expect(await saves.load()).toEqual(defaultSave());
    expect(saves.lastLoadSource).toBe('new');
  });

  it('keeps settings and unlocks across a restart', async () => {
    const first = new SaveManager(dir);
    await first.load();
    await first.updateSettings({ language: 'zh-CN', audio: { music: 0.25 } });
    await first.completeLevel('stage-01-big-five', 'lion');

    const second = new SaveManager(dir);
    const save = await second.load();
    expect(second.lastLoadSource).toBe('save');
    expect(save.settings.language).toBe('zh-CN');
    expect(save.settings.audio).toEqual({ master: 0.8, music: 0.25, effects: 0.8 });
    expect(save.unlocks.stages['stage-01-big-five']?.completedLevels).toEqual(['lion']);
  });

  it('writes atomically and keeps the previous save as the backup', async () => {
    const saves = new SaveManager(dir);
    await saves.load();
    await saves.updateSettings({ language: 'de' });
    await saves.updateSettings({ language: 'en' });
    const backup = JSON.parse(await readFile(saves.backupPath, 'utf8'));
    expect(backup.settings.language).toBe('de');
    await expect(readFile(`${saves.savePath}.tmp`)).rejects.toThrow();
  });

  it('falls back to the backup when the save is damaged', async () => {
    const saves = new SaveManager(dir);
    await saves.load();
    await saves.updateSettings({ language: 'de' });
    await saves.updateSettings({ graphics: 'low' });
    await writeFile(saves.savePath, '{ half a save');

    const restored = new SaveManager(dir);
    const save = await restored.load();
    expect(restored.lastLoadSource).toBe('backup');
    expect(save.settings.language).toBe('de');
  });

  it('runs overlapping updates one after another', async () => {
    const saves = new SaveManager(dir);
    await saves.load();
    await Promise.all([
      saves.completeLevel('s', 'a'),
      saves.completeLevel('s', 'b'),
      saves.updateSettings({ graphics: 'medium' }),
    ]);
    const save = await new SaveManager(dir).load();
    expect(save.unlocks.stages.s?.completedLevels).toEqual(['a', 'b']);
    expect(save.settings.graphics).toBe('medium');
  });
});

describe('user data', () => {
  it('creates every user-data folder', async () => {
    await prepareUserData(join(dir, 'ud'));
    for (const folder of USER_DATA_FOLDERS) {
      await expect(readFile(join(dir, 'ud', folder))).rejects.toThrow(/EISDIR|illegal operation/);
    }
  });
});

describe('game server', () => {
  it('reports health with the loaded stage packs', async () => {
    const server = await startServer();
    const health = (await (await fetch(`${server.url}/api/health`)).json()) as HealthResponse;
    expect(health).toMatchObject({ ok: true, version: '9.9.9', protocolVersion: PROTOCOL_VERSION });
    expect(health.stages.find((s) => s.id === 'test-stage')?.title.de).toBe('Testtal');
  });

  it('saves settings through the API and keeps them after a restart', async () => {
    const userData = join(dir, 'persist');
    const first = await startServer(userData);
    const put = await fetch(`${first.url}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'de' }),
    });
    expect(put.status).toBe(200);
    await first.close();

    const second = await startServer(userData);
    const settings = (await (await fetch(`${second.url}/api/settings`)).json()) as { language: string };
    expect(settings.language).toBe('de');
  });

  it('rejects invalid settings', async () => {
    const server = await startServer();
    const put = await fetch(`${server.url}/api/settings`, {
      method: 'PUT',
      body: JSON.stringify({ language: 'fr' }),
    });
    expect(put.status).toBe(400);
  });

  it('welcomes a client over the WebSocket channel', async () => {
    const server = await startServer();
    const ws = new WebSocket(`${server.url.replace('http', 'ws')}/ws`);
    const messages: ServerMessage[] = [];
    await new Promise<void>((done, fail) => {
      ws.on('error', fail);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, clientId: 'test' }));
        ws.send(JSON.stringify({ type: 'ping', sentAt: 123 }));
        ws.send('nonsense');
      });
      ws.on('message', (data) => {
        messages.push(JSON.parse(String(data)) as ServerMessage);
        if (messages.length === 3) done();
      });
    });
    ws.close();
    expect(messages.map((m) => m.type)).toEqual(['welcome', 'pong', 'error']);
  });

  it('serves the client, falls back to index.html and blocks paths outside it', async () => {
    const clientDir = join(dir, 'client');
    await mkdir(clientDir, { recursive: true });
    await writeFile(join(clientDir, 'index.html'), '<title>game</title>');
    await writeFile(join(dir, 'secret.txt'), 'secret');
    const server = await startServer(join(dir, 'ud2'), clientDir);
    expect(await (await fetch(`${server.url}/`)).text()).toContain('game');
    expect(await (await fetch(`${server.url}/settings`)).text()).toContain('game');
    expect((await fetch(`${server.url}/missing.js`)).status).toBe(404);
    expect((await fetch(`${server.url}/..%2fsecret.txt`)).status).toBe(403);
  });
});

describe('findFreePort', () => {
  it('skips a port that is in use', async () => {
    const busy = await startServer();
    expect(await findFreePort(busy.port, '127.0.0.1')).toBeGreaterThan(busy.port);
  });
});
