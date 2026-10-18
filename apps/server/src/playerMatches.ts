import { createAi, type Controller, type Difficulty } from '@gtd/ai';
import { createMatchSetup, type StagePack } from '@gtd/content-schema';
import {
  seatControls,
  withTick,
  type ComputerPlayer,
  type MatchCommand,
  type MatchSpeed,
  type MatchSummary,
  type Seat,
  type ServerMessage,
} from '@gtd/protocol';
import type { Match, Side } from '@gtd/sim';
import { MatchHost } from './matchHost';

type Send = (message: ServerMessage) => void;

interface PlayerMatch {
  matchId: string;
  stageId: string;
  levelId: string;
  host: MatchHost;
  started: ServerMessage;
  players: Map<Send, Seat>;
  computer?: ComputerPlayer;
  /** A guided tutorial: never counts for progress. */
  tutorial: boolean;
  /** Where the match's event log was last read, to tell players about their rejected commands. */
  eventIndex: number;
}

/** A person beat the computer: the stage, level, the person's side and the difficulty. */
export interface SinglePlayerWin {
  stageId: string;
  levelId: string;
  side: Side;
  difficulty: Difficulty;
}

type Result<T> = { ok: true; value: T } | { ok: false; message: ServerMessage };

/**
 * Matches between people, or a person against the computer: each connection takes a seat (one side, both sides on one
 * screen, or watching) and gets snapshots of what that seat may see. The computer plays its side from that side's view,
 * like a person would. A match stops once nobody is connected to it any more.
 */
export class PlayerMatches {
  private readonly matches = new Map<string, PlayerMatch>();
  private counter = 0;

  constructor(
    private readonly stages: StagePack[],
    private readonly options: {
      onWin?(win: SinglePlayerWin): void;
      /** Injectable clock for tests. */
      now?: () => number;
    } = {},
  ) {}

  create(
    request: {
      stageId: string;
      levelId: string;
      attackerProfileId?: string;
      defenderProfileId?: string;
      seat: Seat;
      opponent?: Difficulty;
      showAiReasoning?: boolean;
      tutorial?: boolean;
    },
    send: Send,
  ): boolean {
    // The computer takes the side the person leaves free, so the person must pick one side.
    if (request.opponent && request.seat !== 'attacker' && request.seat !== 'defender') return false;
    const pack = this.stages.find((stage) => stage.manifest.id === request.stageId);
    if (!pack?.levels.some((level) => level.id === request.levelId)) return false;
    const attackerProfileId = request.attackerProfileId ?? (pack.manifest.profiles.attacker[0] as string);
    const defenderProfileId = request.defenderProfileId ?? (pack.manifest.profiles.defender[0] as string);
    let setup;
    try {
      setup = createMatchSetup(pack, {
        levelId: request.levelId,
        attackerProfileId,
        defenderProfileId,
        seed: Date.now() % 1_000_000,
      });
    } catch {
      return false;
    }
    this.leave(send);
    const matchId = `match-${++this.counter}`;
    const computer: ComputerPlayer | undefined = request.opponent
      ? { side: request.seat === 'attacker' ? 'defender' : 'attacker', difficulty: request.opponent }
      : undefined;
    const controllers: { attacker?: Controller; defender?: Controller } = {};
    if (computer) {
      const ai = createAi(computer.side, computer.difficulty, setup.seed);
      if (request.showAiReasoning)
        ai.onThought = (thought) => {
          for (const player of match.players.keys()) player({ type: 'aiThought', matchId, thought });
        };
      controllers[computer.side] = ai;
    }
    const match: PlayerMatch = {
      matchId,
      stageId: pack.manifest.id,
      levelId: request.levelId,
      players: new Map(),
      ...(computer ? { computer } : {}),
      tutorial: request.tutorial === true && computer !== undefined,
      eventIndex: 0,
      started: {
        type: 'matchStarted',
        matchId,
        stageId: pack.manifest.id,
        levelId: request.levelId,
        attackerProfileId,
        defenderProfileId,
        ...(computer ? { computer } : {}),
      },
      host: new MatchHost({
        setup,
        ...controllers,
        onFrame: (m) => this.frame(match, m),
        onEnd: () => this.ended(match),
        ...(this.options.now ? { now: this.options.now } : {}),
      }),
    };
    this.matches.set(matchId, match);
    this.seat(match, request.seat, send);
    match.host.start();
    return true;
  }

  /** Pause or resume a single-player match (a person against the computer). */
  setPaused(paused: boolean, send: Send): Result<null> {
    const match = this.singlePlayerMatchOf(send);
    if (!match.ok) return match;
    match.value.host.paused = paused;
    this.broadcastClock(match.value);
    return { ok: true, value: null };
  }

  setSpeed(speed: MatchSpeed, send: Send): Result<null> {
    const match = this.singlePlayerMatchOf(send);
    if (!match.ok) return match;
    match.value.host.speed = speed;
    this.broadcastClock(match.value);
    return { ok: true, value: null };
  }

  join(matchId: string, seat: Seat, send: Send): Result<null> {
    const match = this.matches.get(matchId);
    if (!match) return { ok: false, message: error('unknownMatch', 'This match is no longer running.') };
    if (match.computer && seat !== 'spectator' && seatControls(seat, match.computer.side))
      return { ok: false, message: error('seatTaken', 'The computer plays that side.') };
    this.leave(send);
    this.seat(match, seat, send);
    send({ type: 'snapshot', matchId, snapshot: match.host.match.snapshot(viewOf(seat)) });
    this.broadcastClock(match);
    return { ok: true, value: null };
  }

  /** Checks that the connection holds the command's side, then queues it for the next tick. */
  command(command: MatchCommand, send: Send): Result<null> {
    const match = this.matchOf(send);
    if (!match) return { ok: false, message: error('notInMatch', 'Join a match first.') };
    const seat = match.players.get(send) as Seat;
    if (!seatControls(seat, command.side))
      return { ok: false, message: error('notYourSide', 'That is the other side.') };
    match.host.submit(withTick(command, 0));
    return { ok: true, value: null };
  }

  leave(send: Send): void {
    for (const [id, match] of this.matches) {
      if (!match.players.delete(send)) continue;
      if (match.players.size === 0) {
        match.host.stop();
        this.matches.delete(id);
      }
    }
  }

  list(): MatchSummary[] {
    return [...this.matches.values()].map((match) => ({
      matchId: match.matchId,
      stageId: match.stageId,
      levelId: match.levelId,
      seats: [...match.players.values()],
      ...(match.computer ? { computer: match.computer } : {}),
      phase: match.host.match.phase,
    }));
  }

  stopAll(): void {
    for (const match of this.matches.values()) match.host.stop();
    this.matches.clear();
  }

  get running(): number {
    return this.matches.size;
  }

  /** The live match a connection plays in, for tests and tools. */
  hostOf(send: Send): MatchHost | undefined {
    return this.matchOf(send)?.host;
  }

  private seat(match: PlayerMatch, seat: Seat, send: Send): void {
    match.players.set(send, seat);
    send(match.started);
    send({ type: 'joined', matchId: match.matchId, seat });
    send(this.clockOf(match));
  }

  /** Single player: the computer plays one side and the person holds the other (pause and speed are allowed). */
  private singlePlayerMatchOf(send: Send): Result<PlayerMatch> {
    const match = this.matchOf(send);
    if (!match) return { ok: false, message: error('notInMatch', 'Join a match first.') };
    const seat = match.players.get(send) as Seat;
    if (!match.computer || seat === 'spectator')
      return { ok: false, message: error('notSinglePlayer', 'Only a match against the computer can pause.') };
    return { ok: true, value: match };
  }

  private clockOf(match: PlayerMatch): ServerMessage {
    return {
      type: 'clock',
      matchId: match.matchId,
      paused: match.host.paused,
      speed: match.host.speed,
      canControl: match.computer !== undefined,
    };
  }

  private broadcastClock(match: PlayerMatch): void {
    const message = this.clockOf(match);
    for (const player of match.players.keys()) player(message);
  }

  private ended(match: PlayerMatch): void {
    const result = match.host.match.result;
    if (!result || !match.computer || match.tutorial || result.winner === match.computer.side) return;
    this.options.onWin?.({
      stageId: match.stageId,
      levelId: match.levelId,
      side: result.winner,
      difficulty: match.computer.difficulty,
    });
  }

  private matchOf(send: Send): PlayerMatch | undefined {
    for (const match of this.matches.values()) if (match.players.has(send)) return match;
    return undefined;
  }

  private frame(match: PlayerMatch, sim: Match): void {
    const views = new Map<Side | null, ReturnType<Match['snapshot']>>();
    const rejected = sim.events
      .since(match.eventIndex)
      .flatMap((e) => (e.type === 'commandRejected' ? [e] : []));
    match.eventIndex = sim.events.length;
    for (const [send, seat] of match.players) {
      const viewer = viewOf(seat);
      if (!views.has(viewer)) views.set(viewer, sim.snapshot(viewer));
      send({
        type: 'snapshot',
        matchId: match.matchId,
        snapshot: views.get(viewer) as ReturnType<Match['snapshot']>,
      });
      for (const event of rejected)
        if (seatControls(seat, event.side))
          send({ type: 'commandRejected', command: event.command, reason: event.reason });
    }
  }
}

/** Which view of the match a seat gets: a side sees its own view, both sides and watchers see everything. */
function viewOf(seat: Seat): Side | null {
  return seat === 'attacker' || seat === 'defender' ? seat : null;
}

function error(
  code: 'unknownMatch' | 'notYourSide' | 'notInMatch' | 'seatTaken' | 'notSinglePlayer',
  message: string,
): ServerMessage {
  return { type: 'error', code, message };
}
