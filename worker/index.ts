import { DurableObject } from 'cloudflare:workers';
import wordTablesData from '../src/data/words.json';

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
  kiwiId: string; codeCardSetIndex: number;
  players: Record<string, Player>;
  turnOrder: string[]; currentTurnIndex: number;
  kiwiGuess: string; roundHistory: unknown[];
  createdAt: number;
  lastScoredRound?: number;
}

type WsMessage =
  | { type: 'CREATE_GAME'; gameId: string; state: GameState }
  | { type: 'GET_GAME'; gameId: string }
  | { type: 'UPDATE_GAME'; gameId: string; updates: Partial<GameState> }
  | { type: 'UPDATE_PLAYER'; gameId: string; playerId: string; updates: Record<string, unknown> }
  | { type: 'DELETE_GAME'; gameId: string }
  | { type: 'SUBSCRIBE'; gameId: string }
  | { type: 'PING' };

interface Env {
  ASSETS: Fetcher;
  GAME_ROOMS: DurableObjectNamespace;
}

// ── Code cards (same as server/index.ts) ──────────────
const codeCards: Record<string, string>[] = [
  { '1,1':'A1','1,2':'C3','1,3':'B2','1,4':'D4','1,5':'A3','1,6':'B1','2,1':'D2','2,2':'A4','2,3':'C1','2,4':'B3','2,5':'D1','2,6':'A2','3,1':'B4','3,2':'D3','3,3':'A2','3,4':'C4','3,5':'B1','3,6':'A4','4,1':'C2','4,2':'B3','4,3':'D1','4,4':'A1','4,5':'C4','4,6':'D3','5,1':'A3','5,2':'C1','5,3':'B4','5,4':'D2','5,5':'A4','5,6':'C3','6,1':'B2','6,2':'D4','6,3':'C2','6,4':'A1','6,5':'B3','6,6':'D1' },
  { '1,1':'B3','1,2':'A1','1,3':'D2','1,4':'C4','1,5':'A2','1,6':'B4','2,1':'C1','2,2':'D4','2,3':'A3','2,4':'B1','2,5':'C3','2,6':'D2','3,1':'A4','3,2':'B2','3,3':'C1','3,4':'D3','3,5':'B4','3,6':'A1','4,1':'D1','4,2':'C3','4,3':'A2','4,4':'B3','4,5':'D4','4,6':'C2','5,1':'B1','5,2':'A4','5,3':'D3','5,4':'C2','5,5':'A1','5,6':'B2','6,1':'C4','6,2':'D1','6,3':'B4','6,4':'A3','6,5':'C1','6,6':'D4' },
  { '1,1':'D4','1,2':'B1','1,3':'A3','1,4':'C2','1,5':'D1','1,6':'A4','2,1':'A2','2,2':'C4','2,3':'B3','2,4':'D2','2,5':'A1','2,6':'C3','3,1':'C1','3,2':'A2','3,3':'D4','3,4':'B1','3,5':'C3','3,6':'B4','4,1':'B2','4,2':'D3','4,3':'C1','4,4':'A4','4,5':'B3','4,6':'D2','5,1':'A1','5,2':'B4','5,3':'D1','5,4':'C4','5,5':'A3','5,6':'B2','6,1':'D3','6,2':'C2','6,3':'A2','6,4':'B3','6,5':'D4','6,6':'A1' },
  { '1,1':'C2','1,2':'D1','1,3':'A4','1,4':'B3','1,5':'C4','1,6':'D3','2,1':'B1','2,2':'A3','2,3':'D4','2,4':'C1','2,5':'B2','2,6':'A4','3,1':'A2','3,2':'C3','3,3':'B4','3,4':'D2','3,5':'A1','3,6':'C4','4,1':'D3','4,2':'B2','4,3':'C1','4,4':'A3','4,5':'D4','4,6':'B1','5,1':'C4','5,2':'A1','5,3':'B3','5,4':'D1','5,5':'C2','5,6':'A3','6,1':'A4','6,2':'D2','6,3':'A1','6,4':'B4','6,5':'C3','6,6':'D1' },
  { '1,1':'A3','1,2':'B4','1,3':'C1','1,4':'D2','1,5':'A4','1,6':'B1','2,1':'D1','2,2':'C2','2,3':'A2','2,4':'B3','2,5':'D4','2,6':'C3','3,1':'B2','3,2':'A1','3,3':'D3','3,4':'C4','3,5':'B1','3,6':'A4','4,1':'C3','4,2':'D4','4,3':'B2','4,4':'A1','4,5':'C1','4,6':'D2','5,1':'A4','5,2':'B3','5,3':'C4','5,4':'D1','5,5':'A2','5,6':'B4','6,1':'D2','6,2':'C1','6,3':'A3','6,4':'B2','6,5':'D3','6,6':'C4' },
  { '1,1':'B4','1,2':'A2','1,3':'D1','1,4':'C3','1,5':'B2','1,6':'A1','2,1':'C4','2,2':'D3','2,3':'B1','2,4':'A4','2,5':'C2','2,6':'D1','3,1':'A1','3,2':'B3','3,3':'C4','3,4':'D2','3,5':'A3','3,6':'B4','4,1':'D4','4,2':'C1','4,3':'A3','4,4':'B2','4,5':'D1','4,6':'C3','5,1':'B1','5,2':'A4','5,3':'D2','5,4':'C1','5,5':'B3','5,6':'A2','6,1':'C2','6,2':'D4','6,3':'B3','6,4':'A1','6,5':'C4','6,6':'D3' },
  { '1,1':'D1','1,2':'C4','1,3':'B3','1,4':'A2','1,5':'D3','1,6':'C1','2,1':'A4','2,2':'B1','2,3':'C2','2,4':'D4','2,5':'A3','2,6':'B2','3,1':'C3','3,2':'D2','3,3':'A1','3,4':'B4','3,5':'C1','3,6':'D3','4,1':'B2','4,2':'A3','4,3':'D4','4,4':'C1','4,5':'B4','4,6':'A2','5,1':'D3','5,2':'C2','5,3':'A4','5,4':'B1','5,5':'D2','5,6':'C4','6,1':'A1','6,2':'B4','6,3':'C3','6,4':'D2','6,5':'A4','6,6':'B3' },
  { '1,1':'C1','1,2':'D3','1,3':'A2','1,4':'B4','1,5':'C3','1,6':'D2','2,1':'B2','2,2':'A4','2,3':'D1','2,4':'C3','2,5':'B1','2,6':'A1','3,1':'D4','3,2':'C1','3,3':'B3','3,4':'A2','3,5':'D2','3,6':'C4','4,1':'A3','4,2':'B2','4,3':'C4','4,4':'D1','4,5':'A1','4,6':'B3','5,1':'C2','5,2':'D4','5,3':'A1','5,4':'B3','5,5':'C4','5,6':'D1','6,1':'B4','6,2':'A3','6,3':'D2','6,4':'C2','6,5':'B1','6,6':'A4' },
];

function coordinateToIndex(coord: string): number {
  const row = coord.charCodeAt(0) - 65;
  const col = parseInt(coord[1]) - 1;
  return row * 4 + col;
}

function getSecretWordIndex(codeCardIndex: number, diceYellow: number, diceBlue: number): number {
  const card = codeCards[codeCardIndex % codeCards.length];
  const key = `${diceYellow},${diceBlue}`;
  const coord = card[key];
  if (!coord) return 0;
  return coordinateToIndex(coord);
}

// ── Durable Object: GameRoom ──────────────────────────
export class GameRoom extends DurableObject<Env> {
  private games = new Map<string, GameState>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const alarm = await ctx.storage.getAlarm();
      if (!alarm) await ctx.storage.setAlarm(Date.now() + 5 * 60 * 1000);
    });
  }

  // ── Storage helpers ──
  private async getGame(gameId: string): Promise<GameState | null> {
    if (this.games.has(gameId)) return this.games.get(gameId)!;
    const stored = await this.ctx.storage.get<GameState>(`game:${gameId}`);
    if (stored) this.games.set(gameId, stored);
    return stored || null;
  }

  private async setGame(gameId: string, state: GameState): Promise<void> {
    this.games.set(gameId, state);
    await this.ctx.storage.put(`game:${gameId}`, state);
  }

  private async removeGame(gameId: string): Promise<void> {
    this.games.delete(gameId);
    await this.ctx.storage.delete(`game:${gameId}`);
  }

  // ── Broadcast to subscribers ──
  private async broadcastGame(gameId: string): Promise<void> {
    const state = await this.getGame(gameId);
    const msg = JSON.stringify({ type: 'GAME_STATE', gameId, state });
    for (const ws of this.ctx.getWebSockets()) {
      const data = ws.deserializeAttachment() as { subs?: string[] } | null;
      if (data?.subs?.includes(gameId)) {
        try { ws.send(msg); } catch { /* dead socket */ }
      }
    }
  }

  private addSubscription(ws: WebSocket, gameId: string): void {
    const data = (ws.deserializeAttachment() as { subs?: string[] } | null) || {};
    const subs = data.subs || [];
    if (!subs.includes(gameId)) {
      subs.push(gameId);
      ws.serializeAttachment({ ...data, subs });
    }
  }

  // ── Vote resolution (same logic as server/index.ts) ──
  private async checkAllVotesAndAdvance(gameId: string): Promise<void> {
    const game = await this.getGame(gameId);
    if (!game || game.phase !== 'VOTING') return;
    if (game.lastScoredRound !== undefined && game.lastScoredRound >= game.currentRound) return;

    const players = Object.values(game.players);
    if (!players.every(p => p.vote !== '')) return;

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
    const accusedId = winners[Math.floor(Math.random() * winners.length)];

    if (accusedId === game.kiwiId) {
      game.phase = 'KIWI_GUESS';
    } else {
      const votedCorrectly = new Set(
        Object.values(game.players).filter(p => p.vote === game.kiwiId).map(p => p.id)
      );
      const scores: Record<string, number> = {};
      for (const id of Object.keys(game.players)) {
        if (id === game.kiwiId) scores[id] = 3;
        else if (votedCorrectly.has(id)) scores[id] = 1;
        else scores[id] = 0;
      }
      for (const [id, pts] of Object.entries(scores)) {
        if (game.players[id]) game.players[id].score += pts;
      }
      const wordTable = wordTablesData[game.topicIndex % wordTablesData.length];
      const secretIdx = getSecretWordIndex(game.codeCardSetIndex, game.diceYellow, game.diceBlue);
      game.roundHistory = [...(game.roundHistory || []), {
        round: game.currentRound,
        secretWord: wordTable?.words?.[secretIdx] || 'Unknown',
        kiwiId: game.kiwiId,
        kiwiName: game.players[game.kiwiId]?.name || 'Unknown',
        kiwiCaught: false,
        kiwiGuessedCorrectly: false,
        scores,
      }];
      game.phase = 'SCORING';
      game.lastScoredRound = game.currentRound;
    }

    await this.setGame(gameId, game);
    await this.broadcastGame(gameId);
  }

  private async handleKiwiGuess(gameId: string): Promise<void> {
    const game = await this.getGame(gameId);
    if (!game || game.phase !== 'KIWI_GUESS' || !game.kiwiGuess) return;
    if (game.lastScoredRound !== undefined && game.lastScoredRound >= game.currentRound) return;

    const wordTable = wordTablesData[game.topicIndex % wordTablesData.length];
    const secretIdx = getSecretWordIndex(game.codeCardSetIndex, game.diceYellow, game.diceBlue);
    const secretWord = wordTable?.words?.[secretIdx] || 'Unknown';
    const correct = game.kiwiGuess === secretWord;

    const votedCorrectly = new Set(
      Object.values(game.players).filter(p => p.vote === game.kiwiId).map(p => p.id)
    );
    const scores: Record<string, number> = {};
    for (const id of Object.keys(game.players)) {
      if (!correct) {
        if (id === game.kiwiId) scores[id] = 0;
        else if (votedCorrectly.has(id)) scores[id] = 2;
        else scores[id] = 0;
      } else {
        if (id === game.kiwiId) scores[id] = 1;
        else if (votedCorrectly.has(id)) scores[id] = 1;
        else scores[id] = 0;
      }
    }
    for (const [id, pts] of Object.entries(scores)) {
      if (game.players[id]) game.players[id].score += pts;
    }

    game.roundHistory = [...(game.roundHistory || []), {
      round: game.currentRound,
      secretWord,
      kiwiId: game.kiwiId,
      kiwiName: game.players[game.kiwiId]?.name || 'Unknown',
      kiwiCaught: true,
      kiwiGuessedCorrectly: correct,
      guessedWord: game.kiwiGuess,
      scores,
    }];
    game.phase = 'SCORING';
    game.lastScoredRound = game.currentRound;

    await this.setGame(gameId, game);
    await this.broadcastGame(gameId);
  }

  // ── WebSocket lifecycle (Hibernation API) ──
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    let msg: WsMessage;
    try { msg = JSON.parse(message); } catch { return; }

    switch (msg.type) {
      case 'PING':
        ws.send(JSON.stringify({ type: 'PONG' }));
        break;

      case 'CREATE_GAME':
        await this.setGame(msg.gameId, msg.state);
        this.addSubscription(ws, msg.gameId);
        await this.broadcastGame(msg.gameId);
        break;

      case 'GET_GAME': {
        const state = await this.getGame(msg.gameId);
        ws.send(JSON.stringify({ type: 'GAME_STATE', gameId: msg.gameId, state }));
        break;
      }

      case 'SUBSCRIBE':
        this.addSubscription(ws, msg.gameId);
        {
          const state = await this.getGame(msg.gameId);
          ws.send(JSON.stringify({ type: 'GAME_STATE', gameId: msg.gameId, state }));
        }
        break;

      case 'UPDATE_GAME': {
        const current = await this.getGame(msg.gameId);
        if (!current) break;

        // Score protection: server is authoritative during gameplay
        if (msg.updates.players && current.players && current.phase !== 'LOBBY') {
          if (msg.updates.phase !== 'LOBBY') {
            for (const [id, incoming] of Object.entries(msg.updates.players)) {
              if (current.players[id] !== undefined) {
                (incoming as Player).score = current.players[id].score;
              }
            }
          }
        }

        if (msg.updates.phase === 'LOBBY') {
          delete (current as Record<string, unknown>).lastScoredRound;
        }

        // Player merge in LOBBY (join/kick logic)
        if (msg.updates.players && current.players && current.phase === 'LOBBY') {
          const updateCount = Object.keys(msg.updates.players).length;
          const currentCount = Object.keys(current.players).length;
          if (updateCount >= currentCount) {
            const merged: Record<string, Player> = { ...current.players };
            for (const [id, p] of Object.entries(msg.updates.players)) {
              merged[id] = { ...(merged[id] || {}), ...p } as Player;
            }
            msg.updates.players = merged;
          }
        }

        const updated = { ...current, ...msg.updates } as GameState;
        await this.setGame(msg.gameId, updated);
        await this.broadcastGame(msg.gameId);

        if (updated.phase === 'KIWI_GUESS' && updated.kiwiGuess) {
          await this.handleKiwiGuess(msg.gameId);
        }
        break;
      }

      case 'UPDATE_PLAYER': {
        const cur = await this.getGame(msg.gameId);
        if (!cur?.players[msg.playerId]) break;

        const updates = { ...msg.updates };
        if (cur.phase !== 'LOBBY') delete updates.score;

        cur.players[msg.playerId] = { ...cur.players[msg.playerId], ...updates } as Player;
        await this.setGame(msg.gameId, cur);
        await this.broadcastGame(msg.gameId);

        if ('vote' in msg.updates) {
          await this.checkAllVotesAndAdvance(msg.gameId);
        }
        break;
      }

      case 'DELETE_GAME': {
        const game = await this.getGame(msg.gameId);
        if (game) {
          game.phase = 'ENDED';
          await this.setGame(msg.gameId, game);
          await this.broadcastGame(msg.gameId);
          await this.removeGame(msg.gameId);
        }
        break;
      }
    }
  }

  async webSocketClose(): Promise<void> {}
  async webSocketError(): Promise<void> {}

  // ── Stale game cleanup ──
  async alarm(): Promise<void> {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    const all = await this.ctx.storage.list<GameState>({ prefix: 'game:' });
    for (const [key, game] of all) {
      if (game.createdAt < cutoff) {
        this.games.delete(key.slice(5));
        await this.ctx.storage.delete(key);
      }
    }
    await this.ctx.storage.setAlarm(Date.now() + 5 * 60 * 1000);
  }
}

// ── Worker entry point ────────────────────────────────
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      const id = env.GAME_ROOMS.idFromName('global');
      return env.GAME_ROOMS.get(id).fetch(request);
    }

    const response = await env.ASSETS.fetch(request);
    if (response.status === 404) {
      return env.ASSETS.fetch(new Request(new URL('/', request.url), request));
    }
    return response;
  },
};
