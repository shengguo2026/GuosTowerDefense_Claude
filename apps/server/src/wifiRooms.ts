import { randomBytes, randomInt } from 'node:crypto';
import { DIFFICULTIES, type Difficulty } from '@gtd/ai';
import type { StagePack } from '@gtd/content-schema';
import type { Progress, RoomErrorCode, RoomSlot, RoomState, ServerMessage, SlotId } from '@gtd/protocol';
import type { Side } from '@gtd/sim';
import type { PlayerMatches } from './playerMatches';

type Send = (message: ServerMessage) => void;

interface Player {
  playerId: string;
  /** Session token: proves on reconnect that this device was in the room (spec §14). */
  token: string;
  name: string;
  host: boolean;
  /** The player's connection, or null while their device is away. */
  send: Send | null;
  /** Ends the wait for a player who dropped out of the lobby or the result screen. */
  awayTimer?: NodeJS.Timeout;
}

interface Slot {
  slotId: SlotId;
  side: Side;
  controller: 'human' | 'ai';
  playerId: string | null;
  profileId: string;
  ready: boolean;
}

interface Room {
  code: string;
  phase: RoomState['phase'];
  stageId: string;
  levelId: string;
  difficulty: Difficulty;
  slots: Slot[];
  players: Map<string, Player>;
  matchId: string | null;
}

export interface WifiRoomsOptions {
  /** Addresses for phones and tablets with the actual port (shown in the lobby and in its QR code). */
  addresses(): string[];
  /** The host's progress: guests play what the host has unlocked (spec §14). */
  progress(): Progress;
  /** How long a player who dropped out of the lobby keeps their place. */
  awaySeconds?: number;
}

type Result = { ok: true } | { ok: false; code: RoomErrorCode };
const OK: Result = { ok: true };
const fail = (code: RoomErrorCode): Result => ({ ok: false, code });

/** How long a player who dropped out of the lobby or the result screen keeps their place, by default. */
export const AWAY_SECONDS = 60;

/**
 * Wi-Fi rooms (spec §14, 1v1 in R2): the PC opens a room with a 6-digit code, a tablet or phone joins with the code
 * and gets a session token, both pick profiles and get ready, and the host starts the match. A player who drops out of
 * a running match is replaced by the computer until they come back with their token; a room whose host leaves closes.
 */
export class WifiRooms {
  private readonly rooms = new Map<string, Room>();
  /** Which room and player each connection is. */
  private readonly members = new Map<Send, { code: string; playerId: string }>();
  private playerCounter = 0;

  constructor(
    private readonly stages: StagePack[],
    private readonly matches: PlayerMatches,
    private readonly options: WifiRoomsOptions,
  ) {}

  /** A room is waiting for players (the share screen and the menu tell guests to join). */
  get open(): boolean {
    return [...this.rooms.values()].some((room) => room.phase === 'lobby');
  }

  /** Name of the host of each room waiting for players (announced to other PCs in the network). */
  get openHosts(): string[] {
    return [...this.rooms.values()]
      .filter((room) => room.phase === 'lobby')
      .map((room) => [...room.players.values()].find((p) => p.host)?.name ?? '');
  }

  host(name: string, send: Send): void {
    this.leave(send);
    const pack = this.defaultStage();
    if (!pack) return send({ type: 'roomError', code: 'badChoice' });
    let code: string;
    do code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    while (this.rooms.has(code));
    const host = this.newPlayer(name, true, send);
    const room: Room = {
      code,
      phase: 'lobby',
      stageId: pack.manifest.id,
      levelId: pack.levels[0]?.id ?? '',
      difficulty: 'medium',
      slots: (['attacker', 'defender'] as const).map((side) => ({
        slotId: side === 'attacker' ? 'A1' : 'D1',
        side,
        controller: 'human',
        playerId: side === 'attacker' ? host.playerId : null,
        profileId: pack.manifest.profiles[side][0] ?? '',
        ready: false,
      })),
      players: new Map([[host.playerId, host]]),
      matchId: null,
    };
    this.rooms.set(code, room);
    this.attach(room, host, send);
  }

  join(code: string, name: string, send: Send): void {
    const room = this.rooms.get(code);
    if (!room) return send({ type: 'roomError', code: 'roomNotFound' });
    if (this.members.get(send)?.code === code) return this.welcome(room, send);
    // New players cannot join a running match (spec §14).
    if (room.phase !== 'lobby') return send({ type: 'roomError', code: 'roomRunning' });
    const slot = room.slots.find((s) => s.controller === 'human' && s.playerId === null);
    if (!slot) return send({ type: 'roomError', code: 'roomFull' });
    this.leave(send);
    const player = this.newPlayer(name, false, send);
    room.players.set(player.playerId, player);
    slot.playerId = player.playerId;
    slot.ready = false;
    this.attach(room, player, send);
  }

  /** A device comes back with its token: it gets its place back, and its side back from the computer in a match. */
  rejoin(code: string, token: string, send: Send): void {
    const room = this.rooms.get(code);
    if (!room) return send({ type: 'roomError', code: 'roomNotFound' });
    const player = [...room.players.values()].find((p) => p.token === token);
    if (!player) return send({ type: 'roomError', code: 'badToken' });
    const current = this.members.get(send);
    if (current && (current.code !== code || current.playerId !== player.playerId)) this.leave(send);
    // The old connection may still look open (a phone that went to sleep): the new one replaces it.
    if (player.send && player.send !== send) {
      this.members.delete(player.send);
      this.matches.leave(player.send);
    }
    this.attach(room, player, send);
  }

  /** The player leaves on purpose: a host closes the room, a guest frees their slot (the computer finishes a match). */
  leave(send: Send): void {
    const member = this.members.get(send);
    if (!member) return;
    const room = this.rooms.get(member.code);
    this.members.delete(send);
    const player = room?.players.get(member.playerId);
    if (!room || !player) return;
    if (player.host) return this.close(room);
    clearTimeout(player.awayTimer);
    room.players.delete(player.playerId);
    const slot = this.slotOf(room, player.playerId);
    if (slot) {
      slot.playerId = null;
      slot.ready = false;
      if (room.matchId) this.matches.setComputer(room.matchId, slot.side, true);
    }
    send({ type: 'roomClosed', reason: 'left' });
    this.broadcast(room);
  }

  /** The connection dropped: the computer plays for the player in a match, and the player may come back. */
  disconnected(send: Send): void {
    const member = this.members.get(send);
    if (!member) return;
    this.members.delete(send);
    const room = this.rooms.get(member.code);
    const player = room?.players.get(member.playerId);
    if (!room || !player || player.send !== send) return;
    player.send = null;
    const slot = this.slotOf(room, player.playerId);
    if (room.phase === 'match' && room.matchId) {
      if (slot) this.matches.setComputer(room.matchId, slot.side, true);
      if (player.host) this.matches.setWifiHost(room.matchId, null);
    }
    if (room.phase !== 'match') this.waitForReturn(room, player);
    this.broadcast(room);
  }

  settings(send: Send, stageId: string, levelId: string, difficulty: Difficulty): void {
    this.hostAction(send, (room) => {
      const pack = this.stages.find((stage) => stage.manifest.id === stageId);
      const level = pack?.levels.find((l) => l.id === levelId);
      if (!pack || !level || !DIFFICULTIES.includes(difficulty)) return fail('badChoice');
      if (level.unlockedBy && !this.options.progress().completedLevels[stageId]?.includes(level.unlockedBy))
        return fail('badChoice');
      room.stageId = stageId;
      room.levelId = levelId;
      room.difficulty = difficulty;
      for (const slot of room.slots) {
        if (!pack.manifest.profiles[slot.side].includes(slot.profileId))
          slot.profileId = pack.manifest.profiles[slot.side][0] ?? '';
      }
      this.unready(room);
      return OK;
    });
  }

  slotController(send: Send, slotId: SlotId, controller: 'human' | 'ai'): void {
    this.hostAction(send, (room) => {
      const slot = room.slots.find((s) => s.slotId === slotId);
      if (!slot || slot.playerId) return fail('slotTaken');
      slot.controller = controller;
      slot.ready = false;
      return OK;
    });
  }

  /** The host moves the players: the two slots swap their people (each side keeps its profile). */
  swap(send: Send): void {
    this.hostAction(send, (room) => {
      const [a, d] = room.slots as [Slot, Slot];
      [a.playerId, d.playerId] = [d.playerId, a.playerId];
      [a.controller, d.controller] = [d.controller, a.controller];
      this.unready(room);
      return OK;
    });
  }

  takeSlot(send: Send, slotId: SlotId): void {
    this.lobbyAction(send, (room, player) => {
      const target = room.slots.find((s) => s.slotId === slotId);
      const own = this.slotOf(room, player.playerId);
      if (!target || target === own) return OK;
      if (target.controller !== 'human' || target.playerId) return fail('slotTaken');
      if (own?.ready) return fail('locked');
      if (own) own.playerId = null;
      target.playerId = player.playerId;
      target.ready = false;
      return OK;
    });
  }

  choose(send: Send, choice: { slotId?: SlotId; name?: string; profileId?: string }): void {
    this.lobbyAction(send, (room, player) => {
      const own = this.slotOf(room, player.playerId);
      let slot = own;
      if (choice.slotId && choice.slotId !== own?.slotId) {
        // The host picks the computer's profile.
        slot = room.slots.find((s) => s.slotId === choice.slotId);
        if (!player.host || slot?.controller !== 'ai') return fail('hostOnly');
      }
      if (slot?.ready) return fail('locked');
      if (choice.profileId !== undefined) {
        const pack = this.stages.find((stage) => stage.manifest.id === room.stageId);
        if (!slot || !pack?.manifest.profiles[slot.side].includes(choice.profileId)) return fail('badChoice');
        slot.profileId = choice.profileId;
      }
      if (choice.name !== undefined && slot === own) player.name = choice.name;
      return OK;
    });
  }

  ready(send: Send, ready: boolean): void {
    this.lobbyAction(send, (room, player) => {
      const slot = this.slotOf(room, player.playerId);
      if (!slot) return fail('notInRoom');
      slot.ready = ready;
      return OK;
    });
  }

  /** Host: start the match once every person is ready (the host's Start counts as ready), or play it again. */
  start(send: Send): void {
    this.hostAction(
      send,
      (room) => {
        if (room.phase === 'match') return OK;
        const missing = room.slots.some(
          (slot) =>
            slot.controller === 'human' &&
            (!slot.playerId ||
              (room.phase === 'lobby' && !slot.ready && !room.players.get(slot.playerId)?.host)),
        );
        if (missing) return fail('notReady');
        if (room.matchId) this.matches.stop(room.matchId);
        const profile = (side: Side) => room.slots.find((s) => s.side === side)?.profileId ?? '';
        const players: [Send, Side][] = [];
        const computer: Side[] = [];
        for (const slot of room.slots) {
          const person = slot.playerId ? room.players.get(slot.playerId) : undefined;
          if (person?.send) players.push([person.send, slot.side]);
          else computer.push(slot.side);
        }
        const host = [...room.players.values()].find((p) => p.host)?.send ?? null;
        room.phase = 'match';
        const matchId = this.matches.createWifi({
          stageId: room.stageId,
          levelId: room.levelId,
          attackerProfileId: profile('attacker'),
          defenderProfileId: profile('defender'),
          difficulty: room.difficulty,
          players,
          computer,
          host,
          onEnd: () => {
            if (room.matchId !== matchId || room.phase !== 'match') return;
            room.phase = 'result';
            for (const player of room.players.values()) if (!player.send) this.waitForReturn(room, player);
            this.broadcast(room);
          },
        });
        if (!matchId) {
          room.phase = 'lobby';
          return fail('badChoice');
        }
        room.matchId = matchId;
        return OK;
      },
      ['lobby', 'result'],
    );
  }

  /** Host: everyone goes back to the lobby (a running match ends). */
  toLobby(send: Send): void {
    this.hostAction(
      send,
      (room) => {
        if (room.matchId) this.matches.stop(room.matchId);
        room.matchId = null;
        room.phase = 'lobby';
        this.unready(room);
        for (const slot of room.slots) {
          const person = slot.playerId ? room.players.get(slot.playerId) : undefined;
          if (person && !person.send) this.waitForReturn(room, person);
        }
        return OK;
      },
      ['match', 'result'],
    );
  }

  closeAll(): void {
    for (const room of [...this.rooms.values()]) this.close(room);
  }

  /** The room a connection is in, for tests and tools. */
  roomOf(send: Send): RoomState | undefined {
    const member = this.members.get(send);
    const room = member && this.rooms.get(member.code);
    return room ? this.state(room) : undefined;
  }

  private newPlayer(name: string, host: boolean, send: Send): Player {
    return {
      playerId: `p${++this.playerCounter}`,
      token: randomBytes(16).toString('hex'),
      name,
      host,
      send,
    };
  }

  /** Connects a player's device to the room (first time or coming back) and brings it up to date. */
  private attach(room: Room, player: Player, send: Send): void {
    clearTimeout(player.awayTimer);
    player.awayTimer = undefined;
    player.send = send;
    this.members.set(send, { code: room.code, playerId: player.playerId });
    send({ type: 'roomJoined', code: room.code, token: player.token, playerId: player.playerId });
    const slot = this.slotOf(room, player.playerId);
    if (room.matchId && room.phase !== 'lobby' && slot) {
      this.matches.seatWifi(room.matchId, slot.side, send);
      if (room.phase === 'match') this.matches.setComputer(room.matchId, slot.side, false);
      if (player.host) this.matches.setWifiHost(room.matchId, send);
    }
    this.broadcast(room);
  }

  private welcome(room: Room, send: Send): void {
    const member = this.members.get(send);
    const player = member && room.players.get(member.playerId);
    if (player) this.attach(room, player, send);
  }

  /**
   * A player away from the lobby or the result screen keeps their place for a while; then a guest's slot opens again
   * and a host's room closes. In a match the computer plays for them until the end (spec §14), so the wait starts
   * on the result screen.
   */
  private waitForReturn(room: Room, player: Player): void {
    clearTimeout(player.awayTimer);
    player.awayTimer = setTimeout(
      () => {
        player.awayTimer = undefined;
        if (player.send || this.rooms.get(room.code) !== room || room.phase === 'match') return;
        if (player.host) return this.close(room);
        room.players.delete(player.playerId);
        const slot = this.slotOf(room, player.playerId);
        if (slot) {
          slot.playerId = null;
          slot.ready = false;
        }
        this.broadcast(room);
      },
      (this.options.awaySeconds ?? AWAY_SECONDS) * 1000,
    );
    player.awayTimer.unref?.();
  }

  private close(room: Room): void {
    if (room.matchId) this.matches.stop(room.matchId);
    this.rooms.delete(room.code);
    for (const player of room.players.values()) {
      clearTimeout(player.awayTimer);
      if (!player.send) continue;
      this.members.delete(player.send);
      player.send({ type: 'roomClosed', reason: player.host ? 'left' : 'closed' });
    }
  }

  private lobbyAction(send: Send, action: (room: Room, player: Player) => Result): void {
    const member = this.members.get(send);
    const room = member && this.rooms.get(member.code);
    const player = room?.players.get(member?.playerId ?? '');
    if (!room || !player) return send({ type: 'roomError', code: 'notInRoom' });
    if (room.phase !== 'lobby') return send({ type: 'roomError', code: 'roomRunning' });
    const result = action(room, player);
    if (!result.ok) return send({ type: 'roomError', code: result.code });
    this.broadcast(room);
  }

  private hostAction(
    send: Send,
    action: (room: Room) => Result,
    phases: RoomState['phase'][] = ['lobby'],
  ): void {
    const member = this.members.get(send);
    const room = member && this.rooms.get(member.code);
    const player = room?.players.get(member?.playerId ?? '');
    if (!room || !player) return send({ type: 'roomError', code: 'notInRoom' });
    if (!player.host) return send({ type: 'roomError', code: 'hostOnly' });
    if (!phases.includes(room.phase)) return send({ type: 'roomError', code: 'roomRunning' });
    const result = action(room);
    if (!result.ok) return send({ type: 'roomError', code: result.code });
    this.broadcast(room);
  }

  /** A change of level or sides: every person confirms again. */
  private unready(room: Room): void {
    for (const slot of room.slots) slot.ready = false;
  }

  private slotOf(room: Room, playerId: string): Slot | undefined {
    return room.slots.find((slot) => slot.playerId === playerId);
  }

  private defaultStage(): StagePack | undefined {
    return this.stages.find((stage) => !stage.manifest.devOnly) ?? this.stages[0];
  }

  private state(room: Room): RoomState {
    const slots: RoomSlot[] = room.slots.map((slot) => {
      const person = slot.playerId ? room.players.get(slot.playerId) : undefined;
      return {
        slotId: slot.slotId,
        side: slot.side,
        controller: slot.controller,
        playerId: slot.playerId,
        name: person?.name ?? '',
        profileId: slot.profileId,
        ready: slot.controller === 'ai' || slot.ready,
        connected: Boolean(person?.send),
        host: person?.host ?? false,
      };
    });
    return {
      code: room.code,
      phase: room.phase,
      stageId: room.stageId,
      levelId: room.levelId,
      difficulty: room.difficulty,
      slots,
      matchId: room.matchId,
      addresses: this.options.addresses(),
    };
  }

  private broadcast(room: Room): void {
    const state = this.state(room);
    for (const player of room.players.values())
      player.send?.({ type: 'room', room: state, playerId: player.playerId, host: player.host });
  }
}
