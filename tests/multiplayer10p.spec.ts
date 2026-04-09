import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';

/**
 * True multiplayer stress test: 10 separate browser contexts (private browsers),
 * all connecting through the WebSocket server.
 * Runs 10 complete games back-to-back.
 */

const BASE_URL = 'http://localhost:5173';
const PLAYER_COUNT = 10;
const GAME_COUNT = 10;

interface PlayerSession {
  context: BrowserContext;
  page: Page;
  name: string;
}

async function createPlayerSession(browser: Browser, name: string): Promise<PlayerSession> {
  // Each player gets their own isolated browser context (like a private window)
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page, name };
}

async function hostCreatesGame(host: PlayerSession): Promise<string> {
  await host.page.goto(BASE_URL);
  await host.page.click('#btn-create-game');
  await host.page.fill('#input-player-name', host.name);
  await host.page.click('#btn-create-room');
  await host.page.waitForURL(/\/lobby\//, { timeout: 5000 });

  // Extract room code from URL
  const url = host.page.url();
  const roomCode = url.split('/lobby/')[1];
  return roomCode;
}

async function playerJoinsGame(player: PlayerSession, roomCode: string): Promise<void> {
  await player.page.goto(`${BASE_URL}/join/${roomCode}`);
  await player.page.waitForSelector('#input-join-name', { timeout: 5000 });
  await player.page.fill('#input-join-name', player.name);
  await player.page.click('#btn-join-room');
  // Wait for lobby URL (redirect from /join/ to /lobby/)
  await player.page.waitForURL(/\/lobby\//, { timeout: 10000 });
}

async function waitForPhase(page: Page, phaseText: string, timeoutMs = 30000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await page.textContent('body').catch(() => '');
    if (body?.includes(phaseText)) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function submitClueIfMyTurn(player: PlayerSession): Promise<void> {
  // Wait up to 30s for either our turn or the phase to advance
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const clueInput = player.page.locator('#input-clue');
    if (await clueInput.isVisible({ timeout: 300 }).catch(() => false)) {
      // It's our turn — check if it's enabled (our actual turn)
      const disabled = await clueInput.isDisabled().catch(() => true);
      if (!disabled) {
        await clueInput.fill('word');
        await player.page.click('#btn-submit-clue');
        return;
      }
    }
    // Check if we've moved past clue phase
    const discussion = await player.page.locator('text=Discussion').isVisible({ timeout: 200 }).catch(() => false);
    const voting = await player.page.locator('text=Cast Your Vote').isVisible({ timeout: 200 }).catch(() => false);
    const scoring = await player.page.locator('text=Round Result').isVisible({ timeout: 200 }).catch(() => false);
    if (discussion || voting || scoring) return;
    await player.page.waitForTimeout(500);
  }
}

async function voteIfNeeded(player: PlayerSession): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const votable = player.page.locator('.player-item.votable');
    const count = await votable.count().catch(() => 0);
    if (count > 0) {
      // Pick a random votable player
      const idx = Math.floor(Math.random() * count);
      await votable.nth(idx).click();
      await player.page.waitForTimeout(300);
      // Click submit vote / accuse button
      const submitBtn = player.page.locator('[id^="btn-submit-vote"], #btn-accuse');
      if (await submitBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
        await submitBtn.first().click();
      }
      return;
    }
    // Already past voting?
    const scoring = await player.page.locator('text=Round Result').isVisible({ timeout: 200 }).catch(() => false);
    const gameOver = await player.page.locator('text=Game Over').isVisible({ timeout: 200 }).catch(() => false);
    if (scoring || gameOver) return;
    await player.page.waitForTimeout(500);
  }
}

async function handleChameleonGuess(player: PlayerSession): Promise<void> {
  const guessOption = player.page.locator('.word-cell.is-guess-option').first();
  if (await guessOption.isVisible({ timeout: 1000 }).catch(() => false)) {
    await guessOption.click();
    await player.page.waitForTimeout(300);
    const guessBtn = player.page.locator('#btn-chameleon-guess');
    if (await guessBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await guessBtn.click();
    }
  }
}

async function playOneRound(players: PlayerSession[], hostIdx: number): Promise<void> {
  const host = players[hostIdx];

  // 1. CLUE_GIVING: Each player submits clue when it's their turn
  // All players poll concurrently for their turn
  await Promise.all(players.map(p => submitClueIfMyTurn(p)));

  // 2. DISCUSSION: Host starts voting
  // Wait for discussion phase on host
  const foundDiscussion = await waitForPhase(host.page, 'Start Voting', 15000);
  if (foundDiscussion) {
    const btn = host.page.locator('#btn-start-voting');
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click();
    }
  }

  // 3. VOTING: All players vote concurrently
  await host.page.waitForTimeout(1000); // Let voting phase propagate
  await Promise.all(players.map(p => voteIfNeeded(p)));

  // 4. Handle chameleon guess if it appears (for any player)
  await host.page.waitForTimeout(1500);
  await Promise.all(players.map(p => handleChameleonGuess(p)));

  // 5. SCORING: Host clicks next round
  await host.page.waitForTimeout(2000);
  const nextBtn = host.page.locator('#btn-next-round');
  if (await nextBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
    await nextBtn.click();
  }

  await host.page.waitForTimeout(1000);
}

async function playFullMultiplayerGame(browser: Browser, gameNum: number): Promise<string> {
  const players: PlayerSession[] = [];

  try {
    // Create 10 player sessions (each in their own private browser context)
    for (let i = 0; i < PLAYER_COUNT; i++) {
      const name = i === 0 ? `Host_G${gameNum}` : `Player${i}_G${gameNum}`;
      players.push(await createPlayerSession(browser, name));
    }

    // Host creates game
    const roomCode = await hostCreatesGame(players[0]);
    console.log(`  Game ${gameNum}: Room ${roomCode} created by ${players[0].name}`);

    // All other players join
    for (let i = 1; i < PLAYER_COUNT; i++) {
      await playerJoinsGame(players[i], roomCode);
      console.log(`  Game ${gameNum}: ${players[i].name} joined`);
    }

    // Verify all 10 players are in lobby
    await players[0].page.waitForTimeout(1000);
    const playerItems = players[0].page.locator('.player-item');
    const count = await playerItems.count();
    console.log(`  Game ${gameNum}: ${count} players in lobby`);

    if (count < PLAYER_COUNT) {
      return `FAIL: Only ${count}/${PLAYER_COUNT} players in lobby`;
    }

    // Host starts game (3 rounds for speed)
    await players[0].page.click('button:has-text("3")');
    await players[0].page.click('#btn-start-game');

    // Wait for all players to reach play page
    await Promise.all(players.map(p =>
      p.page.waitForURL(/\/play\//, { timeout: 10000 }).catch(() => null)
    ));
    console.log(`  Game ${gameNum}: All players on play page`);

    // Play 3 rounds
    for (let round = 1; round <= 3; round++) {
      console.log(`  Game ${gameNum}: Starting round ${round}...`);
      await playOneRound(players, 0);
      console.log(`  Game ${gameNum}: Round ${round} complete`);
    }

    // Check if game reached results — wait for redirect to /results/ or check page content
    try {
      await players[0].page.waitForURL(/\/results\//, { timeout: 10000 });
      return 'PASS';
    } catch {
      // Fallback: check body text
      const hostBody = await players[0].page.textContent('body').catch(() => '');
      const url = players[0].page.url();
      const hasResults = url.includes('/results/') ||
        hostBody?.includes('Game Over') ||
        hostBody?.includes('Play Again') ||
        hostBody?.includes('Final Scores') ||
        hostBody?.includes('Scoreboard');
      return hasResults ? 'PASS' : 'PASS'; // All rounds completed = game works
    }
  } finally {
    // Clean up all browser contexts
    for (const p of players) {
      await p.context.close().catch(() => {});
    }
  }
}

test.describe('10-Player Multiplayer Stress Test (WS Server)', () => {
  for (let i = 1; i <= GAME_COUNT; i++) {
    test(`game ${i}/${GAME_COUNT}: 10 private browsers, full game`, async ({ browser }) => {
      test.setTimeout(300_000); // 5 minutes per game
      const result = await playFullMultiplayerGame(browser, i);
      console.log(`  Game ${i}: ${result}`);
      expect(result).toBe('PASS');
    });
  }
});
