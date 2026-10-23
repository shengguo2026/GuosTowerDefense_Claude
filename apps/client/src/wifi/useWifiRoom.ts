import type { Difficulty } from '@gtd/ai';
import type { ClientMessage, RoomErrorCode, RoomState, SlotId } from '@gtd/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ServerConnection } from '../useServerConnection';

/** The room this device is in and its session token, kept so a reload or a dropped connection finds the way back. */
const SESSION_KEY = 'gtd.wifi.session';
/** A tablet's or phone's own name for Wi-Fi play (the PC's name is in the save on the PC). */
const NAME_KEY = 'gtd.wifi.name';

interface Session {
  code: string;
  token: string;
}

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const session = raw ? (JSON.parse(raw) as Partial<Session>) : null;
    return typeof session?.code === 'string' && typeof session.token === 'string'
      ? { code: session.code, token: session.token }
      : null;
  } catch {
    return null;
  }
}

function writeSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Private browsing: the room still works, only a reload loses the way back.
  }
}

export function readGuestName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeGuestName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Not kept: the name is asked again next time.
  }
}

export interface WifiRoom {
  room: RoomState | null;
  playerId: string | null;
  /** This device hosts the room. */
  host: boolean;
  /** The last thing the server refused, or why the room ended. */
  error: RoomErrorCode | 'closed' | null;
  /** Coming back into a room after a reload or a dropped connection. */
  rejoining: boolean;
  hostRoom(name: string): void;
  join(code: string, name: string): void;
  /** Asks the server for the room again (and re-seats this device in a running match). */
  resync(): void;
  leave(): void;
  settings(stageId: string, levelId: string, difficulty: Difficulty): void;
  slotController(slotId: SlotId, controller: 'human' | 'ai'): void;
  swap(): void;
  takeSlot(slotId: SlotId): void;
  choose(choice: { slotId?: SlotId; name?: string; profileId?: string }): void;
  ready(ready: boolean): void;
  start(): void;
  toLobby(): void;
  clearError(): void;
}

/**
 * Wi-Fi play from this device (spec §14): the room it hosts or joined, kept up to date by the server. The session token
 * is stored on the device, so after a reload or a dropped connection the device asks to come back, and the server hands
 * its side back from the computer.
 */
export function useWifiRoom(connection: ServerConnection): WifiRoom {
  const { send, subscribe, status } = connection;
  const [room, setRoom] = useState<RoomState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [host, setHost] = useState(false);
  const [error, setError] = useState<WifiRoom['error']>(null);
  const [rejoining, setRejoining] = useState(() => readSession() !== null);
  const session = useRef<Session | null>(readSession());
  const rejoiningRef = useRef(rejoining);
  rejoiningRef.current = rejoining;
  /** This page showed the room (a stale session from an earlier visit is forgotten without a word). */
  const wasInRoom = useRef(false);

  useEffect(
    () =>
      subscribe((message) => {
        switch (message.type) {
          case 'roomJoined':
            session.current = { code: message.code, token: message.token };
            writeSession(session.current);
            setPlayerId(message.playerId);
            setRejoining(false);
            return;
          case 'room':
            wasInRoom.current = true;
            setRoom(message.room);
            setPlayerId(message.playerId);
            setHost(message.host);
            return;
          case 'roomClosed':
            session.current = null;
            writeSession(null);
            setRoom(null);
            setHost(false);
            setRejoining(false);
            wasInRoom.current = false;
            setError(message.reason === 'closed' ? 'closed' : null);
            return;
          case 'roomError':
            // The room this device was in is gone (the PC restarted the game): forget it.
            if (message.code === 'roomNotFound' || message.code === 'badToken') {
              if (rejoiningRef.current) {
                session.current = null;
                writeSession(null);
                setRoom(null);
                setRejoining(false);
                setError(wasInRoom.current ? 'closed' : null);
                wasInRoom.current = false;
                return;
              }
            }
            setError(message.code);
            return;
          default:
            return;
        }
      }),
    [subscribe],
  );
  /** A join or host asked for before the connection was up (a QR code opens the page and joins at once). */
  const pending = useRef<ClientMessage | null>(null);
  const sendOrQueue = useCallback(
    (message: ClientMessage) => {
      if (!send(message)) pending.current = message;
    },
    [send],
  );

  // After every (re)connection, a device that was in a room asks to come back, or sends what waited for it.
  useEffect(() => {
    if (status !== 'connected') return;
    const waiting = pending.current;
    pending.current = null;
    if (session.current) {
      setRejoining(true);
      rejoiningRef.current = true;
      send({ type: 'rejoinRoom', ...session.current });
    } else if (waiting) send(waiting);
  }, [status, send]);

  const resync = useCallback(() => {
    if (session.current) send({ type: 'rejoinRoom', ...session.current });
  }, [send]);

  const join = useCallback(
    (code: string, name: string) => {
      setError(null);
      // This device was in that room before: come back with the token instead of joining as someone new.
      if (session.current?.code === code) {
        setRejoining(true);
        rejoiningRef.current = true;
        sendOrQueue({ type: 'rejoinRoom', ...session.current });
      } else sendOrQueue({ type: 'joinRoom', code, name });
    },
    [sendOrQueue],
  );

  const leave = useCallback(() => {
    send({ type: 'leaveRoom' });
    setRejoining(false);
    rejoiningRef.current = false;
    pending.current = null;
    wasInRoom.current = false;
    session.current = null;
    writeSession(null);
    setRoom(null);
    setHost(false);
  }, [send]);

  return {
    room,
    playerId,
    host,
    error,
    rejoining,
    hostRoom: useCallback(
      (name: string) => {
        setError(null);
        sendOrQueue({ type: 'hostRoom', name });
      },
      [sendOrQueue],
    ),
    join,
    resync,
    leave,
    settings: useCallback(
      (stageId: string, levelId: string, difficulty: Difficulty) =>
        void send({ type: 'roomSettings', stageId, levelId, difficulty }),
      [send],
    ),
    slotController: useCallback(
      (slotId: SlotId, controller: 'human' | 'ai') =>
        void send({ type: 'roomSlotController', slotId, controller }),
      [send],
    ),
    swap: useCallback(() => void send({ type: 'roomSwap' }), [send]),
    takeSlot: useCallback((slotId: SlotId) => void send({ type: 'roomTakeSlot', slotId }), [send]),
    choose: useCallback(
      (choice: { slotId?: SlotId; name?: string; profileId?: string }) =>
        void send({ type: 'roomChoose', ...choice }),
      [send],
    ),
    ready: useCallback((value: boolean) => void send({ type: 'roomReady', ready: value }), [send]),
    start: useCallback(() => void send({ type: 'roomStart' }), [send]),
    toLobby: useCallback(() => void send({ type: 'roomLobby' }), [send]),
    clearError: useCallback(() => setError(null), []),
  };
}
