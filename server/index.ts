import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

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
}

type WsMessage =
  | { type: 'CREATE_GAME'; gameId: string; state: GameState }
  | { type: 'JOIN_GAME'; gameId: string }
  | { type: 'GET_GAME'; gameId: string }
  | { type: 'UPDATE_GAME'; gameId: string; updates: Partial<GameState> }
  | { type: 'UPDATE_PLAYER'; gameId: string; playerId: string; updates: Record<string, unknown> }
  | { type: 'DELETE_GAME'; gameId: string }
  | { type: 'SUBSCRIBE'; gameId: string };

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
    scores,
  };
  game.roundHistory = [...(game.roundHistory || []), result];
  game.phase = 'SCORING';
  games.set(gameId, { ...game });
  broadcast(gameId);
}

// ── Code card / topic helpers (server side) ─────────────
// Inline the word list reading
import { readFileSync } from 'fs';

let _topicCards: { topic: string; words: string[] }[] | null = null;
function getTopicCards() {
  if (_topicCards) return _topicCards;
  try {
    const fp = path.join(__dirname, '../src/data/words.json');
    _topicCards = JSON.parse(readFileSync(fp, 'utf8'));
  } catch {
    _topicCards = [];
  }
  return _topicCards!;
}

// Code card sets (same as client codeCards.ts)
const codeCardSets = [
  [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],
  [3,0,1,2,7,4,5,6,11,8,9,10,15,12,13,14],
  [15,14,13,12,11,10,9,8,7,6,5,4,3,2,1,0],
  [12,13,14,15,8,9,10,11,4,5,6,7,0,1,2,3],
  [1,3,0,2,5,7,4,6,9,11,8,10,13,15,12,14],
  [2,0,3,1,6,4,7,5,10,8,11,9,14,12,15,13],
];

function getSecretWordIndex(setIndex: number, diceY: number, diceB: number): number {
  const set = codeCardSets[setIndex % codeCardSets.length];
  const row = ((diceY - 1) % 4);
  const col = ((diceB - 1) % 4);
  const gridIndex = row * 4 + col;
  return set[gridIndex];
}

function handleMessage(ws: WebSocket, raw: string) {
  let msg: WsMessage;
  try { msg = JSON.parse(raw); } catch { return; }

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
      if (!current) break;
      // Deep merge players — but if a player was removed (kick), use the update directly
      if (msg.updates.players && current.players) {
        const updatePlayerCount = Object.keys(msg.updates.players).length;
        const currentPlayerCount = Object.keys(current.players).length;
        if (updatePlayerCount < currentPlayerCount) {
          // Player was kicked — use the update's players as-is (don't merge back removed players)
          // no-op: msg.updates.players already has the correct set
        } else {
          // Normal merge (player added or updated)
          const merged: Record<string, Player> = { ...current.players };
          for (const [id, p] of Object.entries(msg.updates.players)) {
            merged[id] = { ...(merged[id] || {}), ...p } as Player;
          }
          msg.updates.players = merged;
        }
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
