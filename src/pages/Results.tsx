import { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import useGameStore, { loadCachedRoundHistory } from '../stores/gameStore';
import { useGameSync } from '../hooks/useGameSync';
import { updateGame, getGame as fetchGame } from '../gameApi';
import ScoreBoard from '../components/ScoreBoard';
import type { Player, RoundResult } from '../types/game';
import './Results.css';

export default function Results() {
  const navigate = useNavigate();
  const { game, gameId, playerId, isReconnecting } = useGameStore();
  const playerList = game ? Object.values(game.players) : [];
  const reset = useGameStore((s) => s.reset);
  const setGame = useGameStore((s) => s.setGame);
  const isHost = game?.hostId === playerId;

  // Fallback state: if game is null, try to recover from cache or fetch
  const [fallbackData, setFallbackData] = useState<{ roundHistory: RoundResult[]; players: Record<string, Player> } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const retryAttempted = useRef(false);

  useGameSync();

  // When the game resets to LOBBY (host clicked Play Again), redirect everyone to lobby
  useEffect(() => {
    if (game?.phase === 'LOBBY' && gameId) {
      navigate(`/lobby/${gameId}`);
    }
  }, [game?.phase, gameId, navigate]);

  // If game is null, attempt recovery: fetch from server + fallback to localStorage cache
  useEffect(() => {
    if (game !== null || !gameId || retryAttempted.current) return;
    retryAttempted.current = true;

    // 1. Try fetching from server
    fetchGame(gameId).then((fetched) => {
      if (fetched) {
        setGame(fetched);
        return;
      }
      // 2. Fall back to localStorage cache
      const cached = loadCachedRoundHistory(gameId);
      if (cached) {
        console.log('📦 Using cached round history for results display');
        setFallbackData(cached);
      } else {
        // 3. Nothing available — show error after a delay
        setTimeout(() => setLoadError(true), 3000);
      }
    }).catch(() => {
      const cached = loadCachedRoundHistory(gameId);
      if (cached) setFallbackData(cached);
      else setTimeout(() => setLoadError(true), 3000);
    });
  }, [game, gameId, setGame]);

  // Determine what data to display
  const displayPlayers = game ? playerList : fallbackData ? Object.values(fallbackData.players) : [];
  const displayRoundHistory = game?.roundHistory || fallbackData?.roundHistory || [];
  const hasData = displayPlayers.length > 0 && displayRoundHistory.length > 0;
  const winnerName = hasData
    ? [...displayPlayers].sort((a, b) => b.score - a.score)[0]?.name ?? ''
    : '';

  const winMessage = useMemo(() => {
    if (!winnerName) return '';
    const wittyMessages = [
      `${winnerName} absolutely crushed it! 🎉`,
      `All hail ${winnerName}, the Kiwi hunter! 👑`,
      `${winnerName} saw through every disguise! 🔍`,
      `${winnerName} blended in AND stood out! 🥝`,
    ];
    let hash = 0;
    for (let i = 0; i < winnerName.length; i++) {
      hash = ((hash << 5) - hash + winnerName.charCodeAt(i)) | 0;
    }
    return wittyMessages[Math.abs(hash) % wittyMessages.length];
  }, [winnerName]);

  if (!hasData) {
    if (loadError) {
      return (
        <div className="page page-center">
          <div className="app-bg" />
          <div className="container container-narrow text-center">
            <div className="mb-lg fade-in">
              <img src="/images/kiwi-sweat.png" alt="Disconnected" className="kiwi-icon" style={{ width: '64px', height: '64px', borderRadius: '50%', objectFit: 'cover' }} />
              <h1 className="title-lg mb-sm">Connection Lost</h1>
              <p className="subtitle">
                The game session could not be recovered. This can happen if the game was ended or you were disconnected for too long.
              </p>
            </div>
            <button className="btn btn-primary btn-lg" onClick={() => { reset(); navigate('/'); }}>
              🏠 Return Home
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="page page-center">
        <div className="app-bg" />
        <div className="reconnection-overlay fade-in">
          <div className="spinner" style={{ width: 40, height: 40 }} />
          <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>
            {isReconnecting ? 'Reconnecting to game...' : 'Loading results...'}
          </p>
        </div>
      </div>
    );
  }

  async function handlePlayAgain() {
    if (!gameId || !game) return;

    if (isHost) {
      // Reset all players: keep name/id/isHost, zero everything else
      const resetPlayers: Record<string, typeof game.players[string]> = {};
      for (const [id, player] of Object.entries(game.players)) {
        resetPlayers[id] = {
          ...player,
          score: 0,
          clue: '',
          vote: '',
          hasSubmitted: false,
        };
      }

      // Send the game back to LOBBY with reset state
      await updateGame(gameId, {
        phase: 'LOBBY',
        currentRound: 0,
        topicIndex: 0,
        secretWordIndex: 0,
        diceYellow: 0,
        diceBlue: 0,
        kiwiId: '',
        codeCardSetIndex: 0,
        turnOrder: [],
        currentTurnIndex: 0,
        kiwiGuess: '',
        roundHistory: [],
        players: resetPlayers,
      });
      // Navigate immediately — don't wait for state sync round-trip
      navigate(`/lobby/${gameId}`);
    } else {
      // Non-host: just go home (host will trigger lobby redirect via state sync)
      reset();
      navigate('/');
    }
  }

  function handleLeaveGame() {
    reset();
    navigate('/');
  }

  return (
    <div className="page page-center">
      <div className="app-bg" />

      <div className="container container-narrow">
        <div className="text-center mb-xl fade-in">
          <div className="results-trophy">🏆</div>
          <h1 className="title-xl mb-sm">Game Over!</h1>
          <p className="subtitle">{winMessage}</p>
        </div>

        <div className="card mb-lg fade-in fade-in-delay-1">
          <ScoreBoard
            players={displayPlayers}
            roundHistory={displayRoundHistory}
            showFinal={true}
          />
        </div>

        <div className="text-center fade-in fade-in-delay-3">
          {isHost && game ? (
            <button
              className="btn btn-primary btn-lg"
              onClick={handlePlayAgain}
              id="btn-play-again"
            >
              🔄 Play Again with Everyone
            </button>
          ) : game ? (
            <div className="results-waiting">
              <div className="status-bar">
                <span className="pulse">●</span>
                Waiting for host to start a new game...
              </div>
            </div>
          ) : null}

          <button
            className="btn btn-outline btn-lg mt-md"
            onClick={handleLeaveGame}
            id="btn-leave-game"
            style={{ marginTop: '1rem' }}
          >
            🏠 Leave Game
          </button>
        </div>
      </div>
    </div>
  );
}
