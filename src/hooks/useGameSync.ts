import { useEffect, useRef } from 'react';
import { subscribeToGame, onConnectionChange } from '../gameApi';
import useGameStore from '../stores/gameStore';

/**
 * Hook to subscribe to game state and keep Zustand in sync.
 * Works with both Firebase and local provider.
 * Also tracks WebSocket connection state for reconnection UI.
 */
export function useGameSync() {
  const gameId = useGameStore((s) => s.gameId);
  const setGame = useGameStore((s) => s.setGame);
  const setConnected = useGameStore((s) => s.setConnected);
  const setReconnecting = useGameStore((s) => s.setReconnecting);
  const subscribedRef = useRef<string | null>(null);

  // Subscribe to game state updates
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

  // Track WebSocket connection state
  useEffect(() => {
    if (!onConnectionChange) return;
    const unsubscribe = onConnectionChange((state) => {
      setConnected(state === 'connected');
      setReconnecting(state === 'reconnecting');
    });
    return unsubscribe;
  }, [setConnected, setReconnecting]);
}
