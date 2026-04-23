import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import useGameStore from '../stores/gameStore';
import { useGameSync } from '../hooks/useGameSync';
import { updateGame, deleteGame, getGame as fetchGame, isLocalMode } from '../gameApi';
import { createPlayer, dealRound } from '../utils/gameLogic';
import PlayerList from '../components/PlayerList';
import './Lobby.css';

const BOT_NAMES = ['Riley', 'Jordan', 'Morgan', 'Quinn', 'Avery', 'Taylor', 'Casey', 'Sam', 'Drew'];
let botNameIdx = 0;

const WAITING_QUIPS = [
  'Warming up the chameleon...',
  'Teaching lizards to lie...',
  'Sharpening suspicious glances...',
  'Loading trust issues...',
  'Polishing poker faces...',
];

export default function Lobby() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { gameId, setGameId, playerId, setPlayerId, setPlayerName, game, reset } = useGameStore();
  const isHost = game?.hostId === playerId;
  const playerList = game ? Object.values(game.players) : [];
  const hadGameRef = useRef(false);

  // Track if we ever had a valid game state
  useEffect(() => {
    if (game) hadGameRef.current = true;
  }, [game]);

  const [totalRounds, setTotalRounds] = useState(5);
  const [copied, setCopied] = useState(false);

  // Join-via-link state
  const isJoinRoute = location.pathname.startsWith('/join/');
  const isInGame = !!(playerId && game?.players[playerId]);
  const [joinName, setJoinName] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);

  // Set game ID from URL if not already set
  useEffect(() => {
    if (roomCode && !gameId) {
      setGameId(roomCode);
    }
  }, [roomCode, gameId, setGameId]);

  // Subscribe to game updates
  useGameSync();

  // Redirect to play when game starts
  useEffect(() => {
    if (game && game.phase !== 'LOBBY' && game.phase !== 'ENDED') {
      navigate(`/play/${game.gameId}`);
    }
  }, [game, navigate]);

  // Detect game ended by host
  useEffect(() => {
    if (game?.phase === 'ENDED') {
      const timer = setTimeout(() => { reset(); navigate('/'); }, 100);
      return () => clearTimeout(timer);
    }
    // Only treat null game as "ended" if we previously had a valid game
    if (gameId && game === null && playerId && !isJoinRoute && hadGameRef.current) {
      const timer = setTimeout(() => { reset(); navigate('/'); }, 100);
      return () => clearTimeout(timer);
    }
  }, [game, gameId, playerId, isJoinRoute, reset, navigate]);

  const wasInGameRef = useRef(false);
  useEffect(() => {
    if (game && playerId && game.players[playerId]) wasInGameRef.current = true;
  }, [game, playerId]);

  // Detect being kicked (player ID no longer in game) — only in LOBBY phase
  // Only fire if the player was previously in the game (prevents race with join message)
  useEffect(() => {
    if (game && game.phase === 'LOBBY' && playerId && !game.players[playerId] && !isJoinRoute && wasInGameRef.current) {
      reset();
      navigate('/');
    }
  }, [game, playerId, isJoinRoute, reset, navigate]);

  // Leave game handler
  async function handleLeaveGame() {
    if (!gameId) return;
    if (isHost) {
      await deleteGame(gameId);
    }
    reset();
    navigate('/');
  }

  async function handleJoinGame() {
    if (!joinName.trim()) { setJoinError('You need a name to play!'); return; }
    if (!roomCode) return;
    setJoinLoading(true);
    setJoinError('');

    try {
      const existingGame = await fetchGame(roomCode);
      if (!existingGame) {
        setJoinError('Game not found. It may have expired.');
        setJoinLoading(false);
        return;
      }
      if (existingGame.phase !== 'LOBBY') {
        setJoinError('This game has already started!');
        setJoinLoading(false);
        return;
      }
      if (Object.keys(existingGame.players).length >= 10) {
        setJoinError('This game is full (10 players max).');
        setJoinLoading(false);
        return;
      }

      const player = createPlayer(joinName.trim());
      await updateGame(roomCode, {
        players: { ...existingGame.players, [player.id]: player },
      });

      setGameId(roomCode);
      setPlayerId(player.id);
      setPlayerName(joinName.trim());

      // Switch to lobby view (no longer on join route functionally)
      navigate(`/lobby/${roomCode}`, { replace: true });
    } catch (err) {
      console.error(err);
      setJoinError('Failed to join game.');
    } finally {
      setJoinLoading(false);
    }
  }

  async function handleStartGame() {
    if (!game || !gameId) return;
    if (playerList.length < 3) return;

    const roundUpdates = dealRound({ ...game, totalRounds });
    await updateGame(gameId, { ...roundUpdates, totalRounds });
  }

  async function handleAddBot() {
    if (!game || !gameId || playerList.length >= 10) return;
    const botName = BOT_NAMES[botNameIdx % BOT_NAMES.length] + (botNameIdx >= BOT_NAMES.length ? ` ${Math.floor(botNameIdx / BOT_NAMES.length) + 1}` : '');
    botNameIdx++;
    const bot = createPlayer(botName);
    await updateGame(gameId, {
      players: { ...game.players, [bot.id]: bot },
    });
  }

  async function handleKickPlayer(kickId: string) {
    if (!game || !gameId || !isHost) return;
    // Remove player from the players map
    const updatedPlayers = { ...game.players };
    delete updatedPlayers[kickId];
    await updateGame(gameId, { players: updatedPlayers });
  }

  function handleCopyCode() {
    if (!roomCode) return;
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleCopyLink() {
    const link = `${window.location.origin}/join/${roomCode}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Show join form for users arriving via /join/ who aren't in the game yet
  if (isJoinRoute && !isInGame) {
    return (
      <div className="page page-center">
        <div className="app-bg" />
        <div className="container container-narrow text-center">
          <div className="mb-lg fade-in">
            <span className="chameleon-icon">🦎</span>
            <h1 className="title-lg">Join Game</h1>
            <p className="subtitle">Room: <strong>{roomCode}</strong></p>
          </div>

          <div className="card fade-in fade-in-delay-1">
            <div className="input-group mb-md">
              <label className="label">Your Name</label>
              <input
                className="input"
                type="text"
                placeholder="Enter your name..."
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleJoinGame()}
                maxLength={20}
                autoFocus
                id="input-join-name"
              />
            </div>
            {joinError && <p className="home-error">{joinError}</p>}
            <button
              className="btn btn-primary btn-lg btn-full"
              onClick={handleJoinGame}
              disabled={joinLoading || !joinName.trim()}
              id="btn-join-room"
            >
              {joinLoading ? <span className="spinner" /> : '🚪 Join Room'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="page page-center">
        <div className="app-bg" />
        <div className="spinner" style={{ width: 40, height: 40 }} />
      </div>
    );
  }

  return (
    <div className="page page-center">
      <div className="app-bg" />

      <div className="container container-narrow">
        <div className="text-center mb-lg fade-in">
          <span className="chameleon-icon">🦎</span>
          <h1 className="title-lg">Waiting Room</h1>
        </div>

        {/* Room Code */}
        <div className="card text-center mb-lg fade-in fade-in-delay-1">
          <span className="label">Room Code</span>
          <div className="room-code" onClick={handleCopyCode} style={{ cursor: 'pointer' }}>
            {roomCode}
          </div>
          <div className="flex justify-center gap-sm mt-sm">
            <button className="btn btn-ghost btn-sm" onClick={handleCopyCode}>
              {copied ? '✓ Copied!' : '📋 Copy Code'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleCopyLink}>
              🔗 Copy Link
            </button>
          </div>
        </div>

        {/* Players */}
        <div className="card mb-lg fade-in fade-in-delay-2">
          <div className="flex justify-between items-center mb-md">
            <span className="label">Players ({playerList.length}/10)</span>
            {playerList.length < 3 && (
              <span className="badge badge-amber">Need {3 - playerList.length} more</span>
            )}
            {playerList.length >= 3 && (
              <span className="badge badge-green">Ready!</span>
            )}
          </div>
          <PlayerList players={playerList} currentPlayerId={playerId || undefined} showScores={false} onKick={isHost ? handleKickPlayer : undefined} />

          {/* Add Bot button (local mode only) */}
          {isHost && isLocalMode && playerList.length < 10 && (
            <button
              className="btn btn-secondary btn-sm btn-full mt-md"
              onClick={handleAddBot}
              id="btn-add-bot"
            >
              🤖 Add Bot Player
            </button>
          )}
        </div>

        {/* Host controls */}
        {isHost && (
          <div className="card fade-in fade-in-delay-3">
            <div className="input-group mb-md">
              <label className="label">Number of Rounds</label>
              <div className="lobby-rounds-selector">
                {[3, 5, 7, 10].map((n) => (
                  <button
                    key={n}
                    className={`btn btn-sm ${totalRounds === n ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setTotalRounds(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <button
              className="btn btn-primary btn-lg btn-full"
              onClick={handleStartGame}
              disabled={playerList.length < 3}
              id="btn-start-game"
            >
              {playerList.length < 3
                ? `Waiting for players (${playerList.length}/3 min)...`
                : `🎲 Start Game (${totalRounds} rounds)`}
            </button>

            <button
              className="btn btn-ghost btn-sm btn-full mt-sm"
              onClick={handleLeaveGame}
              id="btn-end-game"
              style={{ color: 'var(--text-muted)' }}
            >
              🚪 End Game & Leave
            </button>
          </div>
        )}

        {!isHost && (
          <>
            <div className="status-bar fade-in fade-in-delay-3">
              <span className="pulse">●</span>
              {WAITING_QUIPS[Math.floor(Date.now() / 3000) % WAITING_QUIPS.length]}
            </div>
            <button
              className="btn btn-ghost btn-sm btn-full mt-md"
              onClick={handleLeaveGame}
              id="btn-leave-game"
            >
              🚪 Leave Game
            </button>
          </>
        )}

        {isLocalMode && (
          <p className="text-center mt-md" style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
            💻 Local Demo Mode — add bots to test the full game flow
          </p>
        )}
      </div>
    </div>
  );
}
