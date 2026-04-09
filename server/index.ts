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
      // Deep merge players
      if (msg.updates.players && current.players) {
        const merged: Record<string, Player> = { ...current.players };
        for (const [id, p] of Object.entries(msg.updates.players)) {
          merged[id] = { ...(merged[id] || {}), ...p } as Player;
        }
        msg.updates.players = merged;
      }
      games.set(msg.gameId, { ...current, ...msg.updates } as GameState);
      broadcast(msg.gameId);
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
