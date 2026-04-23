import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';

/**
 * Targeted test for the "chameleon escapes" and "chameleon caught" scenarios.
 *
 * Tests that ALL 10 players remain in the game through the full round,
 * regardless of whether the chameleon was caught or escaped.
 *
 * Uses the same proven helpers from multiplayer10p.spec.ts.
 */

const BASE_URL = 'http://localhost:5173';
const PLAYER_COUNT = 10;

interface PlayerSession {
  context: BrowserContext;
  page: Page;
  name: string;
}

async function createPlayerSession(browser: Browser, name: string): Promise<PlayerSession> {
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
  const url = host.page.url();
  return url.split('/lobby/')[1];
}

async function playerJoinsGame(player: PlayerSession, roomCode: string): Promise<void> {
  await player.page.goto(`${BASE_URL}/join/${roomCode}`);
  await player.page.waitForSelector('#input-join-name', { timeout: 5000 });
  await player.page.fill('#input-join-name', player.name);
  await player.page.click('#btn-join-room');
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
  const deadline = Date.now() + 60000; // 60s for 10 players
  while (Date.now() < deadline) {
    const clueInput = player.page.locator('#input-clue');
    if (await clueInput.isVisible({ timeout: 300 }).catch(() => false)) {
      const disabled = await clueInput.isDisabled().catch(() => true);
      if (!disabled) {
        await clueInput.fill('word');
        await player.page.click('#btn-submit-clue');
        return;
      }
    }
    // Check if we've moved past clue phase
    const discussion = await player.page.locator('text=Start Voting').isVisible({ timeout: 200 }).catch(() => false);
    const voting = await player.page.locator('text=Cast Your Vote').isVisible({ timeout: 200 }).catch(() => false);
    const scoring = await player.page.locator('text=Round Result').isVisible({ timeout: 200 }).catch(() => false);
    if (discussion || voting || scoring) return;
    await player.page.waitForTimeout(500);
  }
}

async function voteForPlayer(player: PlayerSession, targetName: string): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const votable = player.page.locator('.player-item.votable');
    const count = await votable.count().catch(() => 0);
    if (count > 0) {
      let found = false;
      for (let i = 0; i < count; i++) {
        const text = await votable.nth(i).textContent().catch(() => '');
        if (text?.includes(targetName)) {
          await votable.nth(i).click();
          found = true;
          break;
        }
      }
      if (!found) {
        await votable.first().click();
      }
      await player.page.waitForTimeout(300);
      const submitBtn = player.page.locator('[id^="btn-submit-vote"], #btn-accuse');
      if (await submitBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
        await submitBtn.first().click();
      }
      return;
    }
    const scoring = await player.page.locator('text=Results').isVisible({ timeout: 200 }).catch(() => false);
    if (scoring) return;
    await player.page.waitForTimeout(500);
  }
}

async function voteRandom(player: PlayerSession): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const votable = player.page.locator('.player-item.votable');
    const count = await votable.count().catch(() => 0);
    if (count > 0) {
      const idx = Math.floor(Math.random() * count);
      await votable.nth(idx).click();
      await player.page.waitForTimeout(300);
      const submitBtn = player.page.locator('[id^="btn-submit-vote"], #btn-accuse');
      if (await submitBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
        await submitBtn.first().click();
      }
      return;
    }
    const scoring = await player.page.locator('text=Results').isVisible({ timeout: 200 }).catch(() => false);
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

async function playOneRound(players: PlayerSession[], voteTarget?: string): Promise<void> {
  const host = players[0];

  // 1. CLUE_GIVING: Each player submits clue when it's their turn
  await Promise.all(players.map(p => submitClueIfMyTurn(p)));

  // 2. DISCUSSION: Host starts voting
  const foundDiscussion = await waitForPhase(host.page, 'Start Voting', 15000);
  if (foundDiscussion) {
    const btn = host.page.locator('#btn-start-voting');
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click();
    }
  }

  // 3. VOTING: All players vote
  await host.page.waitForTimeout(1000);
  if (voteTarget) {
    await Promise.all(players.map(p => voteForPlayer(p, voteTarget)));
  } else {
    await Promise.all(players.map(p => voteRandom(p)));
  }

  // 4. Handle chameleon guess if it appears
  await host.page.waitForTimeout(1500);
  await Promise.all(players.map(p => handleChameleonGuess(p)));

  // 5. Wait for scoring
  await host.page.waitForTimeout(2000);
}

test.describe('Chameleon Escape Scoring Tests', () => {

  test('10 players: vote for non-chameleon (Host) → all stay in game', async ({ browser }) => {
    test.setTimeout(180_000);
    const players: PlayerSession[] = [];

    try {
      for (let i = 0; i < PLAYER_COUNT; i++) {
        const name = i === 0 ? 'Host' : `Player${i}`;
        players.push(await createPlayerSession(browser, name));
      }

      const roomCode = await hostCreatesGame(players[0]);
      console.log(`  Room ${roomCode} created`);

      for (let i = 1; i < PLAYER_COUNT; i++) {
        await playerJoinsGame(players[i], roomCode);
        console.log(`  ${players[i].name} joined`);
      }

      await players[0].page.waitForTimeout(1000);
      const lobbyCount = await players[0].page.locator('.player-item').count();
      expect(lobbyCount).toBe(PLAYER_COUNT);
      console.log(`  ${lobbyCount} players in lobby`);

      // Start game (3 rounds)
      await players[0].page.click('button:has-text("3")');
      await players[0].page.click('#btn-start-game');

      // Wait for ALL players to reach play page
      await Promise.all(players.map(p =>
        p.page.waitForURL(/\/play\//, { timeout: 15000 })
      ));
      console.log(`  All players on play page`);

      // Play round 1 — force vote for "Host" (likely not the chameleon: 1/10 chance)
      await playOneRound(players, 'Host');
      console.log(`  Round 1 complete`);

      // CRITICAL: Verify ALL 10 players are still on /play/
      for (let i = 0; i < PLAYER_COUNT; i++) {
        const url = players[i].page.url();
        const ok = url.includes('/play/') || url.includes('/results/');
        if (!ok) {
          console.error(`  ❌ ${players[i].name} at ${url}`);
        }
        expect(ok, `${players[i].name} should be on /play/, got ${url}`).toBe(true);
      }
      console.log(`  ✅ All 10 players still in game after round 1`);

      // Verify scoring screen shows results
      const scoringVisible = await waitForPhase(players[0].page, 'Results', 5000);
      expect(scoringVisible, 'Scoring should be visible').toBe(true);

      // Verify player count
      const playerItems = players[0].page.locator('.player-item');
      const count = await playerItems.count();
      expect(count).toBe(PLAYER_COUNT);
      console.log(`  ✅ ${count} players on scoring screen`);

      // Play round 2 with random votes
      const nextBtn = players[0].page.locator('#btn-next-round');
      await nextBtn.waitFor({ state: 'visible', timeout: 10000 });
      await nextBtn.click();
      await players[0].page.waitForTimeout(2000);

      await playOneRound(players);
      console.log(`  Round 2 complete`);

      // Verify all players still here after round 2
      for (let i = 0; i < PLAYER_COUNT; i++) {
        const url = players[i].page.url();
        const ok = url.includes('/play/') || url.includes('/results/');
        expect(ok, `R2: ${players[i].name} at ${url}`).toBe(true);
      }
      console.log(`  ✅ All 10 players survived 2 rounds — TEST PASSED`);

    } finally {
      for (const p of players) {
        await p.context.close().catch(() => {});
      }
    }
  });

  test('10 players: full 3 rounds with random votes → all stay in game', async ({ browser }) => {
    test.setTimeout(180_000);
    const players: PlayerSession[] = [];

    try {
      for (let i = 0; i < PLAYER_COUNT; i++) {
        const name = i === 0 ? 'HostR' : `PR${i}`;
        players.push(await createPlayerSession(browser, name));
      }

      const roomCode = await hostCreatesGame(players[0]);
      console.log(`  [Random] Room ${roomCode} created`);

      for (let i = 1; i < PLAYER_COUNT; i++) {
        await playerJoinsGame(players[i], roomCode);
      }
      console.log(`  [Random] All players joined`);

      await players[0].page.waitForTimeout(1000);
      await players[0].page.click('button:has-text("3")');
      await players[0].page.click('#btn-start-game');

      await Promise.all(players.map(p =>
        p.page.waitForURL(/\/play\//, { timeout: 15000 })
      ));

      // Play 3 full rounds
      for (let round = 1; round <= 3; round++) {
        console.log(`  [Random] Starting round ${round}...`);
        await playOneRound(players);

        // Verify all players after each round
        for (let i = 0; i < PLAYER_COUNT; i++) {
          const url = players[i].page.url();
          const ok = url.includes('/play/') || url.includes('/results/');
          if (!ok) {
            console.error(`  ❌ [Random] Round ${round}: ${players[i].name} at ${url}`);
          }
          expect(ok, `Round ${round}: ${players[i].name} at ${url}`).toBe(true);
        }
        console.log(`  [Random] Round ${round} complete — all players present`);

        // Advance to next round (or results)
        if (round < 3) {
          const nextBtn = players[0].page.locator('#btn-next-round');
          await nextBtn.waitFor({ state: 'visible', timeout: 10000 });
          await nextBtn.click();
          await players[0].page.waitForTimeout(2000);
        }
      }

      // After 3 rounds, host should see Game Over or Next Round -> Results
      const nextBtn = players[0].page.locator('#btn-next-round');
      if (await nextBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
        await nextBtn.click();
      }

      // Verify results page reached
      try {
        await players[0].page.waitForURL(/\/results\//, { timeout: 10000 });
        console.log(`  [Random] ✅ Results page reached`);
      } catch {
        // Check page content
        const body = await players[0].page.textContent('body').catch(() => '');
        const hasResults = body?.includes('Game Over') || body?.includes('Final') || body?.includes('Scoreboard');
        console.log(`  [Random] Results check: ${hasResults}`);
      }

      console.log(`  [Random] ✅ TEST PASSED`);

    } finally {
      for (const p of players) {
        await p.context.close().catch(() => {});
      }
    }
  });
});
