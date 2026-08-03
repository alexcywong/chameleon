import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import useGameStore from '../stores/gameStore';
import { useGameSync } from '../hooks/useGameSync';
import { updateGame, updatePlayer, deleteGame, isLocalMode } from '../gameApi';
import { getWordTable, dealRound, buildScoringUpdate, resolveVotes, tallyVotes, allVotesSubmitted } from '../utils/gameLogic';
import { getSecretWordIndex, getCoordinate } from '../utils/codeCards';
import TopicCard from '../components/TopicCard';
import CodeCard from '../components/CodeCard';
import DiceRoll from '../components/DiceRoll';
import PlayerList from '../components/PlayerList';
import ScoreBoard from '../components/ScoreBoard';
import Confetti from '../components/Confetti';
import KiwiEscape from '../components/KiwiEscape';
import { generateClueRoast } from '../utils/clueRoasts';
import './Play.css';

const BOT_CLUE_WORDS = ['thing', 'stuff', 'related', 'similar', 'nearby', 'connected', 'vibes', 'close', 'kinda', 'maybe', 'hmm', 'think', 'reminds', 'like', 'almost'];

// Witty kiwi-themed messages
const WAITING_CLUE_QUIPS = [
  '🎭 Watching for suspicious pauses...',
  '🥝 The kiwi is sweating right now',
  '🤔 Someone here is faking it',
  '👀 Study those faces carefully...',
  '🕵️ Every clue is a potential tell',
  '😏 Acting natural? Suspicious.',
];

const CLUE_SUBMITTED_QUIPS = [
  '✓ Nailed it. Or did you? 🤔',
  '✓ Clue locked — let\'s see who sweats 😅',
  '✓ Submitted! Now watch the chaos unfold...',
  '✓ Your clue is in. Act natural. 🥝',
];
function pickRandom(arr: string[]) { return arr[Math.floor(Math.random() * arr.length)]; }

function TieBreakerAnimation({ tied, chosen, players }: {
  tied: string[];
  chosen: string;
  players: Record<string, { name: string }>;
}) {
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let count = 0;
    const total = 18 + tied.indexOf(chosen);
    const interval = setInterval(() => {
      count++;
      setHighlightIdx(count % tied.length);
      if (count >= total) {
        clearInterval(interval);
        setSettled(true);
      }
    }, 140);
    return () => clearInterval(interval);
  }, [tied, chosen]);

  return (
    <div className="tie-breaker-overlay fade-in">
      <h3 className="title-md mb-sm">🎲 It's a tie!</h3>
      <p className="subtitle mb-md">Randomly choosing...</p>
      <div className="tie-breaker-slots">
        {tied.map((id, i) => (
          <div
            key={id}
            className={`tie-breaker-slot ${highlightIdx === i ? 'tie-slot-active' : ''} ${settled && id === chosen ? 'tie-slot-chosen' : ''}`}
          >
            {players[id]?.name ?? '?'}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Play() {
  const navigate = useNavigate();
  const { gameId, playerId, game, reset, isReconnecting } = useGameStore();
  const isKiwi = game?.kiwiId === playerId;
  const isHost = game?.hostId === playerId;
  const playerList = game ? Object.values(game.players) : [];
  const isMyTurn = game?.phase === 'CLUE_GIVING' && game?.turnOrder?.[game.currentTurnIndex] === playerId;
  const hadGameRef = useRef(false);
  const nullGameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voteAutoSubmittedRef = useRef(false);

  // Track if we ever had a valid game state
  useEffect(() => {
    if (game) hadGameRef.current = true;
  }, [game]);

  const [clueInput, setClueInput] = useState('');
  const [selectedGuess, setSelectedGuess] = useState<number | null>(null);
  const [votedPlayer, setVotedPlayer] = useState('');
  const [showDice, setShowDice] = useState(true);
  const [showRoasts, setShowRoasts] = useState(false);
  const [voteTimer, setVoteTimer] = useState(30);
  const [tieBreaker, setTieBreaker] = useState<{ tied: string[]; picking: boolean; chosen: string | null }>({ tied: [], picking: false, chosen: null });

  // Generate roasts once per round (memoized so they don't shuffle on re-renders)
  const clueRoasts = useMemo(() => {
    if (!game || !game.turnOrder || game.phase === 'CLUE_GIVING') return {} as Record<string, string>;
    const table = getWordTable(game.topicIndex);
    const secretIdx = getSecretWordIndex(game.codeCardSetIndex, game.diceYellow, game.diceBlue);
    const word = table.words[secretIdx];
    const allClues = game.turnOrder.map(pid => game.players[pid]?.clue || '');
    const roasts: Record<string, string> = {};
    for (const pid of game.turnOrder) {
      const p = game.players[pid];
      if (p?.clue) {
        roasts[pid] = generateClueRoast(p.name, p.clue, word, allClues);
      }
    }
    return roasts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.currentRound, game?.phase === 'VOTING' || game?.phase === 'SCORING' ? 'show' : 'hide']);

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
    setVoteTimer(30);
    setTieBreaker({ tied: [], picking: false, chosen: null });
    voteAutoSubmittedRef.current = false;
  }, [game?.phase]);

  // Voting countdown timer (30 seconds)
  useEffect(() => {
    if (game?.phase !== 'VOTING') return;
    const interval = setInterval(() => {
      setVoteTimer(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [game?.phase, game?.currentRound]);

  // Fast-forward timer when all votes are in
  useEffect(() => {
    if (game?.phase !== 'VOTING' || voteTimer <= 1) return;
    if (allVotesSubmitted(game)) setVoteTimer(1);
  }, [game, voteTimer]);

  // When timer hits 0: submit vote if needed, then resolve with tie-breaker
  useEffect(() => {
    if (voteTimer !== 0 || game?.phase !== 'VOTING' || voteAutoSubmittedRef.current) return;
    voteAutoSubmittedRef.current = true;
    if (!gameId || !playerId) return;

    (async () => {
      const g = useGameStore.getState().game;
      if (!g || g.phase !== 'VOTING') return;

      // Submit player's vote if they haven't yet
      if (!g.players[playerId]?.vote) {
        const voteTarget = votedPlayer || (() => {
          const others = Object.keys(g.players).filter(id => id !== playerId);
          return others[Math.floor(Math.random() * others.length)];
        })();
        if (voteTarget) {
          setVotedPlayer(voteTarget);
          await updatePlayer(gameId, playerId, { vote: voteTarget });
        }
      }

      if (!isLocalMode) return;

      // Wait for store to settle
      await new Promise(r => setTimeout(r, 150));
      const latest = useGameStore.getState().game;
      if (!latest || latest.phase !== 'VOTING') return;

      // Check for tie before resolving
      const { winnerId, counts } = tallyVotes(latest);
      if (!winnerId) {
        const maxCount = Math.max(...Object.values(counts));
        const tied = Object.entries(counts).filter(([, c]) => c === maxCount).map(([id]) => id);
        if (tied.length > 1) {
          const chosen = tied[Math.floor(Math.random() * tied.length)];
          setTieBreaker({ tied, picking: true, chosen });
          // Animation runs for ~3 seconds, then resolve
          await new Promise(r => setTimeout(r, 3000));
          setTieBreaker(prev => ({ ...prev, picking: false }));
          await new Promise(r => setTimeout(r, 800));
        }
      }

      const final = useGameStore.getState().game;
      if (final && final.phase === 'VOTING') {
        const updates = resolveVotes(final);
        if (updates) await updateGame(gameId, updates);
      }
    })();
  }, [voteTimer, game?.phase, gameId, playerId, votedPlayer]);

  // Redirect to results on game over
  useEffect(() => {
    if (game?.phase === 'GAME_OVER') {
      navigate(`/results/${gameId}`);
    }
  }, [game?.phase, gameId, navigate]);

  // Redirect to lobby when game resets (Play Again)
  useEffect(() => {
    if (game?.phase === 'LOBBY' && gameId) {
      navigate(`/lobby/${gameId}`);
    }
  }, [game?.phase, gameId, navigate]);

  // Detect game ended by host (or game deleted)
  // Uses a 5-second grace period for null game state to allow reconnection
  useEffect(() => {
    if (game?.phase === 'ENDED') {
      if (nullGameTimerRef.current) { clearTimeout(nullGameTimerRef.current); nullGameTimerRef.current = null; }
      reset();
      navigate('/');
      return;
    }
    // If game came back (reconnected), cancel any pending redirect
    if (game !== null) {
      if (nullGameTimerRef.current) { clearTimeout(nullGameTimerRef.current); nullGameTimerRef.current = null; }
      return;
    }
    // Only treat null game as "ended" if we previously had a valid game
    // Grace period: wait 5 seconds before redirecting (allows WebSocket reconnection)
    if (gameId && game === null && playerId && hadGameRef.current) {
      if (!nullGameTimerRef.current) {
        nullGameTimerRef.current = setTimeout(() => {
          // Re-check: if game is still null after grace period, redirect
          const { game: currentGame } = useGameStore.getState();
          if (currentGame === null) {
            console.log('⏱️ Game state null after grace period — redirecting home');
            reset();
            navigate('/');
          }
          nullGameTimerRef.current = null;
        }, 5000);
      }
    }
    return () => {
      if (nullGameTimerRef.current) { clearTimeout(nullGameTimerRef.current); nullGameTimerRef.current = null; }
    };
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
            await updateGame(gId, { phase: 'VOTING', currentTurnIndex: nextTurn });
          } else {
            await updateGame(gId, { currentTurnIndex: nextTurn });
          }
        }
      }

      // VOTING: auto-submit votes for bots (resolution deferred to timer)
      if (g.phase === 'VOTING') {
        const unvotedBots = Object.keys(g.players).filter(
          id => id !== pId && !g.players[id].vote
        );
        for (const botId of unvotedBots) {
          const targets = Object.keys(g.players).filter(id => id !== botId);
          const vote = targets[Math.floor(Math.random() * targets.length)];
          await updatePlayer(gId, botId, { vote });
        }
      }

      // KIWI_GUESS: if kiwi is a bot, auto-guess
      if (g.phase === 'KIWI_GUESS' && g.kiwiId !== pId) {
        const wordTable = getWordTable(g.topicIndex);
        const guessIdx = Math.floor(Math.random() * wordTable.words.length);
        const secretIdx = getSecretWordIndex(g.codeCardSetIndex, g.diceYellow, g.diceBlue);
        await updateGame(gId, buildScoringUpdate(g, g.kiwiId, guessIdx === secretIdx, wordTable.words[guessIdx]));
      }
    }, 800);

    return () => clearInterval(interval);
  }, []); // Empty deps — polls independently of renders

  if (!game || !gameId || !playerId) {
    return (
      <div className="page page-center">
        <div className="app-bg" />
        {isReconnecting ? (
          <div className="reconnection-overlay fade-in">
            <div className="spinner" style={{ width: 40, height: 40 }} />
            <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>Reconnecting to game...</p>
          </div>
        ) : (
          <div className="spinner" style={{ width: 40, height: 40 }} />
        )}
      </div>
    );
  }

  const wordTable = getWordTable(game.topicIndex);
  const secretWordIdx = getSecretWordIndex(game.codeCardSetIndex, game.diceYellow, game.diceBlue);
  const coordinate = getCoordinate(game.codeCardSetIndex, game.diceYellow, game.diceBlue);
  const secretWord = wordTable.words[secretWordIdx];
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
      // All clues submitted — skip discussion, go straight to voting
      await updateGame(gameId, {
        phase: 'VOTING',
        currentTurnIndex: nextTurn,
      });
    } else {
      await updateGame(gameId, { currentTurnIndex: nextTurn });
    }
  }



  async function handleVoteForPlayer(targetId: string) {
    if (!gameId || !playerId || !game) return;
    if (targetId === playerId) return;
    setVotedPlayer(targetId);
    await updatePlayer(gameId, playerId, { vote: targetId });
  }

  async function handleKiwiGuess() {
    if (selectedGuess === null || !gameId || !game) return;
    const guessedWord = wordTable.words[selectedGuess];

    if (!isLocalMode) {
      // WS mode: just set the guess, server handles scoring
      await updateGame(gameId, { kiwiGuess: guessedWord });
      return;
    }

    // Local mode: calculate scores on the client
    const correct = selectedGuess === secretWordIdx;
    await updateGame(gameId, buildScoringUpdate(game, game.kiwiId, correct, guessedWord));
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
            <img src="/images/kiwi-suspicious.png" alt="Kiwi in Disguise" className="kiwi-icon" style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} />
            <span className="label">Round {game.currentRound} / {game.totalRounds}</span>
          </div>
          <div className="flex items-center gap-sm">
            <span className="badge badge-green">{game.phase.replace(/_/g, ' ')}</span>
            {isReconnecting && (
              <span className="badge badge-amber" style={{ fontSize: '0.65rem' }}>⚡ Reconnecting...</span>
            )}
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
            {(game.phase === 'CLUE_GIVING' || game.phase === 'VOTING') && (
              <div className="mb-lg">
                <CodeCard
                  isKiwi={isKiwi}
                  coordinate={isKiwi ? undefined : coordinate}
                  secretWord={isKiwi ? undefined : secretWord}
                />
              </div>
            )}

            {/* Topic Card */}
            {game.phase !== 'SCORING' && (
              <div className="card mb-lg">
                <TopicCard
                  words={wordTable.words}
                  secretWordIndex={isKiwi ? undefined : secretWordIdx}
                  showSecret={!isKiwi && (game.phase === 'CLUE_GIVING' || game.phase === 'VOTING')}
                  selectable={game.phase === 'KIWI_GUESS' && isKiwi}
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



            {/* VOTING phase */}
            {game.phase === 'VOTING' && (
              <div className="card mb-lg fade-in">
                <div className="flex justify-between items-center mb-md">
                  <h3 className="title-md">🗳️ Tap to Accuse</h3>
                  <div className={`vote-timer ${voteTimer <= 10 ? 'vote-timer-urgent' : ''}`}>
                    <svg viewBox="0 0 36 36" className="vote-timer-ring">
                      <circle cx="18" cy="18" r="16" fill="none" stroke="var(--border-subtle)" strokeWidth="2" />
                      <circle cx="18" cy="18" r="16" fill="none"
                        stroke={voteTimer <= 10 ? 'var(--red-400)' : 'var(--emerald-400)'}
                        strokeWidth="2.5" strokeDasharray={`${(voteTimer / 30) * 100.5} 100.5`}
                        strokeLinecap="round" transform="rotate(-90 18 18)" />
                    </svg>
                    <span className="vote-timer-text">{voteTimer}</span>
                  </div>
                </div>
                <p className="subtitle mb-md">
                  {game.players[playerId]?.vote
                    ? `Voted for ${game.players[game.players[playerId].vote]?.name ?? '...'} — tap another to change`
                    : 'Who do you think is the Kiwi?'}
                </p>

                {/* Clue recap during voting */}
                <div className="clue-recap mb-lg">
                  <button
                    className="btn btn-ghost btn-sm clue-recap-toggle"
                    id="btn-toggle-clues"
                    onClick={() => setShowRoasts(!showRoasts)}
                  >
                    {showRoasts ? '🔽 Hide Clues' : '🔎 Review Clues'}
                  </button>
                  {showRoasts && (
                    <div className="clue-roast-list mt-sm">
                      {game.turnOrder.map((pid) => {
                        const p = game.players[pid];
                        if (!p) return null;
                        return (
                          <div key={pid} className="clue-roast-item fade-in">
                            <div className="clue-roast-header">
                              <span className="clue-author">{p.name}:</span>
                              <span className="clue-text">"{p.clue}"</span>
                            </div>
                            <div className="clue-roast-text">
                              {clueRoasts[pid]}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <PlayerList
                  players={playerList}
                  currentPlayerId={playerId}
                  votable={voteTimer > 0 && !tieBreaker.picking}
                  votedId={votedPlayer || game.players[playerId]?.vote || undefined}
                  onVote={handleVoteForPlayer}
                  hideCheck={true}
                  showClues={true}
                />

                {voteTimer === 0 && !tieBreaker.picking && !tieBreaker.chosen && (
                  <div className="status-bar mt-md">⏰ Time's up! Tallying votes...</div>
                )}

                {tieBreaker.picking && tieBreaker.chosen && (
                  <TieBreakerAnimation
                    tied={tieBreaker.tied}
                    chosen={tieBreaker.chosen}
                    players={game.players}
                  />
                )}
              </div>
            )}

            {/* KIWI_GUESS phase */}
            {game.phase === 'KIWI_GUESS' && (
              <div className="card mb-lg fade-in">
                <h3 className="title-md mb-md">🥝 The Kiwi Was Caught!</h3>

                {isKiwi ? (
                  <>
                    <p className="subtitle mb-md">
                      🚨 Busted! But you've got one last trick — guess the secret word to escape!
                    </p>
                    {selectedGuess !== null && (
                      <button
                        className="btn btn-primary btn-lg btn-full mt-md"
                        onClick={handleKiwiGuess}
                        id="btn-kiwi-guess"
                      >
                        🎲 Guess: "{wordTable.words[selectedGuess]}"
                      </button>
                    )}
                  </>
                ) : (
                  <div className="status-bar">
                    <span className="pulse">●</span>
                    🥝 The Kiwi is sweating... picking a word...
                  </div>
                )}
              </div>
            )}

            {/* SCORING phase */}
            {game.phase === 'SCORING' && lastRound && (
              <div className="card mb-lg fade-in">
                {/* Celebration animations */}
                {lastRound.kiwiCaught && !lastRound.kiwiGuessedCorrectly && <Confetti />}
                {!lastRound.kiwiCaught && <KiwiEscape />}

                <div className="scoring-reveal text-center mb-lg">
                  <h3 className="title-lg mb-sm">Round {lastRound.round} Results</h3>

                  <div className="scoring-info mb-md">
                    <p>Secret Word: <strong className="highlight-word">{lastRound.secretWord}</strong></p>
                    <p>
                      Kiwi: <strong>{lastRound.kiwiName}</strong>
                      {lastRound.kiwiCaught
                        ? lastRound.kiwiGuessedCorrectly
                          ? <span className="badge badge-amber" style={{ marginLeft: 8 }}>Guessed correctly! 🥝</span>
                          : <span className="badge badge-green" style={{ marginLeft: 8 }}>Caught! 🎯</span>
                        : <span className="badge badge-red" style={{ marginLeft: 8 }}>Escaped! 💨</span>}
                    </p>
                  </div>
                </div>

                {/* Clue Roasts Reveal */}
                <div className="clue-roast-section mb-lg">
                  <h4 className="title-sm mb-sm">🔥 Clue Roasts</h4>
                  <div className="clue-roast-list">
                    {game.turnOrder.map((pid, i) => {
                      const p = game.players[pid];
                      if (!p) return null;
                      const isCham = pid === game.kiwiId;
                      return (
                        <div
                          key={pid}
                          className={`clue-roast-item fade-in ${isCham ? 'is-kiwi' : ''}`}
                          style={{ animationDelay: `${i * 0.1}s` }}
                        >
                          <div className="clue-roast-header">
                            <span className="clue-author">{p.name}{isCham ? ' 🥝' : ''}:</span>
                            <span className="clue-text">"{p.clue}"</span>
                          </div>
                          <div className="clue-roast-text">
                            {clueRoasts[pid]}
                          </div>
                        </div>
                      );
                    })}
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
              {game.phase === 'VOTING' && (
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
                showVoteCounts={game.phase === 'VOTING'}
                showVoteCheck={game.phase === 'VOTING'}
                voteCounts={voteCounts}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
