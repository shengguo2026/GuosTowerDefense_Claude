import { createAi, type Controller, type Difficulty } from '@gtd/ai';
import { createMatchSetup, type StagePack } from '@gtd/content-schema';
import {
  PLANNING_PAUSES,
  PLANNING_PAUSE_SECONDS,
  seatControls,
  withTick,
  type ComputerPlayer,
  type MatchCommand,
  type MatchSpeed,
  type MatchSummary,
  type Seat,
  type ServerMessage,
} from '@gtd/protocol';
import type { SideReward } from '@gtd/protocol';
import type { Match, MatchSetup, Side } from '@gtd/sim';
import { MatchHost } from './matchHost';
import { finishedMatch, type FinishedMatch, type PlayedSide } from './progress';

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
  setup: MatchSetup;
  /** Single player, hot-seat or Wi-Fi: counts for progress. A debug match (people seated by hand) does not. */
  mode: FinishedMatch['mode'] | null;
  sides: Record<Side, PlayedSide>;
  /** Score and XP once the save has them, for players who come back to the result. */
  rewards?: Partial<Record<Side, SideReward>>;
  /** Two people on one PC: planning pauses (spec §5.2) instead of free pause and speed. */
  hotSeat?: {
    left: Record<Side, number>;
    by: Side | null;
    /** When the running pause ends by itself (the match clock's milliseconds). */
    endsAt: number;
  };
  /** Where the match's event log was last read, to tell players about their rejected commands. */
  eventIndex: number;
  /** A Wi-Fi match (spec §14): its room seats the players, and only the host may pause. */
  wifi?: {
    host: Send | null;
    difficulty: Difficulty;
    seed: number;
    onEnd(): void;
  };
}

/** A Wi-Fi match as its room starts it: who plays which side, and which sides the computer plays. */
export interface WifiMatchRequest {
  stageId: string;
  levelId: string;
  attackerProfileId: string;
  defenderProfileId: string;
  /** How well the computer plays its sides (an AI slot, or a person's side while they are away). */
  difficulty: Difficulty;
  players: [Send, Side][];
  computer: Side[];
  /** Sides people hold (also while the computer stands in for a device that is away); they earn XP. */
  humans: Side[];
  names: Record<Side, string>;
  host: Send | null;
  onEnd(): void;
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
      /** A match that counts ended: the save records it and says what each side got. */
      onFinished?(match: FinishedMatch): Promise<Partial<Record<Side, SideReward>>>;
      /** The profile level a person plays a profile with (their unlocked ranks are in effect). */
      profileLevel?(stageId: string, profileId: string): number;
      /** Injectable clock for tests. */
      now?: () => number;
      /** Injectable match seed for tests (normally taken from the clock, so every match plays out differently). */
      seed?: () => number;
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
      hotSeat?: boolean;
      names?: Partial<Record<Side, string>>;
    },
    send: Send,
  ): boolean {
    // The computer takes the side the person leaves free, so the person must pick one side.
    if (request.opponent && request.seat !== 'attacker' && request.seat !== 'defender') return false;
    // Hot-seat: both people share one screen, so one connection plays both sides.
    if (request.hotSeat && (request.seat !== 'both' || request.opponent)) return false;
    const pack = this.stages.find((stage) => stage.manifest.id === request.stageId);
    if (!pack?.levels.some((level) => level.id === request.levelId)) return false;
    const attackerProfileId = request.attackerProfileId ?? (pack.manifest.profiles.attacker[0] as string);
    const defenderProfileId = request.defenderProfileId ?? (pack.manifest.profiles.defender[0] as string);
    const tutorial = request.tutorial === true && request.opponent !== undefined;
    const mode = tutorial ? null : request.hotSeat ? 'hotSeat' : request.opponent ? 'single' : null;
    const humans: Side[] =
      mode === 'hotSeat' ? ['attacker', 'defender'] : mode === 'single' ? [request.seat as Side] : [];
    const profileIds = { attacker: attackerProfileId, defender: defenderProfileId };
    const ranks = this.ranksOf(pack.manifest.id, profileIds, humans);
    let setup;
    try {
      setup = createMatchSetup(pack, {
        levelId: request.levelId,
        attackerProfileId,
        defenderProfileId,
        seed: this.options.seed?.() ?? Date.now() % 1_000_000,
        ranks,
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
      tutorial,
      setup,
      mode,
      sides: sidesOf(profileIds, humans, request.names ?? {}),
      ...(request.hotSeat
        ? { hotSeat: { left: { attacker: PLANNING_PAUSES, defender: PLANNING_PAUSES }, by: null, endsAt: 0 } }
        : {}),
      eventIndex: 0,
      started: {
        type: 'matchStarted',
        matchId,
        stageId: pack.manifest.id,
        levelId: request.levelId,
        attackerProfileId,
        defenderProfileId,
        ...(computer ? { computer } : {}),
        ...(Object.keys(ranks).length > 0 ? { ranks } : {}),
      },
      host: new MatchHost({
        setup,
        ...controllers,
        onFrame: (m) => this.frame(match, m),
        onEnd: () => this.ended(match),
        onPaused: () => this.checkPlanningPause(match),
        ...(this.options.now ? { now: this.options.now } : {}),
      }),
    };
    this.matches.set(matchId, match);
    this.seat(match, request.seat, send);
    match.host.start();
    return true;
  }

  /** Starts a Wi-Fi match for a room; returns its id, or null if the level or a profile does not exist. */
  createWifi(request: WifiMatchRequest): string | null {
    const pack = this.stages.find((stage) => stage.manifest.id === request.stageId);
    const profileIds = { attacker: request.attackerProfileId, defender: request.defenderProfileId };
    const ranks = this.ranksOf(request.stageId, profileIds, request.humans);
    let setup;
    try {
      if (!pack) return null;
      setup = createMatchSetup(pack, {
        levelId: request.levelId,
        attackerProfileId: request.attackerProfileId,
        defenderProfileId: request.defenderProfileId,
        seed: this.options.seed?.() ?? Date.now() % 1_000_000,
        ranks,
      });
    } catch {
      return null;
    }
    for (const [send] of request.players) this.leave(send);
    const matchId = `match-${++this.counter}`;
    const controllers: { attacker?: Controller; defender?: Controller } = {};
    for (const side of request.computer) controllers[side] = createAi(side, request.difficulty, setup.seed);
    const match: PlayerMatch = {
      matchId,
      stageId: request.stageId,
      levelId: request.levelId,
      players: new Map(),
      tutorial: false,
      setup,
      mode: 'wifi',
      sides: sidesOf(profileIds, request.humans, request.names),
      eventIndex: 0,
      wifi: { host: request.host, difficulty: request.difficulty, seed: setup.seed, onEnd: request.onEnd },
      started: {
        type: 'matchStarted',
        matchId,
        stageId: request.stageId,
        levelId: request.levelId,
        attackerProfileId: request.attackerProfileId,
        defenderProfileId: request.defenderProfileId,
        ...(Object.keys(ranks).length > 0 ? { ranks } : {}),
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
    for (const [send, side] of request.players) this.seat(match, side, send);
    match.host.start();
    return matchId;
  }

  /** Wi-Fi: a player comes back into their room's match (after a dropped connection) and gets the current state. */
  seatWifi(matchId: string, side: Side, send: Send): boolean {
    const match = this.matches.get(matchId);
    if (!match?.wifi) return false;
    this.leave(send);
    this.seat(match, side, send);
    send({ type: 'snapshot', matchId, snapshot: match.host.match.snapshot(side) });
    return true;
  }

  /** Wi-Fi: the computer plays a side while its person is away (`true`), or hands it back (`false`). */
  setComputer(matchId: string, side: Side, computer: boolean): void {
    const match = this.matches.get(matchId);
    if (!match?.wifi || match.host.controls(side) === computer) return;
    match.host.setController(
      side,
      computer ? createAi(side, match.wifi.difficulty, match.wifi.seed + match.host.match.tick) : undefined,
    );
  }

  /** Wi-Fi: the host's connection (who may pause); a host who drops out cannot leave the match paused. */
  setWifiHost(matchId: string, host: Send | null): void {
    const match = this.matches.get(matchId);
    if (!match?.wifi) return;
    match.wifi.host = host;
    if (!host && match.host.paused) match.host.paused = false;
    this.broadcastClock(match);
  }

  /** Ends a match at once (its Wi-Fi room closed or went back to the lobby). */
  stop(matchId: string): void {
    const match = this.matches.get(matchId);
    if (!match) return;
    match.host.stop();
    this.matches.delete(matchId);
  }

  /** Pause or resume a single-player match (a person against the computer); in hot-seat, end a planning pause. */
  setPaused(paused: boolean, send: Send): Result<null> {
    const hotSeat = this.matchOf(send);
    if (hotSeat?.hotSeat && !paused && hotSeat.players.get(send) !== 'spectator') {
      this.endPlanningPause(hotSeat);
      return { ok: true, value: null };
    }
    const wifi = this.matchOf(send);
    if (wifi?.wifi) {
      if (wifi.wifi.host !== send)
        return { ok: false, message: error('hostOnly', 'Only the host can pause.') };
      wifi.host.paused = paused;
      this.broadcastClock(wifi);
      return { ok: true, value: null };
    }
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

  /** Hot-seat: a player pauses the match to plan, if they have a pause left and none is running. */
  planningPause(side: Side, send: Send): Result<null> {
    const match = this.matchOf(send);
    if (!match) return { ok: false, message: error('notInMatch', 'Join a match first.') };
    const state = match.hotSeat;
    if (!state || !seatControls(match.players.get(send) as Seat, side))
      return { ok: false, message: error('notHotSeat', 'Planning pauses are for hot-seat matches.') };
    if (match.host.paused || match.host.match.isOver) return { ok: true, value: null };
    if (state.left[side] <= 0)
      return { ok: false, message: error('noPausesLeft', 'No planning pauses are left.') };
    state.left[side]--;
    state.by = side;
    state.endsAt = this.now() + PLANNING_PAUSE_SECONDS * 1000;
    match.host.paused = true;
    this.broadcastClock(match);
    return { ok: true, value: null };
  }

  join(matchId: string, seat: Seat, send: Send): Result<null> {
    const match = this.matches.get(matchId);
    // A Wi-Fi match is only entered through its room (room code and session token).
    if (!match || match.wifi)
      return { ok: false, message: error('unknownMatch', 'This match is no longer running.') };
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
      // A Wi-Fi match keeps running for players who come back; its room stops it.
      if (match.players.size === 0 && !match.wifi) {
        match.host.stop();
        this.matches.delete(id);
      }
    }
  }

  list(): MatchSummary[] {
    return [...this.matches.values()]
      .filter((match) => !match.wifi)
      .map((match) => ({
        matchId: match.matchId,
        stageId: match.stageId,
        levelId: match.levelId,
        seats: [...match.players.values()],
        ...(match.computer ? { computer: match.computer } : {}),
        ...(match.hotSeat ? { hotSeat: true as const } : {}),
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
    send(this.clockOf(match, send));
    if (match.rewards) send({ type: 'matchRewards', matchId: match.matchId, rewards: match.rewards });
  }

  /** The profile levels people play with; a profile at level 1 (or the computer's side) plays the starting kit. */
  private ranksOf(
    stageId: string,
    profileIds: Record<Side, string>,
    humans: Side[],
  ): Partial<Record<Side, number>> {
    const ranks: Partial<Record<Side, number>> = {};
    for (const side of humans) {
      const level = this.options.profileLevel?.(stageId, profileIds[side]) ?? 1;
      if (level > 1) ranks[side] = level;
    }
    return ranks;
  }

  /** Single player: the computer plays one side and the person holds the other (pause and speed are allowed). */
  private singlePlayerMatchOf(send: Send): Result<PlayerMatch> {
    const match = this.matchOf(send);
    if (!match) return { ok: false, message: error('notInMatch', 'Join a match first.') };
    const seat = match.players.get(send) as Seat;
    if (match.wifi)
      return { ok: false, message: error('notSinglePlayer', 'The speed is fixed in Wi-Fi play.') };
    if (!match.computer || seat === 'spectator')
      return { ok: false, message: error('notSinglePlayer', 'Only a match against the computer can pause.') };
    return { ok: true, value: match };
  }

  private clockOf(match: PlayerMatch, player: Send): ServerMessage {
    const state = match.hotSeat;
    return {
      type: 'clock',
      matchId: match.matchId,
      paused: match.host.paused,
      speed: match.host.speed,
      canControl: match.computer !== undefined || (match.wifi !== undefined && match.wifi.host === player),
      ...(match.wifi ? { wifi: true as const } : {}),
      ...(state
        ? {
            planning: {
              left: { ...state.left },
              by: state.by,
              secondsLeft: state.by ? Math.max(0, Math.ceil((state.endsAt - this.now()) / 1000)) : 0,
            },
          }
        : {}),
    };
  }

  private checkPlanningPause(match: PlayerMatch): void {
    if (match.hotSeat?.by && this.now() >= match.hotSeat.endsAt) this.endPlanningPause(match);
  }

  private endPlanningPause(match: PlayerMatch): void {
    if (!match.hotSeat?.by) return;
    match.hotSeat.by = null;
    match.host.paused = false;
    this.broadcastClock(match);
  }

  private now(): number {
    return this.options.now?.() ?? performance.now();
  }

  private broadcastClock(match: PlayerMatch): void {
    for (const player of match.players.keys()) player(this.clockOf(match, player));
  }

  private ended(match: PlayerMatch): void {
    match.wifi?.onEnd();
    const sim = match.host.match;
    if (!sim.result || !match.mode || !this.options.onFinished) return;
    const finished = finishedMatch(
      {
        stageId: match.stageId,
        levelId: match.levelId,
        mode: match.mode,
        difficulty: match.computer?.difficulty ?? match.wifi?.difficulty ?? null,
        sides: match.sides,
      },
      match.setup,
      sim.snapshot(null),
      sim.events.all(),
    );
    this.options.onFinished(finished).then(
      (rewards) => {
        match.rewards = rewards;
        for (const player of match.players.keys())
          player({ type: 'matchRewards', matchId: match.matchId, rewards });
      },
      (error: unknown) => console.error('Could not save the match result:', error),
    );
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
          send({ type: 'commandRejected', command: event.command, reason: event.reason, side: event.side });
    }
  }
}

/** Which view of the match a seat gets: a side sees its own view, both sides and watchers see everything. */
function viewOf(seat: Seat): Side | null {
  return seat === 'attacker' || seat === 'defender' ? seat : null;
}

function error(
  code:
    | 'unknownMatch'
    | 'notYourSide'
    | 'notInMatch'
    | 'seatTaken'
    | 'notSinglePlayer'
    | 'notHotSeat'
    | 'noPausesLeft'
    | 'hostOnly',
  message: string,
): ServerMessage {
  return { type: 'error', code, message };
}

function sidesOf(
  profileIds: Record<Side, string>,
  humans: Side[],
  names: Partial<Record<Side, string>>,
): Record<Side, PlayedSide> {
  const side = (s: Side): PlayedSide => ({
    profileId: profileIds[s],
    controller: humans.includes(s) ? 'human' : 'ai',
    name: names[s] ?? '',
  });
  return { attacker: side('attacker'), defender: side('defender') };
}
