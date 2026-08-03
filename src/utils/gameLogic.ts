import type { GameState, Player, RoundResult } from '../types/game';
import wordTables from '../data/words.json';
import { getCodeCardCount, getSecretWordIndex } from './codeCards';
import { v4 as uuidv4 } from 'uuid';

/** Maximum players per game — shared by lobby/join validation and UI. */
export const MAX_PLAYERS = 15;

/**
 * Generate a 6-character uppercase room code.
 */
export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I/O/0/1 to avoid confusion
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Roll a single die (1-6).
 */
export function rollDie(): number {
  return Math.floor(Math.random() * 6) + 1;
}

/**
 * Pick a random word table index, avoiding already-used indices.
 */
export function randomTableIndex(usedIndices: number[] = []): number {
  const used = new Set(usedIndices);
  const available = Array.from({ length: wordTables.length }, (_, i) => i).filter(i => !used.has(i));
  if (available.length === 0) return Math.floor(Math.random() * wordTables.length);
  return available[Math.floor(Math.random() * available.length)];
}

/**
 * Create a new player object.
 */
export function createPlayer(name: string, isHost: boolean = false): Player {
  return {
    id: uuidv4(),
    name,
    score: 0,
    clue: '',
    vote: '',
    hasSubmitted: false,
    isHost,
    isConnected: true,
  };
}

/**
 * Create a fresh game state for the lobby.
 */
export function createGameState(
  gameId: string,
  hostPlayer: Player,
  totalRounds: number = 5
): GameState {
  return {
    gameId,
    hostId: hostPlayer.id,
    phase: 'LOBBY',
    currentRound: 0,
    totalRounds,
    topicIndex: 0,
    secretWordIndex: 0,
    diceYellow: 1,
    diceBlue: 1,
    kiwiId: '',
    codeCardSetIndex: Math.floor(Math.random() * getCodeCardCount()),
    players: { [hostPlayer.id]: hostPlayer },
    turnOrder: [],
    currentTurnIndex: 0,
    kiwiGuess: '',
    roundHistory: [],
    createdAt: Date.now(),
  };
}

/**
 * Shuffle an array in place (Fisher-Yates).
 */
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Deal cards: assign one player as the kiwi, set dice, topic, and turn order.
 */
export function dealRound(state: GameState): Partial<GameState> {
  const playerIds = Object.keys(state.players);
  const kiwiId = playerIds[Math.floor(Math.random() * playerIds.length)];
  const usedIndices = state.usedTableIndices || [];
  const topicIndex = randomTableIndex(usedIndices);
  const diceYellow = rollDie();
  const diceBlue = rollDie();
  const turnOrder = shuffle(playerIds);

  // Reset player state for the new round
  const players = { ...state.players };
  for (const id of playerIds) {
    players[id] = {
      ...players[id],
      clue: '',
      vote: '',
      hasSubmitted: false,
    };
  }

  return {
    phase: 'CLUE_GIVING',
    currentRound: state.currentRound + 1,
    topicIndex,
    secretWordIndex: 0,
    diceYellow,
    diceBlue,
    kiwiId,
    codeCardSetIndex: Math.floor(Math.random() * getCodeCardCount()),
    turnOrder,
    currentTurnIndex: 0,
    kiwiGuess: '',
    players,
    usedTableIndices: [...usedIndices, topicIndex],
  };
}

/**
 * Check if all players have submitted their clues.
 */
export function allCluesSubmitted(state: GameState): boolean {
  return Object.values(state.players).every((p) => p.hasSubmitted);
}

/**
 * Check if all players have voted.
 */
export function allVotesSubmitted(state: GameState): boolean {
  return Object.values(state.players).every((p) => p.vote !== '');
}

/**
 * Tally votes and return the most-voted player ID.
 * In case of tie, returns null (host breaks tie).
 */
export function tallyVotes(state: GameState): { winnerId: string | null; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  for (const player of Object.values(state.players)) {
    if (player.vote) {
      counts[player.vote] = (counts[player.vote] || 0) + 1;
    }
  }

  let maxVotes = 0;
  let winners: string[] = [];
  for (const [id, count] of Object.entries(counts)) {
    if (count > maxVotes) {
      maxVotes = count;
      winners = [id];
    } else if (count === maxVotes) {
      winners.push(id);
    }
  }

  if (winners.length === 1) {
    return { winnerId: winners[0], counts };
  }
  return { winnerId: null, counts };
}

/**
 * Calculate scores for the round.
 */
export function calculateRoundScores(
  state: GameState,
  accusedId: string,
  kiwiGuessedCorrectly: boolean
): { scores: Record<string, number>; kiwiCaught: boolean } {
  const scores: Record<string, number> = {};
  const playerIds = Object.keys(state.players);
  const kiwiCaught = accusedId === state.kiwiId;

  // Who voted for the kiwi?
  const votedCorrectly = new Set(
    Object.values(state.players).filter(p => p.vote === state.kiwiId).map(p => p.id)
  );

  if (!kiwiCaught) {
    // Kiwi escapes: kiwi gets 3, correct voters still get 1 for spotting them
    for (const id of playerIds) {
      if (id === state.kiwiId) scores[id] = 3;
      else if (votedCorrectly.has(id)) scores[id] = 1;
      else scores[id] = 0;
    }
  } else if (kiwiGuessedCorrectly) {
    // Kiwi caught but guessed the word: kiwi gets 1, correct voters get 1
    for (const id of playerIds) {
      if (id === state.kiwiId) scores[id] = 1;
      else if (votedCorrectly.has(id)) scores[id] = 1;
      else scores[id] = 0;
    }
  } else {
    // Kiwi caught and failed to guess: correct voters get 2, kiwi gets 0
    for (const id of playerIds) {
      if (id === state.kiwiId) scores[id] = 0;
      else if (votedCorrectly.has(id)) scores[id] = 2;
      else scores[id] = 0;
    }
  }

  return { scores, kiwiCaught };
}

/**
 * Build round result for history.
 */
export function buildRoundResult(
  state: GameState,
  secretWord: string,
  kiwiCaught: boolean,
  kiwiGuessedCorrectly: boolean,
  scores: Record<string, number>,
  guessedWord?: string
): RoundResult {
  const kiwi = state.players[state.kiwiId];
  return {
    round: state.currentRound,
    secretWord,
    kiwiId: state.kiwiId,
    kiwiName: kiwi?.name || 'Unknown',
    kiwiCaught,
    kiwiGuessedCorrectly,
    guessedWord,
    scores,
  };
}

/**
 * Build the SCORING update that ends a round: applies round scores to all
 * players and appends the round result to history. Shared by every
 * local-mode resolution path (human vote, bot vote, human/bot kiwi guess).
 */
export function buildScoringUpdate(
  state: GameState,
  accusedId: string,
  kiwiGuessedCorrectly: boolean,
  guessedWord?: string
): Partial<GameState> {
  const { scores, kiwiCaught } = calculateRoundScores(state, accusedId, kiwiGuessedCorrectly);
  const wordTable = getWordTable(state.topicIndex);
  const secretIdx = getSecretWordIndex(state.codeCardSetIndex, state.diceYellow, state.diceBlue);
  const result = buildRoundResult(
    state, wordTable.words[secretIdx], kiwiCaught, kiwiGuessedCorrectly, scores, guessedWord
  );

  const players: Record<string, Player> = {};
  for (const [id, player] of Object.entries(state.players)) {
    players[id] = { ...player, score: (player.score || 0) + (scores[id] || 0) };
  }

  return {
    phase: 'SCORING',
    players,
    roundHistory: [...(state.roundHistory || []), result],
    ...(guessedWord !== undefined && { kiwiGuess: guessedWord }),
  };
}

/**
 * Resolve voting once every player has voted: advance to KIWI_GUESS if the
 * kiwi was accused, otherwise score the round (kiwi escapes).
 * Returns null while votes are still outstanding.
 */
export function resolveVotes(state: GameState): Partial<GameState> | null {
  if (!allVotesSubmitted(state)) return null;
  const { winnerId, counts } = tallyVotes(state);
  let accusedId: string;
  if (winnerId) {
    accusedId = winnerId;
  } else {
    // Tie: randomly pick one of the tied players
    const maxCount = Math.max(...Object.values(counts));
    const tied = Object.entries(counts).filter(([, c]) => c === maxCount).map(([id]) => id);
    accusedId = tied[Math.floor(Math.random() * tied.length)];
  }
  if (accusedId === state.kiwiId) return { phase: 'KIWI_GUESS' };
  return buildScoringUpdate(state, accusedId, false);
}

/**
 * Get word table data.
 */
export function getWordTable(index: number) {
  return wordTables[index % wordTables.length];
}

/**
 * Get all word tables.
 */
export function getAllWordTables() {
  return wordTables;
}
