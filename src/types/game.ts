export type GamePhase =
  | 'LOBBY'
  | 'CLUE_GIVING'
  | 'VOTING'
  | 'KIWI_GUESS'
  | 'SCORING'
  | 'GAME_OVER'
  | 'ENDED';

export interface Player {
  id: string;
  name: string;
  score: number;
  clue: string;
  vote: string;
  hasSubmitted: boolean;
  isHost: boolean;
  isConnected: boolean;
}

export interface RoundResult {
  round: number;
  topic: string;
  secretWord: string;
  kiwiId: string;
  kiwiName: string;
  kiwiCaught: boolean;
  kiwiGuessedCorrectly: boolean;
  guessedWord?: string;
  scores: Record<string, number>;
}

export interface GameState {
  gameId: string;
  hostId: string;
  phase: GamePhase;
  currentRound: number;
  totalRounds: number;
  topicIndex: number;
  secretWordIndex: number;
  diceYellow: number;
  diceBlue: number;
  kiwiId: string;
  codeCardSetIndex: number;
  players: Record<string, Player>;
  turnOrder: string[];
  currentTurnIndex: number;
  kiwiGuess: string;
  roundHistory: RoundResult[];
  createdAt: number;
}

export interface TopicCard {
  topic: string;
  words: string[];
}

export type CodeCardMapping = Record<string, string>;
// Maps "yellow,blue" dice combo → grid coordinate like "A1", "B3", etc.
