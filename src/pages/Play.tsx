import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import useGameStore from '../stores/gameStore';
import { useGameSync } from '../hooks/useGameSync';
import { updateGame, updatePlayer, deleteGame, isLocalMode } from '../gameApi';
import { getTopicCard, dealRound, tallyVotes, calculateRoundScores, buildRoundResult } from '../utils/gameLogic';
import { getSecretWordIndex, getCoordinate } from '../utils/codeCards';
import TopicCard from '../components/TopicCard';
import CodeCard from '../components/CodeCard';
import DiceRoll from '../components/DiceRoll';
import PlayerList from '../components/PlayerList';
import ScoreBoard from '../components/ScoreBoard';
import Confetti from '../components/Confetti';
import ChameleonEscape from '../components/ChameleonEscape';
import './Play.css';

const BOT_CLUE_WORDS = ['thing', 'stuff', 'related', 'similar', 'nearby', 'connected', 'vibes', 'close', 'kinda', 'maybe', 'hmm', 'think', 'reminds', 'like', 'almost'];

// Witty chameleon-themed messages
const WAITING_CLUE_QUIPS = [
  '🎭 Watching for suspicious pauses...',
  '🦎 The chameleon is sweating right now',
  '🤔 Someone here is faking it',
  '👀 Study those faces carefully...',
  '🕵️ Every clue is a potential tell',
  '😏 Acting natural? Suspicious.',
];
const DISCUSSION_QUIPS = [
  '🔥 Time to throw some shade!',
  '🎪 Who\'s been bluffing this whole time?',
  '🦎 The chameleon could be anyone...',
  '💬 Trust no one. Question everything.',
  '🤫 Someone knows less than they\'re letting on',
  '🎯 Look at those clues. Something doesn\'t add up...',
];
const VOTE_CAST_QUIPS = [
  '✓ Vote locked in — no take-backs! 🔒',
  '✓ The die is cast... figuratively 🎲',
  '✓ Your suspicion has been noted 📝',
  '✓ Vote submitted — fingers crossed 🤞',
];
const CLUE_SUBMITTED_QUIPS = [
  '✓ Nailed it. Or did you? 🤔',
  '✓ Clue locked — let\'s see who sweats 😅',
  '✓ Submitted! Now watch the chaos unfold...',
  '✓ Your clue is in. Act natural. 🦎',
];
function pickRandom(arr: string[]) { return arr[Math.floor(Math.random() * arr.length)]; }

export default function Play() {
  const navigate = useNavigate();
  const { gameId, playerId, game, reset } = useGameStore();
  const isChameleon = game?.chameleonId === playerId;
  const isHost = game?.hostId === playerId;
  const playerList = game ? Object.values(game.players) : [];
  const isMyTurn = game?.phase === 'CLUE_GIVING' && game?.turnOrder?.[game.currentTurnIndex] === playerId;
  const hadGameRef = useRef(false);

  // Track if we ever had a valid game state
  useEffect(() => {
    if (game) hadGameRef.current = true;
  }, [game]);

  const [clueInput, setClueInput] = useState('');
  const [selectedGuess, setSelectedGuess] = useState<number | null>(null);
  const [votedPlayer, setVotedPlayer] = useState('');
  const [showDice, setShowDice] = useState(true);

  useGameSync();

  // Hide dice after animation
  useEffect(() => {
    if (game?.phase === 'CLUE_GIVING') {
      setShowDice(true);
      const t = setTimeout(() => setShowDice(false), 3000);
      return () => clearTimeout(t);
    }
  }, [game?.phase, game?.currentRound]);

  // Reset local state on phase change
  useEffect(() => {
    setClueInput('');
    setSelectedGuess(null);
    setVotedPlayer('');
  }, [game?.phase]);

  // Redirect to results on game over
  useEffect(() => {
    if (game?.phase === 'GAME_OVER') {
      navigate(`/results/${gameId}`);
    }
  }, [game?.phase, gameId, navigate]);

  // Detect game ended by host (or game deleted)
  useEffect(() => {
    if (game?.phase === 'ENDED') {
      reset();
      navigate('/');
      return;
    }
    // Only treat null game as "ended" if we previously had a valid game
    if (gameId && game === null && playerId && hadGameRef.current) {
      reset();
      navigate('/');
    }
  }, [game, gameId, playerId, reset, navigate]);

  // Bot auto-play (local mode only) — uses interval polling for reliability
  useEffect(() => {
    if (!isLocalMode) return;

    const interval = setInterval(async () => {
      // Read latest state directly from the store
      const { game: g, gameId: gId, playerId: pId } = useGameStore.getState();
      if (!g || !gId || !pId) return;

      // CLUE_GIVING: if it's a bot's turn, auto-submit
      if (g.phase === 'CLUE_GIVING') {
        const currentTurnId = g.turnOrder?.[g.currentTurnIndex];
        if (currentTurnId && currentTurnId !== pId && !g.players[currentTurnId]?.hasSubmitted) {
          const clue = BOT_CLUE_WORDS[Math.floor(Math.random() * BOT_CLUE_WORDS.length)];
          await updatePlayer(gId, currentTurnId, { clue, hasSubmitted: true });
          const nextTurn = g.currentTurnIndex + 1;
          if (nextTurn >= g.turnOrder.length) {
            await updateGame(gId, { phase: 'DISCUSSION', currentTurnIndex: nextTurn });
          } else {
            await updateGame(gId, { currentTurnIndex: nextTurn });
          }
        }
      }

      // VOTING: auto-submit votes for bots that haven't voted
      if (g.phase === 'VOTING') {
        const unvotedBots = Object.keys(g.players).filter(
          id => id !== pId && !g.players[id].vote
        );
        if (unvotedBots.length > 0) {
          for (const botId of unvotedBots) {
            const targets = Object.keys(g.players).filter(id => id !== botId);
            const vote = targets[Math.floor(Math.random() * targets.length)];
            await updatePlayer(gId, botId, { vote });
          }
        }
        // Always check if all have voted (fixes deadlock when human votes last)
        const latestGame = useGameStore.getState().game;
        if (latestGame && latestGame.phase === 'VOTING') {
          const allVoted = Object.values(latestGame.players).every(p => p.vote !== '');
          if (allVoted) {
            const { winnerId } = tallyVotes(latestGame);
            const accusedId = winnerId || latestGame.hostId;
            if (accusedId === latestGame.chameleonId) {
              await updateGame(gId, { phase: 'CHAMELEON_GUESS' });
            } else {
              const { scores, chameleonCaught } = calculateRoundScores(latestGame, accusedId, false);
              const topicCard = getTopicCard(latestGame.topicIndex);
              const secretIdx = getSecretWordIndex(latestGame.codeCardSetIndex, latestGame.diceYellow, latestGame.diceBlue);
              const word = topicCard.words[secretIdx];
              const result = buildRoundResult(latestGame, word, chameleonCaught, false, scores);
              const updatedPlayers = { ...latestGame.players };
              for (const [id, pts] of Object.entries(scores)) {
                if (updatedPlayers[id]) {
                  updatedPlayers[id] = { ...updatedPlayers[id], score: (updatedPlayers[id].score || 0) + pts };
                }
              }
              await updateGame(gId, {
                phase: 'SCORING',
                players: updatedPlayers,
                roundHistory: [...(latestGame.roundHistory || []), result],
              });
            }
          }
        }
      }

      // CHAMELEON_GUESS: if chameleon is a bot, auto-guess
      if (g.phase === 'CHAMELEON_GUESS' && g.chameleonId !== pId) {
        const topicCard = getTopicCard(g.topicIndex);
        const guessIdx = Math.floor(Math.random() * topicCard.words.length);
        const guessedWord = topicCard.words[guessIdx];
        const secretIdx = getSecretWordIndex(g.codeCardSetIndex, g.diceYellow, g.diceBlue);
        const correct = guessIdx === secretIdx;
        const { scores, chameleonCaught } = calculateRoundScores(g, g.chameleonId, correct);
        const result = buildRoundResult(g, topicCard.words[secretIdx], chameleonCaught, correct, scores);
        const updatedPlayers = { ...g.players };
        for (const [id, pts] of Object.entries(scores)) {
          if (updatedPlayers[id]) {
            updatedPlayers[id] = { ...updatedPlayers[id], score: (updatedPlayers[id].score || 0) + pts };
          }
        }
        await updateGame(gId, {
          phase: 'SCORING',
          chameleonGuess: guessedWord,
          players: updatedPlayers,
          roundHistory: [...(g.roundHistory || []), result],
        });
      }
    }, 800);

    return () => clearInterval(interval);
  }, []); // Empty deps — polls independently of renders

  if (!game || !gameId || !playerId) {
    return (
      <div className="page page-center">
        <div className="app-bg" />
        <div className="spinner" style={{ width: 40, height: 40 }} />
      </div>
    );
  }

  const topicCard = getTopicCard(game.topicIndex);
  const secretWordIdx = getSecretWordIndex(game.codeCardSetIndex, game.diceYellow, game.diceBlue);
  const coordinate = getCoordinate(game.codeCardSetIndex, game.diceYellow, game.diceBlue);
  const secretWord = topicCard.words[secretWordIdx];
  const currentTurnPlayerId = game.turnOrder?.[game.currentTurnIndex] || '';

  // --- Handlers ---

  async function handleSubmitClue() {
    if (!clueInput.trim() || !gameId || !playerId || !game) return;

    await updatePlayer(gameId, playerId, {
      clue: clueInput.trim(),
      hasSubmitted: true,
    });

    // Advance turn
    const nextTurn = game.currentTurnIndex + 1;
    if (nextTurn >= game.turnOrder.length) {
      // All clues submitted — move to discussion
      await updateGame(gameId, {
        phase: 'DISCUSSION',
        currentTurnIndex: nextTurn,
      });
    } else {
      await updateGame(gameId, { currentTurnIndex: nextTurn });
    }
  }

  async function handleStartVoting() {
    if (!gameId) return;
    await updateGame(gameId, { phase: 'VOTING' });
  }

  async function handleSubmitVote() {
    if (!votedPlayer || !gameId || !playerId || !game) return;
    await updatePlayer(gameId, playerId, { vote: votedPlayer });

    // In WS mode, the server handles phase advancement after all votes
    if (!isLocalMode) return;

    // Local mode: advance phase on the client
    // Small delay to let store update
    await new Promise(r => setTimeout(r, 100));
    const latestGame = useGameStore.getState().game;
    if (!latestGame || latestGame.phase !== 'VOTING') return;

    const allVoted = Object.values(latestGame.players).every((p) => p.vote !== '');

    if (allVoted) {
      const { winnerId } = tallyVotes(latestGame);
      const accusedId = winnerId || latestGame.hostId;

      if (accusedId === latestGame.chameleonId) {
        await updateGame(gameId, { phase: 'CHAMELEON_GUESS' });
      } else {
        const { scores, chameleonCaught } = calculateRoundScores(
          latestGame, accusedId, false
        );
        const result = buildRoundResult(latestGame, secretWord, chameleonCaught, false, scores);

        const updatedPlayers = { ...latestGame.players };
        for (const [id, pts] of Object.entries(scores)) {
          if (updatedPlayers[id]) {
            updatedPlayers[id] = {
              ...updatedPlayers[id],
              score: (updatedPlayers[id].score || 0) + pts,
            };
          }
        }

        await updateGame(gameId, {
          phase: 'SCORING',
          players: updatedPlayers,
          roundHistory: [...(latestGame.roundHistory || []), result],
        });
      }
    }
  }

  async function handleChameleonGuess() {
    if (selectedGuess === null || !gameId || !game) return;
    const guessedWord = topicCard.words[selectedGuess];

    if (!isLocalMode) {
      // WS mode: just set the guess, server handles scoring
      await updateGame(gameId, { chameleonGuess: guessedWord });
      return;
    }

    // Local mode: calculate scores on the client
    const correct = selectedGuess === secretWordIdx;
    const { scores, chameleonCaught } = calculateRoundScores(game, game.chameleonId, correct);
    const result = buildRoundResult(game, secretWord, chameleonCaught, correct, scores);

    const updatedPlayers = { ...game.players };
    for (const [id, pts] of Object.entries(scores)) {
      if (updatedPlayers[id]) {
        updatedPlayers[id] = {
          ...updatedPlayers[id],
          score: (updatedPlayers[id].score || 0) + pts,
        };
      }
    }

    await updateGame(gameId, {
      phase: 'SCORING',
      chameleonGuess: guessedWord,
      players: updatedPlayers,
      roundHistory: [...(game.roundHistory || []), result],
    });
  }

  async function handleNextRound() {
    if (!gameId || !game) return;
    if (game.currentRound >= game.totalRounds) {
      await updateGame(gameId, { phase: 'GAME_OVER' });
    } else {
      const roundUpdates = dealRound(game);
      await updateGame(gameId, roundUpdates);
    }
  }

  async function handleLeaveGame() {
    if (!gameId) return;
    if (isHost) {
      await deleteGame(gameId);
    }
    reset();
    navigate('/');
  }

  // --- Render Phases ---

  const voteCounts: Record<string, number> = {};
  Object.values(game.players).forEach((p) => {
    if (p.vote) voteCounts[p.vote] = (voteCounts[p.vote] || 0) + 1;
  });

  const lastRound = game.roundHistory?.length
    ? game.roundHistory[game.roundHistory.length - 1]
    : null;

  return (
    <div className="page">
      <div className="app-bg" />

      <div className="container">
        {/* Header */}
        <div className="play-header fade-in">
          <div className="flex items-center gap-sm">
            <span className="chameleon-icon" style={{ fontSize: '1.5rem' }}>🦎</span>
            <span className="label">Round {game.currentRound} / {game.totalRounds}</span>
          </div>
          <div className="flex items-center gap-sm">
            <span className="badge badge-green">{game.phase.replace(/_/g, ' ')}</span>
            {isHost && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleLeaveGame}
                id="btn-leave-play"
                title="End game for everyone"
                style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}
              >
                🚪 End
              </button>
            )}
          </div>
        </div>

        <div className="play-layout">
          {/* Main area */}
          <div className="play-main">
            {/* Dice Roll (shown briefly) */}
            {showDice && game.phase === 'CLUE_GIVING' && (
              <div className="mb-lg">
                <DiceRoll yellowValue={game.diceYellow} blueValue={game.diceBlue} animate={true} />
              </div>
            )}

            {/* Code Card */}
            {(game.phase === 'CLUE_GIVING' || game.phase === 'DISCUSSION') && (
              <div className="mb-lg">
                <CodeCard
                  isChameleon={isChameleon}
                  coordinate={isChameleon ? undefined : coordinate}
                  secretWord={isChameleon ? undefined : secretWord}
                />
              </div>
            )}

            {/* Topic Card */}
            {game.phase !== 'SCORING' && (
              <div className="card mb-lg">
                <TopicCard
                  topic={topicCard.topic}
                  words={topicCard.words}
                  secretWordIndex={isChameleon ? undefined : secretWordIdx}
                  showSecret={!isChameleon && (game.phase === 'CLUE_GIVING' || game.phase === 'DISCUSSION')}
                  selectable={game.phase === 'CHAMELEON_GUESS' && isChameleon}
                  selectedIndex={selectedGuess}
                  onSelect={setSelectedGuess}
                />
              </div>
            )}

            {/* CLUE_GIVING: Input */}
            {game.phase === 'CLUE_GIVING' && (
              <div className="card mb-lg fade-in">
                <div className="flex justify-between items-center mb-md">
                  <h3 className="title-md">Give Your Clue</h3>
                  <span className="label">
                    {isMyTurn ? '🟢 Your turn — make it count!' : `Waiting for ${game.players[currentTurnPlayerId]?.name || '...'}`}
                  </span>
                </div>

                {/* Show submitted clues */}
                <div className="clue-list mb-md">
                  {game.turnOrder.slice(0, game.currentTurnIndex).map((pid) => {
                    const p = game.players[pid];
                    if (!p) return null;
                    return (
                      <div key={pid} className="clue-bubble">
                        <span className="clue-author">{p.name}:</span>
                        <span className="clue-text">{p.clue}</span>
                      </div>
                    );
                  })}
                </div>

                {isMyTurn && !game.players[playerId]?.hasSubmitted && (
                  <div className="flex gap-sm">
                    <input
                      className="input"
                      type="text"
                      placeholder="Enter one word..."
                      value={clueInput}
                      onChange={(e) => setClueInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSubmitClue()}
                      maxLength={30}
                      autoFocus
                      id="input-clue"
                    />
                    <button
                      className="btn btn-primary"
                      onClick={handleSubmitClue}
                      disabled={!clueInput.trim()}
                      id="btn-submit-clue"
                    >
                      Send
                    </button>
                  </div>
                )}

                {game.players[playerId]?.hasSubmitted && (
                  <div className="status-bar">
                    {pickRandom(CLUE_SUBMITTED_QUIPS)}
                  </div>
                )}
                {!isMyTurn && !game.players[playerId]?.hasSubmitted && (
                  <div className="witty-status">{pickRandom(WAITING_CLUE_QUIPS)}</div>
                )}
              </div>
            )}

            {/* DISCUSSION phase */}
            {game.phase === 'DISCUSSION' && (
              <div className="card mb-lg fade-in">
                <h3 className="title-md mb-sm">🗣️ Discussion Time</h3>
                <p className="subtitle mb-sm" style={{ fontSize: '0.85rem' }}>
                  {pickRandom(DISCUSSION_QUIPS)}
                </p>

                <div className="clue-list mb-lg">
                  {game.turnOrder.map((pid) => {
                    const p = game.players[pid];
                    if (!p) return null;
                    return (
                      <div key={pid} className="clue-bubble">
                        <span className="clue-author">{p.name}:</span>
                        <span className="clue-text">{p.clue}</span>
                      </div>
                    );
                  })}
                </div>

                {isHost && (
                  <button
                    className="btn btn-primary btn-lg btn-full"
                    onClick={handleStartVoting}
                    id="btn-start-voting"
                  >
                    🗳️ Start Voting
                  </button>
                )}
                {!isHost && (
                  <div className="status-bar">
                    <span className="pulse">●</span>
                    Waiting for host to start voting...
                  </div>
                )}
              </div>
            )}

            {/* VOTING phase */}
            {game.phase === 'VOTING' && (
              <div className="card mb-lg fade-in">
                <h3 className="title-md mb-md">🗳️ Cast Your Vote</h3>
                <p className="subtitle mb-md">Who do you think is the Chameleon?</p>

                <PlayerList
                  players={playerList}
                  currentPlayerId={playerId}
                  votable={!game.players[playerId]?.vote}
                  votedId={votedPlayer || game.players[playerId]?.vote || undefined}
                  onVote={setVotedPlayer}
                  hideCheck={true}
                />

                {votedPlayer && !game.players[playerId]?.vote && (
                  <button
                    className="btn btn-danger btn-lg btn-full mt-md"
                    onClick={handleSubmitVote}
                    id="btn-submit-vote"
                  >
                    🎯 Accuse {game.players[votedPlayer]?.name}!
                  </button>
                )}

                {game.players[playerId]?.vote && (
                  <div className="status-bar mt-md">
                    {pickRandom(VOTE_CAST_QUIPS)}
                  </div>
                )}
              </div>
            )}

            {/* CHAMELEON_GUESS phase */}
            {game.phase === 'CHAMELEON_GUESS' && (
              <div className="card mb-lg fade-in">
                <h3 className="title-md mb-md">🦎 The Chameleon Was Caught!</h3>

                {isChameleon ? (
                  <>
                    <p className="subtitle mb-md">
                      🚨 Busted! But you've got one last trick — guess the secret word to escape!
                    </p>
                    {selectedGuess !== null && (
                      <button
                        className="btn btn-primary btn-lg btn-full mt-md"
                        onClick={handleChameleonGuess}
                        id="btn-chameleon-guess"
                      >
                        🎲 Guess: "{topicCard.words[selectedGuess]}"
                      </button>
                    )}
                  </>
                ) : (
                  <div className="status-bar">
                    <span className="pulse">●</span>
                    🦎 The Chameleon is sweating... picking a word...
                  </div>
                )}
              </div>
            )}

            {/* SCORING phase */}
            {game.phase === 'SCORING' && lastRound && (
              <div className="card mb-lg fade-in">
                {/* Celebration animations */}
                {lastRound.chameleonCaught && !lastRound.chameleonGuessedCorrectly && <Confetti />}
                {!lastRound.chameleonCaught && <ChameleonEscape />}

                <div className="scoring-reveal text-center mb-lg">
                  <h3 className="title-lg mb-sm">Round {lastRound.round} Results</h3>

                  <div className="scoring-info mb-md">
                    <p>Topic: <strong>{lastRound.topic}</strong></p>
                    <p>Secret Word: <strong className="highlight-word">{lastRound.secretWord}</strong></p>
                    <p>
                      Chameleon: <strong>{lastRound.chameleonName}</strong>
                      {lastRound.chameleonCaught
                        ? lastRound.chameleonGuessedCorrectly
                          ? <span className="badge badge-amber" style={{ marginLeft: 8 }}>Guessed correctly! 🦎</span>
                          : <span className="badge badge-green" style={{ marginLeft: 8 }}>Caught! 🎯</span>
                        : <span className="badge badge-red" style={{ marginLeft: 8 }}>Escaped! 💨</span>}
                    </p>
                  </div>
                </div>

                <ScoreBoard
                  players={playerList}
                  roundHistory={game.roundHistory || []}
                />

                {isHost && (
                  <button
                    className="btn btn-primary btn-lg btn-full mt-lg"
                    onClick={handleNextRound}
                    id="btn-next-round"
                  >
                    {game.currentRound >= game.totalRounds
                      ? '🏆 See Final Results'
                      : `🎲 Next Round (${game.currentRound + 1}/${game.totalRounds})`}
                  </button>
                )}
                {!isHost && (
                  <div className="status-bar mt-lg">
                    <span className="pulse">●</span>
                    Waiting for host to continue...
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sidebar: Players */}
          <div className="play-sidebar">
            <div className="card">
              <span className="label mb-sm" style={{ display: 'block' }}>Players</span>
              {(game.phase === 'VOTING' || game.phase === 'REVEAL') && (
                <div className="sidebar-col-headers">
                  <span className="sidebar-col-header-score">PTS</span>
                  <span className="sidebar-col-header-votes">VOTES</span>
                </div>
              )}
              <PlayerList
                players={playerList}
                currentPlayerId={playerId}
                currentTurnId={game.phase === 'CLUE_GIVING' ? currentTurnPlayerId : undefined}
                showScores={true}
                showVoteCounts={game.phase === 'VOTING' || game.phase === 'REVEAL'}
                showVoteCheck={game.phase === 'VOTING' || game.phase === 'REVEAL'}
                voteCounts={voteCounts}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
