/**
 * Local game provider — enables playing the game entirely in-memory
 * without Firebase. Used for development, testing, and demo mode.
 * 
 * IMPORTANT: We store state directly (no deep cloning on every read)
 * to avoid infinite re-render loops. Mutations go through update functions only.
 */

import type { GameState, Player } from './types/game';

type Callback = (state: GameState | null) => void;

const localGameState: Record<string, GameState> = {};
const subscribers: Record<string, Set<Callback>> = {};

function notify(gameId: string) {
  const subs = subscribers[gameId];
  if (subs) {
    const state = localGameState[gameId] || null;
    subs.forEach((cb) => cb(state));
  }
}

export async function createGameLocal(gameId: string, state: GameState) {
  localGameState[gameId] = { ...state };
  notify(gameId);
}

export async function getGameLocal(gameId: string): Promise<GameState | null> {
  return localGameState[gameId] || null;
}

export function subscribeToGameLocal(gameId: string, callback: Callback): () => void {
  if (!subscribers[gameId]) {
    subscribers[gameId] = new Set();
  }
  subscribers[gameId].add(callback);

  // Fire once with current state (use setTimeout to avoid sync re-render loop)
  const current = localGameState[gameId] || null;
  setTimeout(() => callback(current), 0);

  return () => {
    subscribers[gameId]?.delete(callback);
  };
}

export async function updateGameLocal(gameId: string, updates: Partial<GameState>) {
  const current = localGameState[gameId];
  if (!current) return;

  // Deep merge players if both exist
  if (updates.players && current.players) {
    const mergedPlayers: Record<string, Player> = {};
    // Copy existing players
    for (const [id, player] of Object.entries(current.players)) {
      mergedPlayers[id] = { ...player };
    }
    // Merge in updated players
    for (const [id, player] of Object.entries(updates.players)) {
      mergedPlayers[id] = { ...(mergedPlayers[id] || {}), ...player } as Player;
    }

    // Create new state object (new reference = triggers re-render)
    localGameState[gameId] = {
      ...current,
      ...updates,
      players: mergedPlayers,
    };
  } else {
    localGameState[gameId] = {
      ...current,
      ...updates,
    } as GameState;
  }
  notify(gameId);
}

export async function updatePlayerLocal(
  gameId: string,
  playerId: string,
  updates: Record<string, unknown>
) {
  const current = localGameState[gameId];
  if (!current?.players[playerId]) return;

  // Create new state with updated player
  const newPlayers: Record<string, Player> = {};
  for (const [id, player] of Object.entries(current.players)) {
    newPlayers[id] = { ...player };
  }
  newPlayers[playerId] = {
    ...newPlayers[playerId],
    ...updates,
  } as Player;

  localGameState[gameId] = {
    ...current,
    players: newPlayers,
  };

  notify(gameId);
}

export async function deleteGameLocal(gameId: string) {
  delete localGameState[gameId];
  notify(gameId);
}
