import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import topicCardsData from './words.json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Types ──────────────────────────────────────────────
interface Player {
  id: string; name: string; score: number; clue: string; vote: string;
  hasSubmitted: boolean; isHost: boolean; isConnected: boolean;
}
interface GameState {
  gameId: string; hostId: string; phase: string;
  currentRound: number; totalRounds: number;
  topicIndex: number; secretWordIndex: number;
  diceYellow: number; diceBlue: number;
  chameleonId: string; codeCardSetIndex: number;
  players: Record<string, Player>;
  turnOrder: string[]; currentTurnIndex: number;
  chameleonGuess: string; roundHistory: unknown[];
  createdAt: number;
  lastScoredRound?: number; // Guard against double-scoring
}

type WsMessage =
  | { type: 'CREATE_GAME'; gameId: string; state: GameState }
  | { type: 'JOIN_GAME'; gameId: string }
  | { type: 'GET_GAME'; gameId: string }
  | { type: 'UPDATE_GAME'; gameId: string; updates: Partial<GameState> }
  | { type: 'UPDATE_PLAYER'; gameId: string; playerId: string; updates: Record<string, unknown> }
  | { type: 'DELETE_GAME'; gameId: string }
  | { type: 'SUBSCRIBE'; gameId: string }
  | { type: 'PING' };

// ── Game Store ─────────────────────────────────────────
const games = new Map<string, GameState>();
const subscribers = new Map<string, Set<WebSocket>>();

function broadcast(gameId: string) {
  const subs = subscribers.get(gameId);
  const state = games.get(gameId) || null;
  if (!subs) return;
  const msg = JSON.stringify({ type: 'GAME_STATE', gameId, state });
  for (const ws of subs) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

/**
 * Server-side: after a vote update, check if all players voted.
 * If so, advance to either CHAMELEON_GUESS or SCORING.
 * This prevents deadlocks in WS mode where the client store hasn't updated yet.
 */
function checkAllVotesAndAdvance(gameId: string) {
  const game = games.get(gameId);
  if (!game || game.phase !== 'VOTING') return;

  // Double-scoring guard: don't score the same round twice
  if (game.lastScoredRound !== undefined && game.lastScoredRound >= game.currentRound) {
    console.log(`⚠️ Skipping vote tally for game ${gameId} round ${game.currentRound} — already scored`);
    return;
  }

  const players = Object.values(game.players);
  const allVoted = players.every(p => p.vote !== '');
  if (!allVoted) return;

  // Tally votes (same logic as client)
  const counts: Record<string, number> = {};
  for (const p of players) {
    if (p.vote) counts[p.vote] = (counts[p.vote] || 0) + 1;
  }
  let maxVotes = 0;
  let winners: string[] = [];
  for (const [id, count] of Object.entries(counts)) {
    if (count > maxVotes) { maxVotes = count; winners = [id]; }
    else if (count === maxVotes) { winners.push(id); }
  }
  const accusedId = winners.length === 1 ? winners[0] : game.hostId;

  if (accusedId === game.chameleonId) {
    // Chameleon was caught — let them guess
    game.phase = 'CHAMELEON_GUESS';
  } else {
    // Wrong person accused — chameleon escapes, score immediately
    const scores: Record<string, number> = {};
    for (const id of Object.keys(game.players)) {
      scores[id] = id === game.chameleonId ? 2 : 0;
    }
    // Update scores
    for (const [id, pts] of Object.entries(scores)) {
      if (game.players[id]) {
        game.players[id].score = (game.players[id].score || 0) + pts;
      }
    }
    // Build round result
    // We need topic/secret word data — import the word list
    const topicCards = getTopicCards();
    const topicCard = topicCards[game.topicIndex % topicCards.length];
    const secretIdx = getSecretWordIndex(game.codeCardSetIndex, game.diceYellow, game.diceBlue);
    const secretWord = topicCard?.words?.[secretIdx] || 'Unknown';
    const chameleonName = game.players[game.chameleonId]?.name || 'Unknown';

    const result = {
      round: game.currentRound,
      topic: topicCard?.topic || 'Unknown',
      secretWord,
      chameleonId: game.chameleonId,
      chameleonName,
      chameleonCaught: false,
      chameleonGuessedCorrectly: false,
      scores,
    };
    game.roundHistory = [...(game.roundHistory || []), result];
    game.phase = 'SCORING';
    game.lastScoredRound = game.currentRound; // Mark as scored
  }

  games.set(gameId, { ...game });
  broadcast(gameId);
}

/**
 * Server-side: after chameleon guess, calculate scores and advance to SCORING.
 */
function handleChameleonGuessOnServer(gameId: string) {
  const game = games.get(gameId);
  if (!game || game.phase !== 'CHAMELEON_GUESS' || !game.chameleonGuess) return;

  // Double-scoring guard
  if (game.lastScoredRound !== undefined && game.lastScoredRound >= game.currentRound) {
    console.log(`⚠️ Skipping chameleon guess scoring for game ${gameId} round ${game.currentRound} — already scored`);
    return;
  }

  const topicCards = getTopicCards();
  const topicCard = topicCards[game.topicIndex % topicCards.length];
  const secretIdx = getSecretWordIndex(game.codeCardSetIndex, game.diceYellow, game.diceBlue);
  const secretWord = topicCard?.words?.[secretIdx] || 'Unknown';
  const guessedWord = game.chameleonGuess;
  const correct = guessedWord === secretWord;

  const scores: Record<string, number> = {};
  for (const id of Object.keys(game.players)) {
    if (!correct) {
      // Chameleon caught and failed
      scores[id] = id === game.chameleonId ? 0 : 2;
    } else {
      // Chameleon caught but guessed correctly
      scores[id] = id === game.chameleonId ? 1 : 0;
    }
  }

  for (const [id, pts] of Object.entries(scores)) {
    if (game.players[id]) game.players[id].score = (game.players[id].score || 0) + pts;
  }

  const result = {
    round: game.currentRound,
    topic: topicCard?.topic || 'Unknown',
    secretWord,
    chameleonId: game.chameleonId,
    chameleonName: game.players[game.chameleonId]?.name || 'Unknown',
    chameleonCaught: true,
    chameleonGuessedCorrectly: correct,
    guessedWord,
    scores,
  };
  game.roundHistory = [...(game.roundHistory || []), result];
  game.phase = 'SCORING';
  game.lastScoredRound = game.currentRound; // Mark as scored
  games.set(gameId, { ...game });
  broadcast(gameId);
}

// ── Code card / topic helpers (server side) ─────────────
function getTopicCards() {
  return topicCardsData;
}

const codeCards = [
  // Card 1
  {
    '1,1': 'A1', '1,2': 'C3', '1,3': 'B2', '1,4': 'D4', '1,5': 'A3', '1,6': 'B1',
    '2,1': 'D2', '2,2': 'A4', '2,3': 'C1', '2,4': 'B3', '2,5': 'D1', '2,6': 'A2',
    '3,1': 'B4', '3,2': 'D3', '3,3': 'A2', '3,4': 'C4', '3,5': 'B1', '3,6': 'A4',
    '4,1': 'C2', '4,2': 'B3', '4,3': 'D1', '4,4': 'A1', '4,5': 'C4', '4,6': 'D3',
    '5,1': 'A3', '5,2': 'C1', '5,3': 'B4', '5,4': 'D2', '5,5': 'A4', '5,6': 'C3',
    '6,1': 'B2', '6,2': 'D4', '6,3': 'C2', '6,4': 'A1', '6,5': 'B3', '6,6': 'D1',
  },
  // Card 2
  {
    '1,1': 'B3', '1,2': 'A1', '1,3': 'D2', '1,4': 'C4', '1,5': 'A2', '1,6': 'B4',
    '2,1': 'C1', '2,2': 'D4', '2,3': 'A3', '2,4': 'B1', '2,5': 'C3', '2,6': 'D2',
    '3,1': 'A4', '3,2': 'B2', '3,3': 'C1', '3,4': 'D3', '3,5': 'B4', '3,6': 'A1',
    '4,1': 'D1', '4,2': 'C3', '4,3': 'A2', '4,4': 'B3', '4,5': 'D4', '4,6': 'C2',
    '5,1': 'B1', '5,2': 'A4', '5,3': 'D3', '5,4': 'C2', '5,5': 'A1', '5,6': 'B2',
    '6,1': 'C4', '6,2': 'D1', '6,3': 'B4', '6,4': 'A3', '6,5': 'C1', '6,6': 'D4',
  },
  // Card 3
  {
    '1,1': 'D4', '1,2': 'B1', '1,3': 'A3', '1,4': 'C2', '1,5': 'D1', '1,6': 'A4',
    '2,1': 'A2', '2,2': 'C4', '2,3': 'B3', '2,4': 'D2', '2,5': 'A1', '2,6': 'C3',
    '3,1': 'C1', '3,2': 'A2', '3,3': 'D4', '3,4': 'B1', '3,5': 'C3', '3,6': 'B4',
    '4,1': 'B2', '4,2': 'D3', '4,3': 'C1', '4,4': 'A4', '4,5': 'B3', '4,6': 'D2',
    '5,1': 'A1', '5,2': 'B4', '5,3': 'D1', '5,4': 'C4', '5,5': 'A3', '5,6': 'B2',
    '6,1': 'D3', '6,2': 'C2', '6,3': 'A2', '6,4': 'B3', '6,5': 'D4', '6,6': 'A1',
  },
  // Card 4
  {
    '1,1': 'C2', '1,2': 'D1', '1,3': 'A4', '1,4': 'B3', '1,5': 'C4', '1,6': 'D3',
    '2,1': 'B1', '2,2': 'A3', '2,3': 'D4', '2,4': 'C1', '2,5': 'B2', '2,6': 'A4',
    '3,1': 'A2', '3,2': 'C3', '3,3': 'B4', '3,4': 'D2', '3,5': 'A1', '3,6': 'C4',
    '4,1': 'D3', '4,2': 'B2', '4,3': 'C1', '4,4': 'A3', '4,5': 'D4', '4,6': 'B1',
    '5,1': 'C4', '5,2': 'A1', '5,3': 'B3', '5,4': 'D1', '5,5': 'C2', '5,6': 'A3',
    '6,1': 'A4', '6,2': 'D2', '6,3': 'A1', '6,4': 'B4', '6,5': 'C3', '6,6': 'D1',
  },
  // Card 5
  {
    '1,1': 'A3', '1,2': 'B4', '1,3': 'C1', '1,4': 'D2', '1,5': 'A4', '1,6': 'B1',
    '2,1': 'D1', '2,2': 'C2', '2,3': 'A2', '2,4': 'B3', '2,5': 'D4', '2,6': 'C3',
    '3,1': 'B2', '3,2': 'A1', '3,3': 'D3', '3,4': 'C4', '3,5': 'B1', '3,6': 'A4',
    '4,1': 'C3', '4,2': 'D4', '4,3': 'B2', '4,4': 'A1', '4,5': 'C1', '4,6': 'D2',
    '5,1': 'A4', '5,2': 'B3', '5,3': 'C4', '5,4': 'D1', '5,5': 'A2', '5,6': 'B4',
    '6,1': 'D2', '6,2': 'C1', '6,3': 'A3', '6,4': 'B2', '6,5': 'D3', '6,6': 'C4',
  },
  // Card 6
  {
    '1,1': 'B4', '1,2': 'A2', '1,3': 'D1', '1,4': 'C3', '1,5': 'B2', '1,6': 'A1',
    '2,1': 'C4', '2,2': 'D3', '2,3': 'B1', '2,4': 'A4', '2,5': 'C2', '2,6': 'D1',
    '3,1': 'A1', '3,2': 'B3', '3,3': 'C4', '3,4': 'D2', '3,5': 'A3', '3,6': 'B4',
    '4,1': 'D4', '4,2': 'C1', '4,3': 'A3', '4,4': 'B2', '4,5': 'D1', '4,6': 'C3',
    '5,1': 'B1', '5,2': 'A4', '5,3': 'D2', '5,4': 'C1', '5,5': 'B3', '5,6': 'A2',
    '6,1': 'C2', '6,2': 'D4', '6,3': 'B3', '6,4': 'A1', '6,5': 'C4', '6,6': 'D3',
  },
  // Card 7
  {
    '1,1': 'D1', '1,2': 'C4', '1,3': 'B3', '1,4': 'A2', '1,5': 'D3', '1,6': 'C1',
    '2,1': 'A4', '2,2': 'B1', '2,3': 'C2', '2,4': 'D4', '2,5': 'A3', '2,6': 'B2',
    '3,1': 'C3', '3,2': 'D2', '3,3': 'A1', '3,4': 'B4', '3,5': 'C1', '3,6': 'D3',
    '4,1': 'B2', '4,2': 'A3', '4,3': 'D4', '4,4': 'C1', '4,5': 'B4', '4,6': 'A2',
    '5,1': 'D3', '5,2': 'C2', '5,3': 'A4', '5,4': 'B1', '5,5': 'D2', '5,6': 'C4',
    '6,1': 'A1', '6,2': 'B4', '6,3': 'C3', '6,4': 'D2', '6,5': 'A4', '6,6': 'B3',
  },
  // Card 8
  {
    '1,1': 'C1', '1,2': 'D3', '1,3': 'A2', '1,4': 'B4', '1,5': 'C3', '1,6': 'D2',
    '2,1': 'B2', '2,2': 'A4', '2,3': 'D1', '2,4': 'C3', '2,5': 'B1', '2,6': 'A1',
    '3,1': 'D4', '3,2': 'C1', '3,3': 'B3', '3,4': 'A2', '3,5': 'D2', '3,6': 'C4',
    '4,1': 'A3', '4,2': 'B2', '4,3': 'C4', '4,4': 'D1', '4,5': 'A1', '4,6': 'B3',
    '5,1': 'C2', '5,2': 'D4', '5,3': 'A1', '5,4': 'B3', '5,5': 'C4', '5,6': 'D1',
    '6,1': 'B4', '6,2': 'A3', '6,3': 'D2', '6,4': 'C2', '6,5': 'B1', '6,6': 'A4',
  },
];

function coordinateToIndex(coord: string): number {
  const row = coord.charCodeAt(0) - 65; // A=0, B=1, C=2, D=3
  const col = parseInt(coord[1]) - 1;   // 1=0, 2=1, 3=2, 4=3
  return row * 4 + col;
}

function getSecretWordIndex(codeCardIndex: number, diceYellow: number, diceBlue: number): number {
  const card = codeCards[codeCardIndex % codeCards.length] as Record<string, string>;
  const key = `${diceYellow},${diceBlue}`;
  const coord = card[key];
  if (!coord) return 0;
  return coordinateToIndex(coord);
}

function handleMessage(ws: WebSocket, raw: string) {
  let msg: WsMessage;
  try { msg = JSON.parse(raw); } catch { return; }

  // Handle ping/pong for heartbeat
  if (msg.type === 'PING') {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'PONG' }));
    }
    return;
  }

  switch (msg.type) {
    case 'CREATE_GAME': {
      games.set(msg.gameId, msg.state);
      broadcast(msg.gameId);
      break;
    }
    case 'GET_GAME': {
      const state = games.get(msg.gameId) || null;
      ws.send(JSON.stringify({ type: 'GAME_STATE', gameId: msg.gameId, state }));
      break;
    }
    case 'SUBSCRIBE': {
      if (!subscribers.has(msg.gameId)) subscribers.set(msg.gameId, new Set());
      subscribers.get(msg.gameId)!.add(ws);
      // Send current state immediately
      const state = games.get(msg.gameId) || null;
      ws.send(JSON.stringify({ type: 'GAME_STATE', gameId: msg.gameId, state }));
      break;
    }
    case 'UPDATE_GAME': {
      const current = games.get(msg.gameId);
      if (!current) {
        console.log(`⚠️ UPDATE_GAME for unknown game ${msg.gameId}`);
        break;
      }

      // === SCORE PROTECTION ===
      // During non-LOBBY phases, the server is authoritative for player scores.
      // Client updates that include players must NOT overwrite server-computed scores.
      if (msg.updates.players && current.players && current.phase !== 'LOBBY') {
        const isPlayAgainReset = msg.updates.phase === 'LOBBY';
        if (!isPlayAgainReset) {
          // Preserve server-side scores: copy current scores onto incoming player data
          for (const [id, incomingPlayer] of Object.entries(msg.updates.players)) {
            if (current.players[id] !== undefined) {
              (incomingPlayer as Player).score = current.players[id].score;
            }
          }
        }
        // If it's a Play Again reset (phase going to LOBBY), allow score reset to 0
      }

      // Reset lastScoredRound guard when returning to LOBBY (Play Again)
      if (msg.updates.phase === 'LOBBY') {
        delete (current as Record<string, unknown>).lastScoredRound;
      }

      // Handle players merge carefully:
      // - During LOBBY: merge players (add new joiners while keeping existing)
      //   BUT if player count decreased, it's a kick — use update as-is
      // - During gameplay: replace players entirely (dealRound/scoring sends complete state)
      if (msg.updates.players && current.players) {
        if (current.phase === 'LOBBY') {
          const updatePlayerCount = Object.keys(msg.updates.players).length;
          const currentPlayerCount = Object.keys(current.players).length;
          if (updatePlayerCount >= currentPlayerCount) {
            // Normal merge (player joined or state updated)
            const merged: Record<string, Player> = { ...current.players };
            for (const [id, p] of Object.entries(msg.updates.players)) {
              merged[id] = { ...(merged[id] || {}), ...p } as Player;
            }
            msg.updates.players = merged;
            const finalCount = Object.keys(merged).length;
            if (finalCount !== currentPlayerCount) {
              const names = Object.values(merged).map((p: Player) => p.name).join(', ');
              console.log(`👤 Game ${msg.gameId}: ${currentPlayerCount} → ${finalCount} players [${names}]`);
            }
          } else {
            const names = Object.values(msg.updates.players).map((p: Player) => p.name).join(', ');
            console.log(`🚫 Game ${msg.gameId}: kick ${currentPlayerCount} → ${updatePlayerCount} [${names}]`);
          }
          // else: kick — use msg.updates.players as-is (fewer players)
        }
        // During gameplay: use the update's players directly (no merge)
        // This is correct because dealRound and scoring send complete player objects
      }
      games.set(msg.gameId, { ...current, ...msg.updates } as GameState);
      broadcast(msg.gameId);

      // After UPDATE_GAME with chameleonGuess, check if we should advance
      const updated = games.get(msg.gameId);
      if (updated?.phase === 'CHAMELEON_GUESS' && updated.chameleonGuess) {
        handleChameleonGuessOnServer(msg.gameId);
      }
      break;
    }
    case 'UPDATE_PLAYER': {
      const cur = games.get(msg.gameId);
      if (!cur?.players[msg.playerId]) break;
      cur.players[msg.playerId] = {
        ...cur.players[msg.playerId],
        ...msg.updates,
      } as Player;

      // Never let client UPDATE_PLAYER overwrite scores during gameplay
      if (cur.phase !== 'LOBBY' && 'score' in msg.updates) {
        // Restore server-authoritative score — ignore client's score value
        delete (msg.updates as Record<string, unknown>).score;
        cur.players[msg.playerId] = {
          ...cur.players[msg.playerId],
          ...msg.updates,
        } as Player;
      }

      games.set(msg.gameId, { ...cur });
      broadcast(msg.gameId);

      // After a vote update, check if all voted
      if ('vote' in msg.updates) {
        checkAllVotesAndAdvance(msg.gameId);
      }
      break;
    }
    case 'DELETE_GAME': {
      // Set phase to ENDED so all clients know the game was stopped
      const game = games.get(msg.gameId);
      if (game) {
        game.phase = 'ENDED';
        games.set(msg.gameId, { ...game });
        broadcast(msg.gameId); // Tell everyone the game ended
      }
      // Then clean up after a short delay (let clients receive the ENDED state)
      setTimeout(() => {
        games.delete(msg.gameId);
        subscribers.delete(msg.gameId);
      }, 2000);
      break;
    }
  }
}

// ── Express + WebSocket Server ─────────────────────────
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Serve static frontend
app.use(express.static(path.join(__dirname, '../dist')));

// SPA fallback — serve index.html for all non-API routes (Express 5 syntax)
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

// WebSocket handling
wss.on('connection', (ws) => {
  ws.on('message', (data) => handleMessage(ws, data.toString()));
  ws.on('close', () => {
    // Remove from all subscriber lists
    for (const [, subs] of subscribers) {
      subs.delete(ws);
    }
  });
});

// ── Cleanup stale games (>2h old) ──────────────────────
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, game] of games) {
    if (game.createdAt < cutoff) {
      games.delete(id);
      subscribers.delete(id);
    }
  }
}, 60_000);

const PORT = parseInt(process.env.PORT || '3000', 10);
server.listen(PORT, () => {
  console.log(`🦎 Chameleon server running on port ${PORT}`);
  console.log(`   ${games.size} active games`);
});
