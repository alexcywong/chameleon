import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useGameStore from '../stores/gameStore';
import { useGameSync } from '../hooks/useGameSync';
import { updateGame } from '../gameApi';
import ScoreBoard from '../components/ScoreBoard';
import './Results.css';

export default function Results() {
  const navigate = useNavigate();
  const { game, gameId, playerId } = useGameStore();
  const playerList = game ? Object.values(game.players) : [];
  const reset = useGameStore((s) => s.reset);
  const isHost = game?.hostId === playerId;

  useGameSync();

  // When the game resets to LOBBY (host clicked Play Again), redirect everyone to lobby
  useEffect(() => {
    if (game?.phase === 'LOBBY' && gameId) {
      navigate(`/lobby/${gameId}`);
    }
  }, [game?.phase, gameId, navigate]);

  if (!game) {
    return (
      <div className="page page-center">
        <div className="app-bg" />
        <div className="spinner" style={{ width: 40, height: 40 }} />
      </div>
    );
  }

  const sorted = [...playerList].sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  const wittyMessages = [
    `${winner?.name} absolutely crushed it! 🎉`,
    `All hail ${winner?.name}, the Chameleon hunter! 👑`,
    `${winner?.name} saw through every disguise! 🔍`,
    `${winner?.name} blended in AND stood out! 🦎`,
  ];
  const winMessage = wittyMessages[Math.floor(Math.random() * wittyMessages.length)];

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
        chameleonId: '',
        codeCardSetIndex: 0,
        turnOrder: [],
        currentTurnIndex: 0,
        chameleonGuess: '',
        roundHistory: [],
        players: resetPlayers,
      });
      // The useEffect above will navigate to /lobby/ when phase becomes LOBBY
    } else {
      // Non-host: just go home
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
            players={playerList}
            roundHistory={game.roundHistory || []}
            showFinal={true}
          />
        </div>

        <div className="text-center fade-in fade-in-delay-3">
          {isHost ? (
            <button
              className="btn btn-primary btn-lg"
              onClick={handlePlayAgain}
              id="btn-play-again"
            >
              🔄 Play Again with Everyone
            </button>
          ) : (
            <div className="results-waiting">
              <div className="status-bar">
                <span className="pulse">●</span>
                Waiting for host to start a new game...
              </div>
            </div>
          )}

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
