/**
 * Unified game API — uses WebSocket in production, local provider for tests/dev.
 *
 * Set VITE_USE_LOCAL=true for local-only mode (bots, no server required).
 * Otherwise connects to the WebSocket server automatically.
 */

import type { GameState } from './types/game';

// Use local mode if explicitly set, or if running Playwright tests
const useLocal = import.meta.env.VITE_USE_LOCAL === 'true' ||
  typeof (globalThis as Record<string, unknown>).__PLAYWRIGHT__ !== 'undefined';

let api: {
  createGame: (gameId: string, state: GameState) => Promise<void>;
  getGame: (gameId: string) => Promise<GameState | null>;
  subscribeToGame: (gameId: string, callback: (state: GameState | null) => void) => () => void;
  updateGame: (gameId: string, updates: Partial<GameState>) => Promise<void>;
  updatePlayer: (gameId: string, playerId: string, updates: Record<string, unknown>) => Promise<void>;
  deleteGame: (gameId: string) => Promise<void>;
};

if (useLocal) {
  const local = await import('./localProvider');
  api = {
    createGame: local.createGameLocal,
    getGame: local.getGameLocal,
    subscribeToGame: local.subscribeToGameLocal,
    updateGame: local.updateGameLocal,
    updatePlayer: local.updatePlayerLocal,
    deleteGame: local.deleteGameLocal,
  };
  console.log('💻 Running in LOCAL mode (in-memory state)');
} else {
  const ws = await import('./wsProvider');
  api = {
    createGame: ws.createGameWs,
    getGame: ws.getGameWs,
    subscribeToGame: ws.subscribeToGameWs,
    updateGame: ws.updateGameWs,
    updatePlayer: ws.updatePlayerWs,
    deleteGame: ws.deleteGameWs,
  };
  console.log('🔌 Connected to WebSocket server');
}

export const {
  createGame,
  getGame,
  subscribeToGame,
  updateGame,
  updatePlayer,
  deleteGame,
} = api;

export const isLocalMode = useLocal;
