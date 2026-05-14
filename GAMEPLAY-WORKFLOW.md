# 🦎 Chameleon — Gameplay Workflow Rules

> Official gameplay state machine and edge case reference for the Chameleon multiplayer word game.

---

## 📋 Game Phases (State Machine)

```
LOBBY → DEALING → CLUE_GIVING → DISCUSSION → VOTING → REVEAL → SCORING → [GAME_OVER | next round]
                                                   ↘ CHAMELEON_GUESS → SCORING
```

### Phase Transitions

| From | To | Trigger | Who Triggers |
|------|----|---------|-------------|
| `LOBBY` | `CLUE_GIVING` | Host clicks "Start Game" (≥3 players) | Host |
| `CLUE_GIVING` | `DISCUSSION` | All players submit clues (sequential turn order) | Automatic |
| `DISCUSSION` | `VOTING` | Host clicks "Start Voting" | Host |
| `VOTING` | `CHAMELEON_GUESS` | All votes cast AND majority vote = chameleon | Automatic |
| `VOTING` | `SCORING` | All votes cast AND majority vote ≠ chameleon (escape) | Automatic |
| `CHAMELEON_GUESS` | `SCORING` | Chameleon selects a word from the topic grid | Chameleon player |
| `SCORING` | `CLUE_GIVING` | Host clicks "Next Round" (if rounds remaining) | Host |
| `SCORING` | `GAME_OVER` | Host clicks "See Final Results" (last round) | Host |
| `GAME_OVER` | `LOBBY` | Host clicks "Play Again with Everyone" | Host |
| Any | `ENDED` | Host clicks "End Game" / leaves | Host |

---

## 🎮 Detailed Phase Rules

### 1. LOBBY
- **Min players**: 3
- **Max players**: 10
- **Host controls**: Set number of rounds (3, 5, 7, or 10), add bots (local mode), kick players
- **Non-host**: See waiting quips, can leave game
- **Join methods**: Direct URL (`/join/:roomCode`), room code entry from home, or share link
- **Room code**: 6 uppercase alphanumeric characters (excludes I, O, 0, 1 to avoid confusion)
- **Validations**:
  - Cannot join a game that's already started (phase ≠ LOBBY)
  - Cannot join a full game (10 players)
  - Player name required (max 20 chars)
  - Duplicate names allowed (different UUIDs)

### 2. CLUE_GIVING (a.k.a. "DEALING + CLUE")
- **Setup (automatic)**:
  - Random chameleon assigned (1 of N players)
  - Random topic card selected (from 20+ topics, each with 16 words)
  - Dice rolled (yellow: 1-6, blue: 1-6)
  - Random code card selected (from 8 code cards)
  - Secret word determined by: code card[dice yellow, dice blue] → grid coordinate → word index
  - Turn order shuffled randomly
- **What players see**:
  - **Regular players**: Topic card with secret word highlighted, code card showing coordinate
  - **Chameleon**: Topic card (no highlight), code card showing "YOU ARE THE CHAMELEON 🦎"
- **Turn-based clue submission**:
  - Each player gives a one-word clue when it's their turn
  - Clue input appears only when it's your turn
  - Max clue length: 30 characters
  - Submitted clues appear as bubbles for all players
  - Bots auto-submit random clues (local mode only)
- **Phase advances when**: All players have submitted (currentTurnIndex ≥ turnOrder.length)

### 3. DISCUSSION
- **All clues displayed** as bubbles with player names
- **Host-only control**: "Start Voting" button
- **Non-host**: See "Waiting for host to start voting..." message
- **Clue roasts**: Witty commentary on each clue generated via rule-based system
- **No time limit** — host decides when discussion is sufficient

### 4. VOTING
- **All players vote** — vote for who they think is the chameleon
- **Cannot vote for yourself**
- **Clue review**: Expandable section to review clues with roasts
- **Vote display**: Selected player highlighted, "Accuse [name]!" button appears
- **Vote tally**:
  - Majority wins (single highest vote count)
  - **Tie-breaking**: If tied, host's ID is used as tiebreaker (accused = hostId)
- **Phase advancement (automatic)**:
  - **Local mode**: Client-side tally after all votes
  - **WS mode**: Server tallies after each vote update, advances when all voted
- **Outcomes**:
  - **Accused = Chameleon** → `CHAMELEON_GUESS` phase
  - **Accused ≠ Chameleon** → `SCORING` phase (chameleon escapes)

### 5. CHAMELEON_GUESS
- **Only chameleon interacts**: Word grid becomes selectable
- **Other players see**: "The Chameleon is sweating... picking a word..."
- **Chameleon picks a word** from the topic grid and clicks "Guess: [word]"
- **Outcomes**:
  - **Correct guess**: Chameleon scores partial escape points
  - **Wrong guess**: Team scores full catch points
- **Phase advancement**: After guess submitted → `SCORING`

### 6. SCORING
- **Round results displayed**:
  - Topic name
  - Secret word (revealed)
  - Chameleon identity (revealed)
  - Outcome badge: "Caught! 🎯", "Escaped! 💨", or "Guessed correctly! 🦎"
- **Animations**:
  - Confetti: When chameleon caught and failed to guess
  - Chameleon Escape animation: When chameleon escapes
- **Clue roasts revealed** for all players (chameleon's clue highlighted)
- **Scoreboard**: Shows cumulative scores for all players
- **Host controls**:
  - "Next Round (X/Y)" if rounds remaining
  - "🏆 See Final Results" if final round

### 7. GAME_OVER
- **Auto-navigates** to `/results/:roomCode`
- **Shows**:
  - Winner announcement with witty message
  - Full scoreboard with all round history
  - Final standings sorted by score
- **Host sees**: "🔄 Play Again with Everyone" button
- **Non-host sees**: "Waiting for host to start a new game..."
- **Leave button**: Available to all players

---

## 📊 Scoring Rules

| Scenario | Chameleon Score | Other Players Score |
|----------|----------------|-------------------|
| Chameleon **escapes** (voted for wrong person) | **+2** | +0 |
| Chameleon **caught**, guesses word **incorrectly** | +0 | **+2** |
| Chameleon **caught**, guesses word **correctly** | **+1** | +0 |

---

## 🤖 Bot Behavior (Local Mode)

| Phase | Bot Action | Timing |
|-------|-----------|--------|
| `CLUE_GIVING` | Auto-submit random clue word | When it's the bot's turn (800ms interval) |
| `VOTING` | Auto-vote for random non-self player | After human votes (800ms interval) |
| `CHAMELEON_GUESS` | Auto-pick random word from topic | If chameleon is a bot (800ms interval) |

---

## 🔒 Edge Cases & Guard Rails

### Player Management
- **Kicked player detection**: If player ID removed from game.players during LOBBY → redirect home
- **Session persistence**: gameId, playerId, playerName stored in localStorage
- **Stale session handling**: If arriving at `/join/` for a different game than stored, clear old playerId
- **Game ended detection**: If phase === 'ENDED' or game === null (and previously had game) → redirect home

### Vote Deadlock Prevention
- **Server-side (WS)**: Server tallies votes after each UPDATE_PLAYER with vote, advances automatically
- **Client-side (Local)**: Bot interval polls for all-voted state, advances if all voted
- **Tie handling**: Falls back to hostId as the accused player (ensures the game always advances)

### State Synchronization
- **WS mode**: Server broadcasts full game state on every change
- **Local mode**: In-memory state with subscriber pattern, setTimeout to avoid sync loops
- **Deep merge**: Player objects merged carefully (LOBBY = additive merge; gameplay = replace)

### Navigation Guards
- **Play page**: Redirects to results on GAME_OVER, to lobby on LOBBY (play again), home on ENDED
- **Lobby page**: Redirects to play when phase ≠ LOBBY and ≠ ENDED
- **Results page**: Redirects to lobby when phase goes back to LOBBY (play again)

### Play Again Flow
1. Host clicks "Play Again with Everyone"
2. All player scores reset to 0, clues/votes cleared
3. Phase set to LOBBY, round counters reset
4. All players auto-navigate from `/results/` to `/lobby/`
5. Host can change round count and start new game
6. Same room code preserved

---

## 🔧 Technical Architecture

```
┌─────────────────────────────────────────────┐
│  Frontend (React + Zustand)                 │
│  ├── Home.tsx     → Create/Join             │
│  ├── Lobby.tsx    → Wait + Config           │
│  ├── Play.tsx     → All game phases         │
│  └── Results.tsx  → Final scoreboard        │
├─────────────────────────────────────────────┤
│  Game API Layer (gameApi.ts)                │
│  ├── Local Provider (localProvider.ts)      │
│  │   └── In-memory state + subscribers      │
│  └── WS Provider (wsProvider.ts)            │
│       └── WebSocket ↔ Express server        │
├─────────────────────────────────────────────┤
│  Server (server/index.ts)                   │
│  ├── WebSocket message handler              │
│  ├── Server-side vote tally + advancement   │
│  ├── Server-side chameleon guess scoring    │
│  └── 2hr stale game cleanup                 │
└─────────────────────────────────────────────┘
```

---

## ✅ Test Coverage Matrix

| Area | Tests | Player Counts |
|------|-------|--------------|
| Home page | 5 | N/A |
| Lobby | 10 | 1-10 |
| Gameplay basics | 8 | 3, 5, 8, 10 |
| Voting workflow | 5 | 3 |
| Chameleon escape/catch | 2 | 10 |
| Full game (5 rounds) | 1 | 10 |
| Play again flow | 1 | 4 |
| Stress tests (local) | 5 | 10 |
| Multiplayer stress (WS) | 10 | 10 |
| Extended UI | 32 | 3-10 |
| Edge cases | 5 | Various |
| **Total** | **108** | |

---

*Last updated: May 2026*
