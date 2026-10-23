import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { StagePack } from '@gtd/content-schema';
import {
  NetworkPatchSchema,
  PROTOCOL_VERSION,
  SettingsPatchSchema,
  WEBSOCKET_PATH,
  parseClientMessage,
  type HealthResponse,
  type NetworkInfo,
  type ServerMessage,
  type StageSummary,
} from '@gtd/protocol';
import { WebSocketServer, type WebSocket } from 'ws';
import { DemoMatches } from './demoMatches';
import { Discovery } from './discovery';
import { isLoopback, lanAddresses, LanSharing } from './network';
import { PlayerMatches } from './playerMatches';
import type { SaveManager } from './saveManager';
import { WifiRooms } from './wifiRooms';

export interface GameServerOptions {
  version: string;
  stages: StagePack[];
  saves: SaveManager;
  /** Built client to serve; omitted in dev mode, where Vite serves the client. */
  clientDir?: string;
  /** Show developer-only stage packs (dev mode and tests). */
  showDevStages?: boolean;
  /** Folder with Codex art and textures, served under /art/. */
  artDir?: string;
  /** Opens the game to phones and tablets on request; defaults to the PC's real network addresses. */
  lan?: LanSharing;
  /** The server listens on every network already (`GTD_HOST=0.0.0.0`): sharing is always on. */
  listensEverywhere?: boolean;
  /** Operating system of the PC (for the Windows firewall explainer); defaults to this one. */
  platform?: NodeJS.Platform;
  /** Announces open Wi-Fi games to other PCs and lists theirs; defaults to UDP port 41779. */
  discovery?: (announce: () => { port: number; hostNames: string[] } | null) => Discovery;
  /** How long a Wi-Fi player who dropped out of the lobby keeps their place (tests shorten it). */
  roomAwaySeconds?: number;
}

export interface RunningGameServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
};

const MAX_BODY_BYTES = 64 * 1024;
/** The server checks every connection this often and drops one that did not answer this many checks in a row. */
const HEARTBEAT_MS = 5000;
const MISSED_CHECKS = 3;

export function createGameServer(options: GameServerOptions): Server {
  const visibleStages = options.stages.filter((stage) => options.showDevStages || !stage.manifest.devOnly);
  const demos = new DemoMatches(visibleStages);
  const players = new PlayerMatches(visibleStages, {
    onWin: (win) => {
      options.saves
        .recordWin(win.stageId, win.levelId, win.side, win.difficulty)
        .catch((error: unknown) => console.error('Could not save the win:', error));
    },
  });
  const stageSummaries: StageSummary[] = options.stages
    .filter((stage) => options.showDevStages || !stage.manifest.devOnly)
    .map((stage) => ({
      id: stage.manifest.id,
      order: stage.manifest.order,
      devOnly: stage.manifest.devOnly,
      title: {
        en: stage.texts.en[stage.manifest.title] ?? stage.manifest.id,
        de: stage.texts.de[stage.manifest.title] ?? stage.manifest.id,
        'zh-CN': stage.texts['zh-CN'][stage.manifest.title] ?? stage.manifest.id,
      },
      levelCount: stage.levels.length,
    }));

  const lan = options.lan ?? new LanSharing();
  /** Phones and tablets connected over the WebSocket, by network address. */
  const guestSockets = new Map<WebSocket, string>();
  const port = () => (server.address() as AddressInfo | null)?.port ?? 0;
  const sharedAddresses = () =>
    (options.listensEverywhere ? lanAddresses() : lan.open).map((address) => `http://${address}:${port()}/`);
  const rooms = new WifiRooms(visibleStages, players, {
    addresses: sharedAddresses,
    progress: () => options.saves.progress,
    ...(options.roomAwaySeconds !== undefined ? { awaySeconds: options.roomAwaySeconds } : {}),
  });
  // Other PCs with the game find open Wi-Fi games here; only games phones and tablets can reach are announced.
  const announce = () =>
    rooms.open && sharedAddresses().length > 0 ? { port: port(), hostNames: rooms.openHosts } : null;
  const discovery =
    options.discovery?.(announce) ?? new Discovery({ announce, ownAddresses: sharedAddresses });
  discovery.start();

  function networkInfo(req: IncomingMessage): NetworkInfo {
    const everywhere = options.listensEverywhere === true;
    const save = options.saves.data.network;
    return {
      host: isLoopback(req.socket.remoteAddress),
      sharing: everywhere || lan.active,
      fixed: everywhere,
      port: port(),
      addresses: sharedAddresses(),
      failed: everywhere ? [] : lan.failed,
      windows: (options.platform ?? process.platform) === 'win32',
      firewallExplained: save.firewallExplained,
      guests: new Set(guestSockets.values()).size,
      room: rooms.open,
    };
  }

  const server = createServer((req, res) => {
    handleHttp(req, res).catch((error: unknown) => {
      console.error('Request failed:', error);
      if (!res.headersSent) sendJson(res, 500, { error: 'internalError' });
      else res.end();
    });
  });

  async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method} ${url.pathname}`;

    if (route === 'GET /api/health') {
      const body: HealthResponse = {
        ok: true,
        name: 'guos-tower-defense',
        version: options.version,
        protocolVersion: PROTOCOL_VERSION,
        stages: stageSummaries,
      };
      return sendJson(res, 200, body);
    }
    if (route === 'GET /api/settings') return sendJson(res, 200, options.saves.data.settings);
    if (route === 'PUT /api/settings') {
      const patch = SettingsPatchSchema.safeParse(await readJsonBody(req));
      if (!patch.success) return sendJson(res, 400, { error: 'invalidSettings', issues: patch.error.issues });
      const save = await options.saves.updateSettings(patch.data);
      return sendJson(res, 200, save.settings);
    }
    const stageMatch = req.method === 'GET' && /^\/api\/stages\/([a-z0-9-]+)$/.exec(url.pathname);
    if (stageMatch) {
      const pack = visibleStages.find((stage) => stage.manifest.id === stageMatch[1]);
      return pack ? sendJson(res, 200, pack) : sendJson(res, 404, { error: 'unknownStage' });
    }
    if (route === 'GET /api/network') {
      // A new network (another Wi-Fi) may have appeared since sharing started.
      if (lan.active && !options.listensEverywhere) await lan.start(server, port());
      return sendJson(res, 200, networkInfo(req));
    }
    if (route === 'PUT /api/network') {
      if (!isLoopback(req.socket.remoteAddress)) return sendJson(res, 403, { error: 'hostOnly' });
      const patch = NetworkPatchSchema.safeParse(await readJsonBody(req));
      if (!patch.success) return sendJson(res, 400, { error: 'invalidNetwork', issues: patch.error.issues });
      if (!options.listensEverywhere) {
        if (patch.data.sharing) await lan.start(server, port());
        else await lan.stop();
      }
      await options.saves.setSharing(patch.data.sharing);
      return sendJson(res, 200, networkInfo(req));
    }
    if (route === 'GET /api/nearby') {
      // Only the PC's own browser looks for games on other PCs (a phone opens the address it was given).
      if (!isLoopback(req.socket.remoteAddress)) return sendJson(res, 403, { error: 'hostOnly' });
      return sendJson(res, 200, await discovery.nearby());
    }
    if (route === 'GET /api/progress') return sendJson(res, 200, options.saves.progress);
    if (route === 'GET /api/art') return sendJson(res, 200, await listArt(options.artDir));
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'notFound' });

    if (
      url.pathname.startsWith('/art/') &&
      options.artDir &&
      (req.method === 'GET' || req.method === 'HEAD')
    ) {
      return serveStatic(options.artDir, url.pathname.slice('/art'.length), res, false);
    }
    if (options.clientDir && (req.method === 'GET' || req.method === 'HEAD')) {
      return serveStatic(options.clientDir, url.pathname, res, true);
    }
    sendJson(res, 404, { error: 'notFound' });
  }

  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY_BYTES });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== WEBSOCKET_PATH) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => {
      const local = isLoopback(req.socket.remoteAddress);
      if (!local) {
        guestSockets.set(ws, (req.socket.remoteAddress ?? '').replace(/^::ffff:/, ''));
        ws.once('close', () => guestSockets.delete(ws));
      }
      handleSocket(ws, local);
    });
  });
  // A phone that went to sleep or left the Wi-Fi never says goodbye: a connection that misses a few checks in a row is
  // dropped, so the computer takes over its side within seconds instead of after the system's own long timeout. A
  // few, because a busy browser (building the 3D view in software) answers late.
  const missed = new Map<WebSocket, number>();
  const heartbeat = setInterval(() => {
    for (const ws of sockets.clients) {
      const count = missed.get(ws) ?? 0;
      if (count >= MISSED_CHECKS) {
        ws.terminate();
        continue;
      }
      missed.set(ws, count + 1);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();
  server.on('close', () => {
    clearInterval(heartbeat);
    discovery.stop();
    void lan.stop();
    rooms.closeAll();
    demos.stopAll();
    players.stopAll();
    sockets.close();
  });

  function handleSocket(ws: WebSocket, local: boolean): void {
    const send = (message: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    };
    ws.on('pong', () => missed.set(ws, 0));
    // Any message also shows the connection is alive.
    ws.on('message', () => missed.set(ws, 0));
    ws.on('close', () => {
      missed.delete(ws);
      demos.unwatch(send);
      players.leave(send);
      rooms.disconnected(send);
    });
    ws.on('message', (data) => {
      const message = parseClientMessage(String(data));
      if (!message) return send({ type: 'error', code: 'badMessage', message: 'Unrecognised message.' });
      switch (message.type) {
        case 'hello':
          if (message.protocolVersion !== PROTOCOL_VERSION) {
            return send({
              type: 'error',
              code: 'protocolMismatch',
              message: 'This page is from another game version. Please reload the page.',
            });
          }
          return send({
            type: 'welcome',
            serverVersion: options.version,
            protocolVersion: PROTOCOL_VERSION,
            stages: stageSummaries,
          });
        case 'ping':
          return send({ type: 'pong', sentAt: message.sentAt });
        case 'watchDemo':
          demos.unwatch(send);
          players.leave(send);
          if (!demos.watch(message.stageId, message.levelId, send)) {
            send({ type: 'error', code: 'unknownLevel', message: 'This level does not exist.' });
          }
          return;
        case 'stopWatching':
          return demos.unwatch(send);
        case 'createMatch':
          demos.unwatch(send);
          if (!players.create(message, send)) {
            send({ type: 'error', code: 'unknownLevel', message: 'This level or profile does not exist.' });
          }
          return;
        case 'joinMatch': {
          demos.unwatch(send);
          const joined = players.join(message.matchId, message.seat, send);
          if (!joined.ok) send(joined.message);
          return;
        }
        case 'leaveMatch':
          return players.leave(send);
        case 'listMatches':
          return send({ type: 'matches', matches: players.list() });
        case 'command': {
          const done = players.command(message.command, send);
          if (!done.ok) send(done.message);
          return;
        }
        case 'setPaused': {
          const done = players.setPaused(message.paused, send);
          if (!done.ok) send(done.message);
          return;
        }
        case 'setSpeed': {
          const done = players.setSpeed(message.speed, send);
          if (!done.ok) send(done.message);
          return;
        }
        case 'planningPause': {
          const done = players.planningPause(message.side, send);
          if (!done.ok) send(done.message);
          return;
        }
        case 'hostRoom':
          // The PC always hosts (spec §3); a tablet or phone joins.
          if (!local) return send({ type: 'roomError', code: 'hostOnly' });
          demos.unwatch(send);
          players.leave(send);
          return rooms.host(message.name, send);
        case 'joinRoom':
          demos.unwatch(send);
          return rooms.join(message.code, message.name, send);
        case 'rejoinRoom':
          demos.unwatch(send);
          return rooms.rejoin(message.code, message.token, send);
        case 'leaveRoom':
          return rooms.leave(send);
        case 'roomSettings':
          return rooms.settings(send, message.stageId, message.levelId, message.difficulty);
        case 'roomSlotController':
          return rooms.slotController(send, message.slotId, message.controller);
        case 'roomSwap':
          return rooms.swap(send);
        case 'roomTakeSlot':
          return rooms.takeSlot(send, message.slotId);
        case 'roomChoose':
          return rooms.choose(send, message);
        case 'roomReady':
          return rooms.ready(send, message.ready);
        case 'roomStart':
          return rooms.start(send);
        case 'roomLobby':
          return rooms.toLobby(send);
      }
    });
  }

  return server;
}

/** Starts listening and resolves once the port is open. */
export function listen(server: Server, port: number, host: string): Promise<RunningGameServer> {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const actualPort = (server.address() as AddressInfo).port;
      resolvePromise({
        port: actualPort,
        url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${actualPort}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

const ART_EXTENSIONS = ['.webp', '.png', '.jpg'];

/**
 * The Codex pictures that exist, by id and file name (e.g. `LEVEL-01-LION` → `LEVEL-01-LION.webp`), so the client can
 * show a placeholder for the rest without asking for missing files.
 */
async function listArt(artDir: string | undefined): Promise<Record<string, string>> {
  if (!artDir) return {};
  const files = await readdir(artDir).catch(() => [] as string[]);
  const art: Record<string, string> = {};
  for (const extension of ART_EXTENSIONS) {
    for (const file of files) {
      const id = file.slice(0, -extension.length);
      if (file.endsWith(extension) && /^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(id) && !(id in art)) art[id] = file;
    }
  }
  return art;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}

/** Serves the built client. Unknown paths without a file extension get index.html (single-page app). */
async function serveStatic(
  dir: string,
  pathname: string,
  res: ServerResponse,
  spaFallback: boolean,
): Promise<void> {
  const root = resolve(dir);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return sendJson(res, 400, { error: 'badPath' });
  }
  const requested = normalize(join(root, decoded));
  if (requested !== root && !requested.startsWith(root + sep))
    return sendJson(res, 403, { error: 'forbidden' });

  let file = requested;
  const info = await stat(file).catch(() => null);
  if (!info || info.isDirectory()) {
    if (spaFallback && (info?.isDirectory() || !extname(decoded))) file = join(root, 'index.html');
    else return sendJson(res, 404, { error: 'notFound' });
    if (!(await stat(file).catch(() => null))) return sendJson(res, 503, { error: 'clientNotBuilt' });
  }
  const isHtml = file.endsWith('.html');
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    // Hashed client assets can be cached forever; the page and art (fixed names) are revalidated.
    'cache-control': isHtml || !spaFallback ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  createReadStream(file).pipe(res);
}
