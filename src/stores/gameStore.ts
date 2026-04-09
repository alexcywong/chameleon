import { create } from 'zustand';
import type { GameState, GamePhase, Player } from '../types/game';

// Session persistence helpers — use localStorage so state survives tab close + refresh
const SESSION_KEY = 'chameleon_session';

function saveSession(gameId: string | null, playerId: string | null, playerName: string) {
  if (gameId && playerId) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ gameId, playerId, playerName }));
  }
}

function loadSession(): { gameId: string | null; playerId: string | null; playerName: string } {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { gameId: null, playerId: null, playerName: '' };
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

const saved = loadSession();

interface GameStore {
  // Connection state
  gameId: string | null;
  playerId: string | null;
  playerName: string;
  isConnected: boolean;

  // Game state (synced with server)
  game: GameState | null;

  // Local UI state
  error: string | null;
  isLoading: boolean;

  // Actions
  setGameId: (gameId: string | null) => void;
  setPlayerId: (playerId: string | null) => void;
  setPlayerName: (name: string) => void;
  setGame: (game: GameState | null) => void;
  setConnected: (connected: boolean) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;

  // Computed helpers
  isHost: () => boolean;
  isChameleon: () => boolean;
  currentPlayer: () => Player | null;
  currentPhase: () => GamePhase | null;
  playerList: () => Player[];
  isMyTurn: () => boolean;
}

const useGameStore = create<GameStore>((set, get) => ({
  gameId: saved.gameId,
  playerId: saved.playerId,
  playerName: saved.playerName,
  isConnected: false,
  game: null,
  error: null,
  isLoading: false,

  setGameId: (gameId) => {
    set({ gameId });
    const s = get();
    saveSession(gameId, s.playerId, s.playerName);
  },
  setPlayerId: (playerId) => {
    set({ playerId });
    const s = get();
    saveSession(s.gameId, playerId, s.playerName);
  },
  setPlayerName: (name) => {
    set({ playerName: name });
    const s = get();
    saveSession(s.gameId, s.playerId, name);
  },
  setGame: (game) => set({ game }),
  setConnected: (connected) => set({ isConnected: connected }),
  setError: (error) => set({ error }),
  setLoading: (loading) => set({ isLoading: loading }),
  reset: () => {
    clearSession();
    set({
      gameId: null,
      playerId: null,
      playerName: '',
      isConnected: false,
      game: null,
      error: null,
      isLoading: false,
    });
  },

  isHost: () => {
    const { game, playerId } = get();
    return game?.hostId === playerId;
  },

  isChameleon: () => {
    const { game, playerId } = get();
    return game?.chameleonId === playerId;
  },

  currentPlayer: () => {
    const { game, playerId } = get();
    if (!game || !playerId) return null;
    return game.players[playerId] || null;
  },

  currentPhase: () => {
    const { game } = get();
    return game?.phase || null;
  },

  playerList: () => {
    const { game } = get();
    if (!game) return [];
    return Object.values(game.players);
  },

  isMyTurn: () => {
    const { game, playerId } = get();
    if (!game || !playerId || game.phase !== 'CLUE_GIVING') return false;
    const currentTurnPlayerId = game.turnOrder[game.currentTurnIndex];
    return currentTurnPlayerId === playerId;
  },
}));

export default useGameStore;
