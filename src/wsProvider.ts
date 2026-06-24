/**
 * WebSocket game provider — real-time multiplayer via WebSocket server.
 * Same API surface as localProvider but syncs through the server.
 *
 * Includes heartbeat ping/pong to detect dead connections within ~30s,
 * and exposes reconnection state for UI feedback.
 */
import type { GameState } from './types/game';

type Callback = (state: GameState | null) => void;
type ConnectionCallback = (state: 'connected' | 'reconnecting' | 'disconnected') => void;

let ws: WebSocket | null = null;
const gameCallbacks = new Map<string, Set<Callback>>();
const pendingMessages: string[] = [];
let shuttingDown = false;

// Connection state tracking
let _connectionState: 'connected' | 'reconnecting' | 'disconnected' = 'disconnected';
const connectionListeners = new Set<ConnectionCallback>();

function setConnectionState(state: 'connected' | 'reconnecting' | 'disconnected') {
  _connectionState = state;
  connectionListeners.forEach(cb => cb(state));
}

/** Subscribe to connection state changes */
export function onConnectionChange(cb: ConnectionCallback): () => void {
  connectionListeners.add(cb);
  // Fire immediately with current state
  cb(_connectionState);
  return () => { connectionListeners.delete(cb); };
}

/** Get current connection state */
export function getConnectionState(): 'connected' | 'reconnecting' | 'disconnected' {
  return _connectionState;
}

function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 10000;

// Heartbeat: send PING every 15s, expect PONG within 5s
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let pongTimeout: ReturnType<typeof setTimeout> | null = null;

function startHeartbeat() {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'PING' }));
      // If no PONG within 5s, connection is dead
      pongTimeout = setTimeout(() => {
        console.warn('💔 No PONG received — connection dead, forcing reconnect');
        ws?.close();
      }, 5000);
    }
  }, 15000);
}

function stopHeartbeat() {
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
  if (pongTimeout) { clearTimeout(pongTimeout); pongTimeout = null; }
}

function handlePong() {
  // PONG received — connection is alive, clear the death timer
  if (pongTimeout) { clearTimeout(pongTimeout); pongTimeout = null; }
}

/** Stop all reconnection attempts and close the socket. */
export function shutdown() {
  shuttingDown = true;
  stopHeartbeat();
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    ws.close();
    ws = null;
  }
}

function connect() {
  if (shuttingDown) return;
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

  // If we previously had a connection, mark as reconnecting
  if (_connectionState === 'connected') {
    setConnectionState('reconnecting');
  }

  ws = new WebSocket(getWsUrl());

  ws.onopen = () => {
    console.log('🔌 WebSocket connected');
    reconnectDelay = 1000; // Reset backoff on success
    setConnectionState('connected');
    startHeartbeat();

    // Flush pending messages
    while (pendingMessages.length > 0) {
      ws!.send(pendingMessages.shift()!);
    }
    // Re-subscribe to all games (restores state after reconnect)
    for (const gameId of gameCallbacks.keys()) {
      ws!.send(JSON.stringify({ type: 'SUBSCRIBE', gameId }));
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      // Handle PONG heartbeat response
      if (msg.type === 'PONG') {
        handlePong();
        return;
      }
      if (msg.type === 'GAME_STATE' && msg.gameId) {
        const cbs = gameCallbacks.get(msg.gameId);
        if (cbs) {
          cbs.forEach((cb) => cb(msg.state));
        }
      }
    } catch { /* ignore parse errors */ }
  };

  ws.onclose = () => {
    stopHeartbeat();
    setConnectionState('reconnecting');
    console.log(`🔌 WebSocket disconnected, reconnecting in ${reconnectDelay / 1000}s...`);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function send(msg: object) {
  const data = JSON.stringify(msg);
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(data);
  } else {
    pendingMessages.push(data);
    connect();
  }
}

// Initialize connection
connect();

export async function createGameWs(gameId: string, state: GameState) {
  send({ type: 'CREATE_GAME', gameId, state });
}

export async function getGameWs(gameId: string): Promise<GameState | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const handler = (state: GameState | null) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve(state);
      const cbs = gameCallbacks.get(gameId);
      cbs?.delete(handler);
      if (cbs?.size === 0) gameCallbacks.delete(gameId);
    };
    // Timeout after 10s to prevent hanging
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.warn('⏱️ getGameWs timed out for', gameId);
        const cbs = gameCallbacks.get(gameId);
        cbs?.delete(handler);
        if (cbs?.size === 0) gameCallbacks.delete(gameId);
        resolve(null);
      }
    }, 10000);
    if (!gameCallbacks.has(gameId)) gameCallbacks.set(gameId, new Set());
    gameCallbacks.get(gameId)!.add(handler);
    send({ type: 'GET_GAME', gameId });
  });
}

export function subscribeToGameWs(gameId: string, callback: Callback): () => void {
  if (!gameCallbacks.has(gameId)) gameCallbacks.set(gameId, new Set());
  gameCallbacks.get(gameId)!.add(callback);
  send({ type: 'SUBSCRIBE', gameId });

  return () => {
    const cbs = gameCallbacks.get(gameId);
    cbs?.delete(callback);
    if (cbs?.size === 0) gameCallbacks.delete(gameId);
  };
}

export async function updateGameWs(gameId: string, updates: Partial<GameState>) {
  send({ type: 'UPDATE_GAME', gameId, updates });
}

export async function updatePlayerWs(
  gameId: string,
  playerId: string,
  updates: Record<string, unknown>
) {
  send({ type: 'UPDATE_PLAYER', gameId, playerId, updates });
}

export async function deleteGameWs(gameId: string) {
  send({ type: 'DELETE_GAME', gameId });
}
