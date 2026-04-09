# 🦎 Chameleon — Online Multiplayer Word Game

A real-time multiplayer party game based on the hit board game by Big Potato Games. One player is secretly the Chameleon — they don't know the secret word and must bluff their way through!

## 🎮 How to Play

1. **Create a game** and share the room code with friends (3–10 players)
2. Everyone sees a topic card with 16 words — except the **Chameleon** who doesn't know the secret word
3. Players take turns giving **one-word clues** related to the secret word
4. **Discuss** who you think the Chameleon is
5. **Vote** to accuse someone — if caught, the Chameleon gets one chance to guess the word!

## 🚀 Quick Start

```bash
# Install dependencies
npm install
cd server && npm install && cd ..

# Run with multiplayer (WebSocket server + Vite)
npm run dev

# Or run with bots only (no server needed)
npm run dev:local
```

Open http://localhost:5173 to play.

## 🏗️ Tech Stack

- **Frontend**: React + TypeScript + Vite + Zustand
- **Backend**: Express + WebSocket (ws)
- **Styling**: Vanilla CSS with glassmorphism dark theme
- **Testing**: Playwright (83 unit tests + 10x 10-player stress tests)

## 📦 Deployment

### Static hosting (Cloudflare Pages, Vercel, Netlify)
```bash
VITE_USE_LOCAL=true npm run build
# Deploy the dist/ folder
```
> Single-device mode with bot players. No server required.

### Full multiplayer (Railway, Render, Fly.io)
```bash
npm run build
# Deploy server/ alongside dist/
# Server serves both API and static files
```

## 🧪 Testing

```bash
npm test              # Run all 83 tests
npm run test:ui       # Interactive test UI
```

---

*3–10 players · Based on the board game by Big Potato Games*
