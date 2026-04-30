/**
 * WebSocket game provider — real-time multiplayer via WebSocket server.
 * Same API surface as localProvider but syncs through the server.
 */
import type { GameState } from './types/game';

type Callback = (state: GameState | null) => void;

let ws: WebSocket | null = null;
const gameCallbacks = new Map<string, Set<Callback>>();
const pendingMessages: string[] = [];

function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 10000;

function connect() {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

  ws = new WebSocket(getWsUrl());

  ws.onopen = () => {
    console.log('🔌 WebSocket connected');
    reconnectDelay = 1000; // Reset backoff on success
    // Flush pending messages
    while (pendingMessages.length > 0) {
      ws!.send(pendingMessages.shift()!);
    }
    // Re-subscribe to all games
    for (const gameId of gameCallbacks.keys()) {
      ws!.send(JSON.stringify({ type: 'SUBSCRIBE', gameId }));
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'GAME_STATE' && msg.gameId) {
        const cbs = gameCallbacks.get(msg.gameId);
        if (cbs) {
          cbs.forEach((cb) => cb(msg.state));
        }
      }
    } catch { /* ignore parse errors */ }
  };

  ws.onclose = () => {
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
