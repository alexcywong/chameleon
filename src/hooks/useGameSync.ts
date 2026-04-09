import { useEffect, useRef } from 'react';
import { subscribeToGame } from '../gameApi';
import useGameStore from '../stores/gameStore';

/**
 * Hook to subscribe to game state and keep Zustand in sync.
 * Works with both Firebase and local provider.
 */
export function useGameSync() {
  const gameId = useGameStore((s) => s.gameId);
  const setGame = useGameStore((s) => s.setGame);
  const setConnected = useGameStore((s) => s.setConnected);
  const subscribedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!gameId) return;
    // Prevent double-subscribing to the same game
    if (subscribedRef.current === gameId) return;
    subscribedRef.current = gameId;

    setConnected(true);

    const unsubscribe = subscribeToGame(gameId, (gameState) => {
      setGame(gameState);
    });

    return () => {
      subscribedRef.current = null;
      unsubscribe();
      setConnected(false);
    };
  }, [gameId, setGame, setConnected]);
}
