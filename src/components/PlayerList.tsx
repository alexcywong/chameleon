import type { Player } from '../types/game';
import './PlayerList.css';

const AVATAR_COLORS = [
  'linear-gradient(135deg, #10b981, #34d399)',
  'linear-gradient(135deg, #a855f7, #c084fc)',
  'linear-gradient(135deg, #f59e0b, #fbbf24)',
  'linear-gradient(135deg, #3b82f6, #60a5fa)',
  'linear-gradient(135deg, #ef4444, #f87171)',
  'linear-gradient(135deg, #ec4899, #f472b6)',
  'linear-gradient(135deg, #14b8a6, #2dd4bf)',
  'linear-gradient(135deg, #f97316, #fb923c)',
  'linear-gradient(135deg, #8b5cf6, #a78bfa)',
  'linear-gradient(135deg, #06b6d4, #22d3ee)',
];

interface PlayerListProps {
  players: Player[];
  currentPlayerId?: string;
  currentTurnId?: string;
  showScores?: boolean;
  votable?: boolean;
  votedId?: string;
  onVote?: (playerId: string) => void;
  voteCounts?: Record<string, number>;
  showVoteCounts?: boolean;
  showVoteCheck?: boolean; // When true, ✓ means voted; when false, ✓ means clue submitted
  hideCheck?: boolean;     // When true, suppress all checkmarks entirely
}

export default function PlayerList({
  players,
  currentPlayerId,
  currentTurnId,
  showScores = false,
  votable = false,
  votedId,
  onVote,
  voteCounts,
  showVoteCounts = false,
  showVoteCheck = false,
  hideCheck = false,
}: PlayerListProps) {
  const compact = players.length > 6;

  return (
    <div className={`player-list ${compact ? 'player-list-compact' : ''}`}>
      {players.map((player, i) => {
        const isMe = player.id === currentPlayerId;
        const isCurrentTurn = player.id === currentTurnId;
        const isVoted = player.id === votedId;
        const canVote = votable && !isMe;

        return (
          <div
            key={player.id}
            className={`player-item ${isCurrentTurn ? 'is-active' : ''} ${
              canVote ? 'is-votable votable' : ''
            } ${isVoted ? 'is-voted-player' : ''}`}
            onClick={() => canVote && onVote?.(player.id)}
            data-player-id={player.id}
          >
            <div
              className={`player-avatar ${compact ? 'player-avatar-sm' : ''}`}
              style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
            >
              {player.name.charAt(0).toUpperCase()}
            </div>
            <span className="player-name">
              {player.name}
              {isMe && <span className="player-you-tag"> (you)</span>}
              {player.isHost && <span className="player-host-tag"> 👑</span>}
            </span>
            {!hideCheck && (showVoteCheck ? player.vote !== '' : player.hasSubmitted) && (
              <span className="player-check">✓</span>
            )}
            {showScores && (
              <span className="player-score">{player.score}</span>
            )}
            {showVoteCounts && voteCounts && (
              <span className="vote-count">
                {voteCounts[player.id] || 0}
              </span>
            )}
            {isCurrentTurn && (
              <span className="player-turn-indicator pulse">●</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
