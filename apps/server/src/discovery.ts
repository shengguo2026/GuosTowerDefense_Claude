import { createSocket, type Socket } from 'node:dgram';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import type { NearbyGame, NearbyGames } from '@gtd/protocol';

/** UDP port on which hosting PCs announce their open Wi-Fi games. */
export const DISCOVERY_PORT = 41779;
const GAME = 'guos-tower-defense';
/** How often a hosting PC announces its game. */
const ANNOUNCE_MS = 2000;
/** A game not announced for this long is gone. */
const FORGET_MS = 7000;
/** A PC stops listening when nobody looked at the nearby games for this long. */
const LISTEN_MS = 60_000;

interface Announcement {
  game: typeof GAME;
  port: number;
  hostName: string;
}

/** The broadcast address of each network the PC is in (for example 192.168.1.255 for 192.168.1.20/24). */
export function broadcastAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string[] {
  const found = new Set<string>();
  for (const entries of Object.values(interfaces)) {
    for (const net of entries ?? []) {
      if (net.family !== 'IPv4' || net.internal || net.address.startsWith('169.254.')) continue;
      const address = net.address.split('.').map(Number);
      const mask = net.netmask.split('.').map(Number);
      found.add(address.map((part, i) => (part | (~(mask[i] ?? 0) & 255)) & 255).join('.'));
    }
  }
  return [...found];
}

/**
 * Automatic discovery "where practical" (spec §14): while a Wi-Fi game waits for players, the hosting PC announces it
 * to its networks every two seconds. Browsers cannot listen for that, so another PC with the game installed listens in
 * its own game server and lists the games it heard; tablets and phones join with the QR code or the address instead.
 * Routers and guest networks may drop the announcements; the address and the code always work.
 */
export class Discovery {
  private announcer: Socket | undefined;
  private announcerBound = false;
  private announceTimer: NodeJS.Timeout | undefined;
  private listener: Socket | undefined;
  private listenUntil = 0;
  private listenTimer: NodeJS.Timeout | undefined;
  private listenFailed = false;
  private readonly heard = new Map<string, { hostName: string; seenAt: number }>();

  constructor(
    private readonly options: {
      /** What to announce right now: the game's port and the host names of open games (none: stay quiet). */
      announce(): { port: number; hostNames: string[] } | null;
      /** This PC's own game, so it does not list itself. */
      ownAddresses?(): string[];
      port?: number;
      targets?(): string[];
      now?(): number;
    },
  ) {}

  /** Starts announcing open games (only while there are any). */
  start(): void {
    if (this.announceTimer) return;
    this.announceTimer = setInterval(() => this.announce(), ANNOUNCE_MS);
    this.announceTimer.unref();
  }

  stop(): void {
    clearInterval(this.announceTimer);
    this.announceTimer = undefined;
    this.announcer?.close();
    this.announcer = undefined;
    this.announcerBound = false;
    clearTimeout(this.listenTimer);
    this.listener?.close();
    this.listener = undefined;
  }

  /** The games heard recently; starts listening for a minute (again) if needed. */
  async nearby(): Promise<NearbyGames> {
    await this.listen();
    const now = this.now();
    const games: NearbyGame[] = [];
    for (const [address, game] of this.heard) {
      if (now - game.seenAt > FORGET_MS) {
        this.heard.delete(address);
        continue;
      }
      games.push({
        address,
        hostName: game.hostName,
        seenSecondsAgo: Math.floor((now - game.seenAt) / 1000),
      });
    }
    return { listening: this.listener !== undefined, games };
  }

  /** Sends one announcement now (tests call it directly). */
  announce(): void {
    const what = this.options.announce();
    if (!what || what.hostNames.length === 0) return;
    if (!this.announcer) {
      const socket = createSocket({ type: 'udp4', reuseAddr: true });
      socket.on('error', () => undefined);
      socket.bind(0, () => {
        socket.setBroadcast(true);
        this.announcerBound = true;
      });
      socket.unref();
      this.announcer = socket;
    }
    const socket = this.announcer;
    const message = Buffer.from(
      JSON.stringify({
        game: GAME,
        port: what.port,
        hostName: what.hostNames[0] ?? '',
      } satisfies Announcement),
    );
    const port = this.options.port ?? DISCOVERY_PORT;
    const send = () => {
      for (const target of this.options.targets?.() ?? [...broadcastAddresses(), '255.255.255.255'])
        socket.send(message, port, target, () => undefined);
    };
    // The socket binds asynchronously the first time.
    if (this.announcerBound) send();
    else socket.once('listening', send);
  }

  private async listen(): Promise<void> {
    this.listenUntil = this.now() + LISTEN_MS;
    if (this.listener || this.listenFailed) return;
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('message', (data, from) => this.hear(data, from.address));
    const ok = await new Promise<boolean>((resolve) => {
      socket.once('error', () => resolve(false));
      socket.bind(this.options.port ?? DISCOVERY_PORT, () => resolve(true));
    });
    if (!ok) {
      // Another program holds the port; the address still works.
      this.listenFailed = true;
      socket.close();
      return;
    }
    socket.on('error', () => undefined);
    socket.unref();
    this.listener = socket;
    const check = () => {
      if (this.now() < this.listenUntil) {
        this.listenTimer = setTimeout(check, 5000);
        this.listenTimer.unref();
        return;
      }
      this.listener?.close();
      this.listener = undefined;
    };
    check();
  }

  private hear(data: Buffer, from: string): void {
    let message: Partial<Announcement>;
    try {
      message = JSON.parse(data.toString('utf8')) as Partial<Announcement>;
    } catch {
      return;
    }
    if (message.game !== GAME || typeof message.port !== 'number' || !Number.isInteger(message.port)) return;
    if (message.port <= 0 || message.port > 65535) return;
    const address = `http://${from}:${message.port}/`;
    if (this.options.ownAddresses?.().includes(address)) return;
    const hostName = typeof message.hostName === 'string' ? message.hostName.slice(0, 24) : '';
    this.heard.set(address, { hostName, seenAt: this.now() });
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
