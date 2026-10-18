import { PROTOCOL_VERSION, WEBSOCKET_PATH, type ServerMessage, type StageSummary } from '@gtd/protocol';
import { useEffect, useState } from 'react';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface ServerConnection {
  status: ConnectionStatus;
  serverVersion: string | null;
  stages: StageSummary[];
  error: string | null;
}

const RETRY_DELAYS_MS = [500, 1000, 2000, 4000];

/** Keeps a WebSocket to the game server open, reconnecting with a growing delay after a drop. */
export function useServerConnection(): ServerConnection {
  const [state, setState] = useState<ServerConnection>({
    status: 'connecting',
    serverVersion: null,
    stages: [],
    error: null,
  });

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let attempts = 0;
    let stopped = false;
    const clientId = crypto.randomUUID();

    const connect = () => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${location.host}${WEBSOCKET_PATH}`);
      socket.addEventListener('open', () => {
        socket?.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, clientId }));
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
      socket?.close();
    };
  }, []);

  return state;
}
