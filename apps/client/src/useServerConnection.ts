import {
  PROTOCOL_VERSION,
  WEBSOCKET_PATH,
  type ClientMessage,
  type ServerMessage,
  type StageSummary,
} from '@gtd/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

type Listener = (message: ServerMessage) => void;

export interface ServerConnection {
  status: ConnectionStatus;
  serverVersion: string | null;
  stages: StageSummary[];
  error: string | null;
  /** Sends a message when connected; returns false while offline. */
  send(message: ClientMessage): boolean;
  /** Receives every server message (match snapshots go here rather than into React state). */
  subscribe(listener: Listener): () => void;
}

const RETRY_DELAYS_MS = [500, 1000, 2000, 4000];
/** The client asks the server this often whether it is still there... */
const PING_MS = 3000;
/** ...and gives up on a connection that said nothing for this long (the PC left the Wi-Fi, the phone slept). */
const SILENT_MS = 10_000;

/**
 * `crypto.randomUUID` only exists on secure pages (https or localhost); phones and tablets open the game over plain
 * http on the PC's Wi-Fi address, so fall back to `getRandomValues`, which works everywhere.
 */
function newClientId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
}

/** Keeps a WebSocket to the game server open, reconnecting with a growing delay after a drop. */
export function useServerConnection(): ServerConnection {
  const [state, setState] = useState({
    status: 'connecting' as ConnectionStatus,
    serverVersion: null as string | null,
    stages: [] as StageSummary[],
    error: null as string | null,
  });
  const socketRef = useRef<WebSocket | null>(null);
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    let retryTimer: number | undefined;
    let attempts = 0;
    let stopped = false;
    const clientId = newClientId();

    let watchdog: number | undefined;

    const connect = () => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${location.host}${WEBSOCKET_PATH}`);
      socketRef.current = socket;
      let lastHeard = performance.now();
      let closed = false;
      // A connection can die without a close (Wi-Fi gone): the browser would wait minutes, so give up on it sooner.
      const dropped = () => {
        if (closed) return;
        closed = true;
        window.clearInterval(watchdog);
        if (socketRef.current === socket) socketRef.current = null;
        socket.close();
        if (stopped) return;
        setState((previous) => ({ ...previous, status: 'disconnected' }));
        const delay = RETRY_DELAYS_MS[Math.min(attempts++, RETRY_DELAYS_MS.length - 1)];
        retryTimer = window.setTimeout(connect, delay);
      };
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, clientId }));
        lastHeard = performance.now();
        window.clearInterval(watchdog);
        let lastCheck = performance.now();
        watchdog = window.setInterval(() => {
          const now = performance.now();
          // A late check means this page was busy (building the 3D view) or asleep, not that the server went quiet:
          // messages that arrived meanwhile wait behind the check, so count the silence from now.
          if (now - lastCheck > PING_MS * 2) lastHeard = now;
          lastCheck = now;
          if (now - lastHeard > SILENT_MS) return dropped();
          if (socket.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify({ type: 'ping', sentAt: Date.now() }));
        }, PING_MS);
      });
      socket.addEventListener('message', (event) => {
        lastHeard = performance.now();
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (message.type === 'welcome') {
          attempts = 0;
          setState({
            status: 'connected',
            serverVersion: message.serverVersion,
            stages: message.stages,
            error: null,
          });
        } else if (message.type === 'error') {
          setState((previous) => ({ ...previous, error: message.message }));
        }
        listeners.current.forEach((listener) => listener(message));
      });
      socket.addEventListener('close', dropped);
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retryTimer);
      window.clearInterval(watchdog);
      socketRef.current?.close();
    };
  }, []);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  return { ...state, send, subscribe };
}
