import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useGameStore from '../stores/gameStore';
import { createPlayer, createGameState, generateRoomCode } from '../utils/gameLogic';
import { createGame, getGame, updateGame } from '../gameApi';
import './Home.css';

export default function Home() {
  const navigate = useNavigate();
  const { setGameId, setPlayerId, setPlayerName } = useGameStore();

  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [mode, setMode] = useState<'menu' | 'create' | 'join'>('menu');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const placeholders = [
    'Enter your name, legend...',
    'Who dares play?',
    'Name yourself, chameleon...',
    'The spy needs a name...',
  ];
  const placeholder = placeholders[Math.floor(Math.random() * placeholders.length)];

  async function handleCreate() {
    if (!name.trim()) { setError('You need a name to play!'); return; }
    setLoading(true);
    setError('');

    try {
      const roomCode = generateRoomCode();
      const player = createPlayer(name.trim(), true);
      const gameState = createGameState(roomCode, player);

      await createGame(roomCode, gameState);

      setGameId(roomCode);
      setPlayerId(player.id);
      setPlayerName(name.trim());

      navigate(`/lobby/${roomCode}`);
    } catch (err) {
      console.error(err);
      setError('Failed to create game. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin() {
    if (!name.trim()) { setError('You need a name to play!'); return; }
    if (!joinCode.trim()) { setError('Enter a room code!'); return; }
    setLoading(true);
    setError('');

    const code = joinCode.trim().toUpperCase();

    try {
      const game = await getGame(code);
      if (!game) {
        setError('Game not found. Check the code and try again.');
        setLoading(false);
        return;
      }
      if (game.phase !== 'LOBBY') {
        setError('This game has already started!');
        setLoading(false);
        return;
      }
      if (Object.keys(game.players).length >= 10) {
        setError('This game is full (10 players max).');
        setLoading(false);
        return;
      }

      const player = createPlayer(name.trim());
      await updateGame(code, {
        players: { ...game.players, [player.id]: player },
      });

      setGameId(code);
      setPlayerId(player.id);
      setPlayerName(name.trim());

      navigate(`/lobby/${code}`);
    } catch (err) {
      console.error(err);
      setError('Failed to join game.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page page-center">
      <div className="app-bg" />

      <div className="container container-narrow text-center">
        {/* Logo */}
        <div className="home-logo fade-in">
          <span className="home-chameleon-icon">🦎</span>
          <h1 className="title-xl">Chameleon</h1>
          <p className="subtitle">Blend in. Don't get caught.</p>
        </div>

        {/* Menu Mode */}
        {mode === 'menu' && (
          <div className="home-actions fade-in fade-in-delay-2">
            <button
              className="btn btn-primary btn-lg btn-full"
              onClick={() => setMode('create')}
              id="btn-create-game"
            >
              🎮 Create Game
            </button>
            <button
              className="btn btn-secondary btn-lg btn-full"
              onClick={() => setMode('join')}
              id="btn-join-game"
            >
              🚪 Join Game
            </button>
          </div>
        )}

        {/* Create Mode */}
        {mode === 'create' && (
          <div className="home-form card fade-in">
            <h2 className="title-md mb-md">Create a Game</h2>
            <div className="input-group mb-md">
              <label className="label">Your Name</label>
              <input
                className="input"
                type="text"
                placeholder={placeholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={20}
                autoFocus
                id="input-player-name"
              />
            </div>
            {error && <p className="home-error">{error}</p>}
            <div className="flex gap-sm">
              <button
                className="btn btn-ghost"
                onClick={() => { setMode('menu'); setError(''); }}
              >
                ← Back
              </button>
              <button
                className="btn btn-primary btn-lg"
                style={{ flex: 1 }}
                onClick={handleCreate}
                disabled={loading || !name.trim()}
                id="btn-create-room"
              >
                {loading ? <span className="spinner" /> : '🎲 Create Room'}
              </button>
            </div>
          </div>
        )}

        {/* Join Mode */}
        {mode === 'join' && (
          <div className="home-form card fade-in">
            <h2 className="title-md mb-md">Join a Game</h2>
            <div className="input-group mb-md">
              <label className="label">Your Name</label>
              <input
                className="input"
                type="text"
                placeholder={placeholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={20}
                autoFocus
                id="input-join-name"
              />
            </div>
            <div className="input-group mb-md">
              <label className="label">Room Code</label>
              <input
                className="input input-lg"
                type="text"
                placeholder="ABC123"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={6}
                id="input-room-code"
              />
            </div>
            {error && <p className="home-error">{error}</p>}
            <div className="flex gap-sm">
              <button
                className="btn btn-ghost"
                onClick={() => { setMode('menu'); setError(''); }}
              >
                ← Back
              </button>
              <button
                className="btn btn-primary btn-lg"
                style={{ flex: 1 }}
                onClick={handleJoin}
                disabled={loading}
                id="btn-start-join"
              >
                {loading ? <span className="spinner" /> : '🚪 Join Room'}
              </button>
            </div>
          </div>
        )}

        <p className="home-footer fade-in fade-in-delay-3">
          3–10 players
        </p>
        <p className="home-build-date fade-in fade-in-delay-4">
          Last updated: {new Date((__BUILD_DATE__ as unknown) as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}
