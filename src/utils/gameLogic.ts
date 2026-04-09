import type { GameState, Player, RoundResult } from '../types/game';
import topicCards from '../data/words.json';
import { getCodeCardCount } from './codeCards';
import { v4 as uuidv4 } from 'uuid';

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
 * Pick a random topic index.
 */
export function randomTopicIndex(): number {
  return Math.floor(Math.random() * topicCards.length);
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
    chameleonId: '',
    codeCardSetIndex: Math.floor(Math.random() * getCodeCardCount()),
    players: { [hostPlayer.id]: hostPlayer },
    turnOrder: [],
    currentTurnIndex: 0,
    chameleonGuess: '',
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
 * Deal cards: assign one player as the chameleon, set dice, topic, and turn order.
 */
export function dealRound(state: GameState): Partial<GameState> {
  const playerIds = Object.keys(state.players);
  const chameleonId = playerIds[Math.floor(Math.random() * playerIds.length)];
  const topicIndex = randomTopicIndex();
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
    secretWordIndex: 0, // Will be computed per-player via code card
    diceYellow,
    diceBlue,
    chameleonId,
    codeCardSetIndex: Math.floor(Math.random() * getCodeCardCount()),
    turnOrder,
    currentTurnIndex: 0,
    chameleonGuess: '',
    players,
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
  chameleonGuessedCorrectly: boolean
): { scores: Record<string, number>; chameleonCaught: boolean } {
  const scores: Record<string, number> = {};
  const playerIds = Object.keys(state.players);
  const chameleonCaught = accusedId === state.chameleonId;

  if (!chameleonCaught) {
    // Chameleon escapes
    for (const id of playerIds) {
      scores[id] = id === state.chameleonId ? 2 : 0;
    }
  } else if (chameleonGuessedCorrectly) {
    // Chameleon caught but guessed the word
    for (const id of playerIds) {
      scores[id] = id === state.chameleonId ? 1 : 0;
    }
  } else {
    // Chameleon caught and failed to guess
    for (const id of playerIds) {
      scores[id] = id === state.chameleonId ? 0 : 2;
    }
  }

  return { scores, chameleonCaught };
}

/**
 * Build round result for history.
 */
export function buildRoundResult(
  state: GameState,
  secretWord: string,
  chameleonCaught: boolean,
  chameleonGuessedCorrectly: boolean,
  scores: Record<string, number>
): RoundResult {
  const chameleon = state.players[state.chameleonId];
  return {
    round: state.currentRound,
    topic: topicCards[state.topicIndex]?.topic || 'Unknown',
    secretWord,
    chameleonId: state.chameleonId,
    chameleonName: chameleon?.name || 'Unknown',
    chameleonCaught,
    chameleonGuessedCorrectly,
    scores,
  };
}

/**
 * Get topic card data.
 */
export function getTopicCard(index: number) {
  return topicCards[index % topicCards.length];
}

/**
 * Get all topic cards.
 */
export function getAllTopicCards() {
  return topicCards;
}
