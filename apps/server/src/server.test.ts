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

async function startServer(userDataDir = join(dir, 'user-data'), clientDir?: string, artDir?: string) {
  await prepareUserData(userDataDir);
  const saves = new SaveManager(userDataDir);
  await saves.load();
  const { stages } = await loadAllStages(resolve(import.meta.dirname, '../../../content/stages'));
  const server = await listen(
    createGameServer({ version: '9.9.9', stages, saves, clientDir, artDir, showDevStages: true }),
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

describe('levels', () => {
  /** Opens a WebSocket, says hello, sends `messages` and collects replies until `until` returns true. */
  async function converse(
    url: string,
    messages: object[],
    until: (received: ServerMessage[]) => boolean,
  ): Promise<ServerMessage[]> {
    const ws = new WebSocket(`${url.replace('http', 'ws')}/ws`);
    const received: ServerMessage[] = [];
    await new Promise<void>((done, fail) => {
      const timer = setTimeout(
        () => fail(new Error(`timed out after ${JSON.stringify(received.map((m) => m.type))}`)),
        5000,
      );
      ws.on('error', fail);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, clientId: 'test' }));
        for (const message of messages) ws.send(JSON.stringify(message));
      });
      ws.on('message', (data) => {
        received.push(JSON.parse(String(data)) as ServerMessage);
        if (until(received)) {
          clearTimeout(timer);
          done();
        }
      });
    });
    ws.close();
    return received;
  }

  it('serves a whole stage pack, and 404 for an unknown one', async () => {
    const server = await startServer();
    const pack = (await (await fetch(`${server.url}/api/stages/stage-01-big-five`)).json()) as {
      levels: { id: string; scene?: { kit: string } }[];
    };
    expect(pack.levels.map((level) => level.id)).toEqual(['lion']);
    expect(pack.levels[0]?.scene?.kit).toBe('savanna');
    expect((await fetch(`${server.url}/api/stages/nope`)).status).toBe(404);
  });

  it('serves art files and blocks paths outside the art folder', async () => {
    const artDir = join(dir, 'art');
    await mkdir(join(artDir, 'textures'), { recursive: true });
    await writeFile(join(artDir, 'textures', 'grass.jpg'), 'jpeg');
    await writeFile(join(dir, 'secret.txt'), 'secret');
    const server = await startServer(join(dir, 'ud3'), undefined, artDir);
    const response = await fetch(`${server.url}/art/textures/grass.jpg`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/jpeg');
    expect((await fetch(`${server.url}/art/missing.jpg`)).status).toBe(404);
    expect((await fetch(`${server.url}/art/..%2f..%2fsecret.txt`)).status).toBe(403);
  });

  it('streams a demo match of a level to a watcher', async () => {
    const server = await startServer();
    const received = await converse(
      server.url,
      [{ type: 'watchDemo', stageId: 'stage-01-big-five', levelId: 'lion' }],
      (messages) => messages.filter((m) => m.type === 'snapshot').length >= 3,
    );
    const started = received.find((m) => m.type === 'matchStarted');
    expect(started).toMatchObject({ stageId: 'stage-01-big-five', levelId: 'lion' });
    const ticks = received.flatMap((m) => (m.type === 'snapshot' ? [m.snapshot.tick] : []));
    expect(ticks[ticks.length - 1]).toBeGreaterThan(ticks[0] ?? 0);
  });

  it('answers an unknown level with an error', async () => {
    const server = await startServer();
    const received = await converse(
      server.url,
      [{ type: 'watchDemo', stageId: 'stage-01-big-five', levelId: 'elephant' }],
      (messages) => messages.some((m) => m.type === 'error'),
    );
    expect(received.find((m) => m.type === 'error')).toMatchObject({ code: 'unknownLevel' });
  });
});

describe('matches between people', () => {
  /** A WebSocket client that keeps everything it received and can wait for a message. */
  class TestClient {
    readonly received: ServerMessage[] = [];
    private readonly ws: WebSocket;
    private readonly opened: Promise<void>;

    constructor(url: string) {
      this.ws = new WebSocket(`${url.replace('http', 'ws')}/ws`);
      this.ws.on('message', (data) => this.received.push(JSON.parse(String(data)) as ServerMessage));
      this.opened = new Promise((done, fail) => {
        this.ws.on('open', () => done());
        this.ws.on('error', fail);
      });
    }

    async send(message: object): Promise<void> {
      await this.opened;
      this.ws.send(JSON.stringify(message));
    }

    /** Waits for a message received from now on that matches. */
    async next<T extends ServerMessage['type']>(
      type: T,
      test: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true,
    ): Promise<Extract<ServerMessage, { type: T }>> {
      const start = this.received.length;
      for (let waited = 0; waited < 5000; waited += 20) {
        const found = this.received
          .slice(start)
          .find((m): m is Extract<ServerMessage, { type: T }> => m.type === type && test(m as never));
        if (found) return found;
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      }
      throw new Error(`no ${type} after ${JSON.stringify(this.received.slice(start).map((m) => m.type))}`);
    }

    close(): void {
      this.ws.close();
    }
  }

  const lion = { stageId: 'stage-01-big-five', levelId: 'lion' };

  it('runs a match for one person playing both sides and applies their commands', async () => {
    const server = await startServer();
    const client = new TestClient(server.url);
    await client.send({ type: 'createMatch', ...lion, seat: 'both' });
    const joined = await client.next('joined');
    expect(joined.seat).toBe('both');
    await client.send({
      type: 'command',
      command: {
        type: 'placeDefense',
        side: 'defender',
        defenseTypeId: 'observation-post',
        nodeId: 'junction-hill',
      },
    });
    const withPost = await client.next('snapshot', (m) =>
      m.snapshot.entities.some((e) => e.kind === 'defense'),
    );
    expect(withPost.snapshot.viewer).toBeNull();
    expect(withPost.snapshot.phase).toBe('preparation');
    await client.send({
      type: 'command',
      command: {
        type: 'launchWave',
        side: 'attacker',
        groups: [{ unitTypeId: 'scout', count: 3, formation: 'column', routeId: 'ridge', delaySeconds: 0 }],
      },
    });
    expect(await client.next('commandRejected')).toMatchObject({
      command: 'launchWave',
      reason: 'preparation',
    });
    await client.send({ type: 'command', command: { type: 'launchWave', side: 'attacker', groups: [] } });
    expect(await client.next('error')).toMatchObject({ code: 'badMessage' });
    client.close();
  });

  it('lets a second person join as the other side and shows each side only its own view', async () => {
    const server = await startServer();
    const attacker = new TestClient(server.url);
    const defender = new TestClient(server.url);
    await attacker.send({ type: 'createMatch', ...lion, seat: 'attacker' });
    const { matchId } = await attacker.next('joined');
    await defender.send({ type: 'listMatches' });
    const list = await defender.next('matches');
    expect(list.matches).toEqual([{ matchId, ...lion, seats: ['attacker'], phase: 'preparation' }]);
    await defender.send({ type: 'joinMatch', matchId, seat: 'defender' });
    await defender.next('joined');
    await defender.send({
      type: 'command',
      command: {
        type: 'placeDefense',
        side: 'defender',
        defenseTypeId: 'observation-post',
        nodeId: 'waterhole-east',
      },
    });
    const defenderView = await defender.next('snapshot', (m) => m.snapshot.entities.length > 0);
    expect(defenderView.snapshot.viewer).toBe('defender');
    expect(Object.keys(defenderView.snapshot.resources)).toEqual(['defender']);
    const attackerView = await attacker.next('snapshot', (m) => m.snapshot.tick > defenderView.snapshot.tick);
    expect(attackerView.snapshot.entities).toEqual([]);
    expect(Object.keys(attackerView.snapshot.resources)).toEqual(['attacker']);
    await attacker.send({
      type: 'command',
      command: { type: 'sellDefense', side: 'defender', defenseId: 1 },
    });
    expect(await attacker.next('error')).toMatchObject({ code: 'notYourSide' });
    attacker.close();
    defender.close();
  });

  it('stops a match when everyone has left', async () => {
    const server = await startServer();
    const player = new TestClient(server.url);
    const observer = new TestClient(server.url);
    await player.send({ type: 'createMatch', ...lion, seat: 'both' });
    await player.next('joined');
    await player.send({ type: 'leaveMatch' });
    await player.send({ type: 'command', command: { type: 'sellDefense', side: 'defender', defenseId: 1 } });
    expect(await player.next('error')).toMatchObject({ code: 'notInMatch' });
    await observer.send({ type: 'listMatches' });
    expect((await observer.next('matches')).matches).toEqual([]);
    await observer.send({ type: 'joinMatch', matchId: 'match-1', seat: 'spectator' });
    expect(await observer.next('error')).toMatchObject({ code: 'unknownMatch' });
    player.close();
    observer.close();
  });
});

describe('findFreePort', () => {
  it('skips a port that is in use', async () => {
    const busy = await startServer();
    expect(await findFreePort(busy.port, '127.0.0.1')).toBeGreaterThan(busy.port);
  });
});
