/**
 * Unified game API — uses WebSocket in production, local provider for tests/dev.
 *
 * Set VITE_USE_LOCAL=true for local-only mode (bots, no server required).
 * If no WebSocket server is reachable, automatically falls back to local mode.
 */

import type { GameState } from './types/game';

type GameApi = {
  createGame: (gameId: string, state: GameState) => Promise<void>;
  getGame: (gameId: string) => Promise<GameState | null>;
  subscribeToGame: (gameId: string, callback: (state: GameState | null) => void) => () => void;
  updateGame: (gameId: string, updates: Partial<GameState>) => Promise<void>;
  updatePlayer: (gameId: string, playerId: string, updates: Record<string, unknown>) => Promise<void>;
  deleteGame: (gameId: string) => Promise<void>;
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
  };
}

let api: GameApi;
let _isLocalMode: boolean;

if (forceLocal) {
  api = await loadLocalApi();
  _isLocalMode = true;
  console.log('💻 Running in LOCAL mode (in-memory state)');
} else {
  // Try WebSocket — if it fails (e.g. static hosting), fall back to local
  try {
    const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
    const testWs = new WebSocket(wsUrl);
    const connected = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => { testWs.close(); resolve(false); }, 2000);
      testWs.onopen = () => { clearTimeout(timeout); testWs.close(); resolve(true); };
      testWs.onerror = () => { clearTimeout(timeout); resolve(false); };
    });

    if (connected) {
      api = await loadWsApi();
      _isLocalMode = false;
      console.log('🔌 Connected to WebSocket server');
    } else {
      api = await loadLocalApi();
      _isLocalMode = true;
      console.log('💻 No WebSocket server found — using LOCAL mode');
    }
  } catch {
    api = await loadLocalApi();
    _isLocalMode = true;
    console.log('💻 WebSocket unavailable — using LOCAL mode');
  }
}

export const {
  createGame,
  getGame,
  subscribeToGame,
  updateGame,
  updatePlayer,
  deleteGame,
} = api;

export const isLocalMode = _isLocalMode;
