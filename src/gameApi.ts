/**
 * Unified game API — uses WebSocket in production, local provider for tests/dev.
 *
 * Set VITE_USE_LOCAL=true for local-only mode (bots, no server required).
 * If no WebSocket server is reachable, automatically falls back to local mode.
 */

import type { GameState } from './types/game';

type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';
type ConnectionCallback = (state: ConnectionState) => void;

type GameApi = {
  createGame: (gameId: string, state: GameState) => Promise<void>;
  getGame: (gameId: string) => Promise<GameState | null>;
  subscribeToGame: (gameId: string, callback: (state: GameState | null) => void) => () => void;
  updateGame: (gameId: string, updates: Partial<GameState>) => Promise<void>;
  updatePlayer: (gameId: string, playerId: string, updates: Record<string, unknown>) => Promise<void>;
  deleteGame: (gameId: string) => Promise<void>;
  onConnectionChange?: (cb: ConnectionCallback) => () => void;
  getConnectionState?: () => ConnectionState;
};

// Force local mode if explicitly set or running Playwright tests
const forceLocal = import.meta.env.VITE_USE_LOCAL === 'true' ||
  typeof (globalThis as Record<string, unknown>).__PLAYWRIGHT__ !== 'undefined';

async function loadLocalApi(): Promise<GameApi> {
  const local = await import('./localProvider');
  return {
    createGame: local.createGameLocal,
    getGame: local.getGameLocal,
    subscribeToGame: local.subscribeToGameLocal,
    updateGame: local.updateGameLocal,
    updatePlayer: local.updatePlayerLocal,
    deleteGame: local.deleteGameLocal,
    // Local mode is always "connected"
    onConnectionChange: (cb: ConnectionCallback) => { cb('connected'); return () => {}; },
    getConnectionState: () => 'connected' as ConnectionState,
  };
}

async function loadWsApi(): Promise<GameApi> {
  const ws = await import('./wsProvider');
  return {
    createGame: ws.createGameWs,
    getGame: ws.getGameWs,
    subscribeToGame: ws.subscribeToGameWs,
    updateGame: ws.updateGameWs,
    updatePlayer: ws.updatePlayerWs,
    deleteGame: ws.deleteGameWs,
    onConnectionChange: ws.onConnectionChange,
    getConnectionState: ws.getConnectionState,
  };
}

let api: GameApi;
let _isLocalMode: boolean;

if (forceLocal) {
  api = await loadLocalApi();
  _isLocalMode = true;
  console.log('💻 Running in LOCAL mode (in-memory state)');
} else {
  // Try WebSocket — fall back to local mode if server is unreachable.
  // Two rapid connection failures means no server (static hosting like Cloudflare Pages).
  // Cloud Run cold starts keep the socket in CONNECTING state, so they won't trigger this.
  const wsModule = await import('./wsProvider');

  const connected = await new Promise<boolean>((resolve) => {
    let resolved = false;
    let failCount = 0;

    const timeout = setTimeout(() => {
      if (!resolved) { resolved = true; unsub(); resolve(false); }
    }, 5000);

    const unsub = wsModule.onConnectionChange((state) => {
      if (resolved) return;
      if (state === 'connected') {
        resolved = true;
        clearTimeout(timeout);
        unsub();
        resolve(true);
      } else if (state === 'reconnecting') {
        failCount++;
        if (failCount >= 2) {
          resolved = true;
          clearTimeout(timeout);
          unsub();
          resolve(false);
        }
      }
    });
  });

  if (connected) {
    api = await loadWsApi();
    _isLocalMode = false;
    console.log('🔌 Connected to WebSocket server');
  } else {
    wsModule.shutdown();
    api = await loadLocalApi();
    _isLocalMode = true;
    console.log('💻 No server found — running in local mode');
  }
}

export const {
  createGame,
  getGame,
  subscribeToGame,
  updateGame,
  updatePlayer,
  deleteGame,
  onConnectionChange,
  getConnectionState,
} = api;

export const isLocalMode = _isLocalMode;
