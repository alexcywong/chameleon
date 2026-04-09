import type { RoundResult, Player } from '../types/game';
import './ScoreBoard.css';

interface ScoreBoardProps {
  players: Player[];
  roundHistory: RoundResult[];
  showFinal?: boolean;
}

export default function ScoreBoard({ players, roundHistory, showFinal = false }: ScoreBoardProps) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const topScore = sorted[0]?.score || 0;

  return (
    <div className="scoreboard fade-in">
      <h3 className="title-md text-center mb-md">
        {showFinal ? '🏆 Final Scores' : '📊 Scoreboard'}
      </h3>

      <div className="scoreboard-list">
        {sorted.map((player, i) => {
          const isWinner = showFinal && player.score === topScore;
          return (
            <div
              key={player.id}
              className={`scoreboard-item ${isWinner ? 'is-winner' : ''}`}
              style={{ animationDelay: `${i * 0.08}s` }}
            >
              <span className="scoreboard-rank">
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}
              </span>
              <span className="scoreboard-name">{player.name}</span>
              <div className="scoreboard-bar-wrapper">
                <div
                  className="scoreboard-bar"
                  style={{ width: topScore > 0 ? `${(player.score / topScore) * 100}%` : '0%' }}
                />
              </div>
              <span className="scoreboard-score">{player.score}</span>
            </div>
          );
        })}
      </div>

      {roundHistory.length > 0 && (
        <div className="round-history mt-lg">
          <span className="label mb-sm" style={{ display: 'block' }}>Round History</span>
          {roundHistory.map((round) => (
            <div key={round.round} className="round-history-item">
              <span className="round-number">R{round.round}</span>
              <span className="round-topic">{round.topic}</span>
              <span className="round-word">"{round.secretWord}"</span>
              <span className={`round-result ${round.chameleonCaught ? 'caught' : 'escaped'}`}>
                {round.chameleonCaught
                  ? round.chameleonGuessedCorrectly
                    ? '🦎 Guessed!'
                    : '🎯 Caught!'
                  : '💨 Escaped!'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
