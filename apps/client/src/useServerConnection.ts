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
    const clientId = crypto.randomUUID();

    const connect = () => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${location.host}${WEBSOCKET_PATH}`);
      socketRef.current = socket;
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, clientId }));
      });
      socket.addEventListener('message', (event) => {
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
      socket.addEventListener('close', () => {
        if (stopped) return;
        setState((previous) => ({ ...previous, status: 'disconnected' }));
        const delay = RETRY_DELAYS_MS[Math.min(attempts++, RETRY_DELAYS_MS.length - 1)];
        retryTimer = window.setTimeout(connect, delay);
      });
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retryTimer);
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
