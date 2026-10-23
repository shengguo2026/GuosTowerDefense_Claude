import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { StagePack } from '@gtd/content-schema';
import { loadAllStages } from '@gtd/content-schema/node';
import type { Progress, RoomState, ServerMessage } from '@gtd/protocol';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { Discovery, broadcastAddresses } from './discovery';
import { createGameServer, listen } from './gameServer';
import { PlayerMatches } from './playerMatches';
import { applyMatch, type FinishedMatch } from './progress';
import { SaveManager, defaultSave, type SaveData } from './saveManager';
import { prepareUserData } from './userData';
import { WifiRooms } from './wifiRooms';

let stages: StagePack[];
beforeAll(async () => {
  stages = (await loadAllStages(resolve(import.meta.dirname, '../../../content/stages'))).stages;
});

/** A device's connection: everything the server sent it, in order. */
function device() {
  const received: ServerMessage[] = [];
  const send = (message: ServerMessage) => received.push(message);
  const last = <T extends ServerMessage['type']>(type: T) =>
    received.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type).at(-1);
  return {
    send,
    received,
    last,
    room: () => last('room')?.room as RoomState,
    error: () => last('roomError')?.code,
  };
}

function setup(
  progress: Progress = { completedLevels: {}, wins: {}, profileXp: {} },
  awaySeconds = 60,
  save?: SaveData,
) {
  let now = 0;
  const matches = new PlayerMatches(stages, {
    now: () => now,
    seed: () => 1234,
    ...(save
      ? {
          onFinished: (match: FinishedMatch) =>
            Promise.resolve(
              applyMatch(
                save,
                match,
                stages.find((p) => p.manifest.id === 'test-stage'),
                'today',
              ),
            ),
        }
      : {}),
  });
  const rooms = new WifiRooms(stages, matches, {
    addresses: () => ['http://192.168.1.20:3001/'],
    progress: () => progress,
    awaySeconds,
  });
  return {
    matches,
    rooms,
    tick(ms: number) {
      now += ms;
    },
  };
}

/** The PC hosts, a phone joins with the code; the host plays the Attacker, the phone the Defender. */
function hostAndGuest(world = setup()) {
  const pc = device();
  const phone = device();
  world.rooms.host('Guo', pc.send);
  const code = pc.room().code;
  world.rooms.join(code, 'Mia', phone.send);
  return { ...world, pc, phone, code };
}

function startMatch(world: ReturnType<typeof hostAndGuest>) {
  world.rooms.settings(world.pc.send, 'test-stage', 'meadow', 'easy');
  world.rooms.ready(world.phone.send, true);
  world.rooms.start(world.pc.send);
  const host = world.matches.hostOf(world.pc.send);
  if (!host) throw new Error('no match');
  // The test drives the clock by hand.
  host.stop();
  return host;
}

describe('Wi-Fi rooms', () => {
  it('opens a room with a 6-digit code and lets a device join with it and a session token', () => {
    const { pc, phone, code, rooms } = hostAndGuest();
    expect(code).toMatch(/^\d{6}$/);
    const pcJoined = pc.last('roomJoined');
    const phoneJoined = phone.last('roomJoined');
    expect(pcJoined?.token).toMatch(/^[0-9a-f]{32}$/);
    expect(phoneJoined?.token).toMatch(/^[0-9a-f]{32}$/);
    expect(phoneJoined?.token).not.toBe(pcJoined?.token);
    expect(phone.last('room')).toMatchObject({ host: false, playerId: phoneJoined?.playerId });
    expect(pc.last('room')?.host).toBe(true);
    expect(phone.room().slots).toMatchObject([
      { slotId: 'A1', side: 'attacker', controller: 'human', name: 'Guo', host: true, connected: true },
      { slotId: 'D1', side: 'defender', controller: 'human', name: 'Mia', host: false, connected: true },
    ]);
    expect(phone.room().addresses).toEqual(['http://192.168.1.20:3001/']);
    expect(rooms.open).toBe(true);
    expect(rooms.openHosts).toEqual(['Guo']);

    const wrong = device();
    rooms.join(code === '000000' ? '000001' : '000000', 'X', wrong.send);
    expect(wrong.error()).toBe('roomNotFound');
    const third = device();
    rooms.join(code, 'Third', third.send);
    expect(third.error()).toBe('roomFull');
  });

  it('lets the host pick the level from their unlocks and the computer for an empty slot', () => {
    const pc = device();
    const { rooms } = setup();
    rooms.host('Guo', pc.send);
    rooms.settings(pc.send, 'test-stage', 'canyon', 'hard');
    expect(pc.error()).toBe('badChoice');
    rooms.settings(pc.send, 'test-stage', 'meadow', 'hard');
    expect(pc.room()).toMatchObject({ stageId: 'test-stage', levelId: 'meadow', difficulty: 'hard' });

    // An open slot cannot start; the computer is always ready.
    rooms.start(pc.send);
    expect(pc.error()).toBe('notReady');
    rooms.slotController(pc.send, 'D1', 'ai');
    expect(pc.room().slots[1]).toMatchObject({ controller: 'ai', ready: true });
    rooms.choose(pc.send, { slotId: 'D1', profileId: pc.room().slots[1]?.profileId ?? '' });
    rooms.start(pc.send);
    expect(pc.room().phase).toBe('match');
    expect(pc.last('matchStarted')).toMatchObject({ stageId: 'test-stage', levelId: 'meadow' });
  });

  it('opens the levels the host has unlocked to every guest', () => {
    const { pc, rooms } = hostAndGuest(
      setup({ completedLevels: { 'test-stage': ['meadow'] }, wins: {}, profileXp: {} }),
    );
    rooms.settings(pc.send, 'test-stage', 'canyon', 'easy');
    expect(pc.room().levelId).toBe('canyon');
  });

  it('locks a ready player and starts once every person is ready', () => {
    const { pc, phone, rooms } = hostAndGuest();
    rooms.settings(pc.send, 'test-stage', 'meadow', 'easy');
    const defenders = stages.find((s) => s.manifest.id === 'test-stage')?.manifest.profiles.defender ?? [];
    rooms.choose(phone.send, { name: 'Mia K', profileId: defenders[1] ?? '' });
    expect(phone.room().slots[1]).toMatchObject({ name: 'Mia K', profileId: defenders[1] });
    // Only the host sets the level, and the other side's profile is not the guest's.
    rooms.settings(phone.send, 'test-stage', 'meadow', 'hard');
    expect(phone.error()).toBe('hostOnly');
    rooms.choose(phone.send, { slotId: 'A1', profileId: 'x' });
    expect(phone.error()).toBe('hostOnly');

    rooms.start(pc.send);
    expect(pc.error()).toBe('notReady');
    rooms.ready(phone.send, true);
    rooms.choose(phone.send, { profileId: defenders[0] ?? '' });
    expect(phone.error()).toBe('locked');
    // A change of level asks everyone to confirm again.
    rooms.settings(pc.send, 'test-stage', 'meadow', 'medium');
    expect(phone.room().slots[1]?.ready).toBe(false);
    rooms.ready(phone.send, true);
    rooms.start(pc.send);
    expect(phone.room().phase).toBe('match');
    expect(phone.last('joined')?.seat).toBe('defender');
    expect(pc.last('joined')?.seat).toBe('attacker');
    expect(phone.last('matchStarted')?.defenderProfileId).toBe(defenders[1]);
  });

  it('swaps sides on the host’s word', () => {
    const { pc, phone, rooms } = hostAndGuest();
    rooms.swap(phone.send);
    expect(phone.error()).toBe('hostOnly');
    rooms.swap(pc.send);
    expect(phone.room().slots.map((s) => s.name)).toEqual(['Mia', 'Guo']);
  });

  it('keeps commands to the player’s own side and lets only the host pause, at 1× speed', () => {
    const world = hostAndGuest();
    const host = startMatch(world);
    const { pc, phone, matches } = world;
    expect(phone.last('clock')).toMatchObject({ canControl: false, wifi: true });
    expect(pc.last('clock')).toMatchObject({ canControl: true, wifi: true });
    const order = { type: 'retreatGroup', side: 'attacker', groupId: 1 } as const;
    expect(matches.command(order, phone.send)).toMatchObject({ ok: false });

    expect(matches.setPaused(true, phone.send)).toMatchObject({ ok: false });
    expect(matches.setPaused(true, pc.send)).toEqual({ ok: true, value: null });
    expect(host.paused).toBe(true);
    expect(phone.last('clock')).toMatchObject({ paused: true });
    expect(matches.setSpeed(2, pc.send)).toMatchObject({ ok: false });
    // A host who drops out cannot leave the match paused.
    world.rooms.disconnected(pc.send);
    matches.leave(pc.send);
    expect(host.paused).toBe(false);
  });

  it('lets the computer play for a player who dropped out until they come back with their token', () => {
    const world = hostAndGuest();
    const host = startMatch(world);
    const { phone, rooms, matches, code } = world;
    const token = phone.last('roomJoined')?.token ?? '';
    expect(host.controls('defender')).toBe(false);

    matches.leave(phone.send);
    rooms.disconnected(phone.send);
    expect(host.controls('defender')).toBe(true);
    expect(world.pc.room().slots[1]).toMatchObject({ connected: false, name: 'Mia' });

    // New players cannot join a running match; a wrong token is refused.
    const stranger = device();
    rooms.join(code, 'Stranger', stranger.send);
    expect(stranger.error()).toBe('roomRunning');
    rooms.rejoin(code, '0'.repeat(32), stranger.send);
    expect(stranger.error()).toBe('badToken');

    const back = device();
    rooms.rejoin(code, token, back.send);
    expect(host.controls('defender')).toBe(false);
    expect(back.last('joined')?.seat).toBe('defender');
    expect(back.last('snapshot')).toBeDefined();
    expect(back.room().slots[1]).toMatchObject({ connected: true });
  });

  it('frees a slot of a guest who did not come back to the lobby, and closes the room when the host leaves', async () => {
    const world = hostAndGuest(setup(undefined, 0.05));
    const { pc, phone, rooms } = world;
    rooms.disconnected(phone.send);
    expect(pc.room().slots[1]).toMatchObject({ connected: false, name: 'Mia' });
    await vi.waitFor(() => expect(pc.room().slots[1]?.playerId).toBeNull());

    const tablet = device();
    rooms.join(pc.room().code, 'Tom', tablet.send);
    expect(tablet.room().slots[1]?.name).toBe('Tom');
    rooms.leave(pc.send);
    expect(tablet.last('roomClosed')?.reason).toBe('closed');
    expect(rooms.open).toBe(false);
  });

  it('a guest leaving a match hands their side to the computer for the rest of it', () => {
    const world = hostAndGuest();
    const host = startMatch(world);
    world.rooms.leave(world.phone.send);
    expect(world.phone.last('roomClosed')?.reason).toBe('left');
    expect(host.controls('defender')).toBe(true);
    expect(world.pc.room().slots[1]).toMatchObject({ playerId: null, controller: 'human' });
  });

  it('gives both people XP and a high score against each other, and the computer none', async () => {
    const save = defaultSave();
    const world = hostAndGuest(setup(undefined, 60, save));
    const host = startMatch(world);
    let launched = false;
    while (!host.match.isOver) {
      world.tick(500);
      host.advance();
      if (!launched && host.match.phase === 'combat') {
        launched = true;
        world.matches.command(
          {
            type: 'launchWave',
            side: 'attacker',
            groups: [
              { unitTypeId: 'runner', count: 16, formation: 'column', routeId: 'hill-path', delaySeconds: 0 },
            ],
          },
          world.pc.send,
        );
      }
    }
    await vi.waitFor(() => expect(world.phone.last('matchRewards')).toBeDefined());
    const xp = save.profiles['test-stage'] ?? {};
    expect(Object.keys(xp).sort()).toEqual(['courier', 'gatekeeper']);
    expect(save.statistics).toMatchObject({ matchesPlayed: 1, wifiMatches: 1, wins: 1, losses: 1 });
    expect(save.highScores.map((h) => [h.side, h.opponent, h.players[0]?.name])).toEqual([
      ['attacker', 'human', 'Guo'],
      ['defender', 'human', 'Mia'],
    ]);
    // A win against a person does not unlock levels (only beating the computer does).
    expect(save.records).toEqual({});
    expect(world.pc.last('matchRewards')?.rewards.defender?.xp?.gained.victory).toBe(0);
  });

  it('shows the result, plays again and goes back to the lobby', () => {
    const world = hostAndGuest();
    const host = startMatch(world);
    const { pc, phone, rooms, matches, tick } = world;
    const first = phone.room().matchId;
    let launched = false;
    while (!host.match.isOver) {
      tick(500);
      host.advance();
      if (!launched && host.match.phase === 'combat') {
        launched = true;
        matches.command(
          {
            type: 'launchWave',
            side: 'attacker',
            groups: [
              { unitTypeId: 'runner', count: 16, formation: 'column', routeId: 'hill-path', delaySeconds: 0 },
            ],
          },
          pc.send,
        );
      }
    }
    expect(phone.room().phase).toBe('result');
    expect(phone.last('snapshot')?.snapshot.result?.winner).toBe('attacker');

    rooms.start(phone.send);
    expect(phone.error()).toBe('hostOnly');
    rooms.start(pc.send);
    expect(phone.room().phase).toBe('match');
    expect(phone.room().matchId).not.toBe(first);
    rooms.toLobby(pc.send);
    expect(phone.room()).toMatchObject({ phase: 'lobby', matchId: null });
    expect(phone.room().slots[1]?.ready).toBe(false);
    expect(matches.hostOf(pc.send)).toBeUndefined();
  });

  it('keeps Wi-Fi matches out of the open match list', () => {
    const world = hostAndGuest();
    startMatch(world);
    expect(world.matches.list()).toEqual([]);
    const watcher = device();
    expect(world.matches.join(world.phone.room().matchId ?? '', 'spectator', watcher.send)).toMatchObject({
      ok: false,
    });
  });
});

describe('Wi-Fi rooms over the game server', () => {
  it('lets only the PC host and says a game is open', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gtd-rooms-'));
    await prepareUserData(dir);
    const saves = new SaveManager(dir);
    await saves.load();
    const server = await listen(createGameServer({ version: '9.9.9', stages, saves }), 0, '127.0.0.1');
    try {
      const ws = new WebSocket(`${server.url.replace('http', 'ws')}/ws`);
      const received: ServerMessage[] = [];
      ws.on('message', (data) => received.push(JSON.parse(String(data)) as ServerMessage));
      await new Promise((done, fail) => ws.on('open', done).on('error', fail));
      ws.send(JSON.stringify({ type: 'hostRoom', name: 'Guo' }));
      await vi.waitFor(() => expect(received.some((m) => m.type === 'room')).toBe(true));
      const info = (await (await fetch(`${server.url}/api/network`)).json()) as { room: boolean };
      expect(info.room).toBe(true);
      ws.close();
    } finally {
      await server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('discovery', () => {
  it('works out the broadcast address of each network', () => {
    expect(
      broadcastAddresses({
        wlan0: [
          {
            address: '192.168.1.20',
            netmask: '255.255.255.0',
            family: 'IPv4',
            mac: '',
            internal: false,
            cidr: null,
          },
        ],
        lo: [
          { address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '', internal: true, cidr: null },
        ],
      }),
    ).toEqual(['192.168.1.255']);
  });

  it('hears another PC announce its open game', async () => {
    const port = 40000 + Math.floor(Math.random() * 20000);
    const listener = new Discovery({ announce: () => null, port });
    const announcer = new Discovery({
      announce: () => ({ port: 3001, hostNames: ['Guo'] }),
      port,
      targets: () => ['127.0.0.1'],
    });
    try {
      expect((await listener.nearby()).listening).toBe(true);
      await vi.waitFor(
        async () => {
          announcer.announce();
          expect((await listener.nearby()).games).toEqual([
            { address: 'http://127.0.0.1:3001/', hostName: 'Guo', seenSecondsAgo: 0 },
          ]);
        },
        { timeout: 3000, interval: 100 },
      );
    } finally {
      listener.stop();
      announcer.stop();
    }
  });
});
