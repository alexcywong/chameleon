import { useNavigate } from 'react-router-dom';
import useGameStore from '../stores/gameStore';
import { useGameSync } from '../hooks/useGameSync';
import ScoreBoard from '../components/ScoreBoard';
import './Results.css';

export default function Results() {
  const navigate = useNavigate();
  const { game } = useGameStore();
  const playerList = game ? Object.values(game.players) : [];
  const reset = useGameStore((s) => s.reset);

  useGameSync();

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

  function handlePlayAgain() {
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
          <button
            className="btn btn-primary btn-lg"
            onClick={handlePlayAgain}
            id="btn-play-again"
          >
            🎮 Play Again
          </button>
        </div>
      </div>
    </div>
  );
}
