import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { StagePack } from '@gtd/content-schema';
import {
  PROTOCOL_VERSION,
  SettingsPatchSchema,
  WEBSOCKET_PATH,
  parseClientMessage,
  type HealthResponse,
  type ServerMessage,
  type StageSummary,
} from '@gtd/protocol';
import { WebSocketServer, type WebSocket } from 'ws';
import type { SaveManager } from './saveManager';

export interface GameServerOptions {
  version: string;
  stages: StagePack[];
  saves: SaveManager;
  /** Built client to serve; omitted in dev mode, where Vite serves the client. */
  clientDir?: string;
  /** Show developer-only stage packs (dev mode and tests). */
  showDevStages?: boolean;
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

export function createGameServer(options: GameServerOptions): Server {
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
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'notFound' });

    if (options.clientDir && (req.method === 'GET' || req.method === 'HEAD')) {
      return serveStatic(options.clientDir, url.pathname, res);
    }
    sendJson(res, 404, { error: 'notFound' });
  }

  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY_BYTES });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== WEBSOCKET_PATH) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => handleSocket(ws));
  });
  server.on('close', () => sockets.close());

  function handleSocket(ws: WebSocket): void {
    const send = (message: ServerMessage) => ws.send(JSON.stringify(message));
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
async function serveStatic(clientDir: string, pathname: string, res: ServerResponse): Promise<void> {
  const root = resolve(clientDir);
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
    if (info?.isDirectory() || !extname(decoded)) file = join(root, 'index.html');
    else return sendJson(res, 404, { error: 'notFound' });
    if (!(await stat(file).catch(() => null))) return sendJson(res, 503, { error: 'clientNotBuilt' });
  }
  const isHtml = file.endsWith('.html');
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    // Hashed asset names can be cached forever; the page itself must always be fresh.
    'cache-control': isHtml ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  createReadStream(file).pipe(res);
}
