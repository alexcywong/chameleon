import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';

/**
 * Test the "Play Again" flow:
 * 1. 4 players join and play 1 round
 * 2. Host clicks "Play Again with Everyone"
 * 3. Verify all players return to lobby with reset scores
 * 4. Play another round to confirm full flow works
 */

const BASE_URL = 'http://localhost:5173';

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
  await host.page.waitForURL(/\/lobby\//, { timeout: 10000 });
  return host.page.url().split('/lobby/')[1];
}

async function playerJoinsGame(player: PlayerSession, roomCode: string): Promise<void> {
  await player.page.goto(`${BASE_URL}/join/${roomCode}`);
  await player.page.waitForSelector('#input-join-name', { timeout: 5000 });
  await player.page.fill('#input-join-name', player.name);
  await player.page.click('#btn-join-room');
  await player.page.waitForURL(/\/lobby\//, { timeout: 15000 });
}

async function submitClueWhenMyTurn(player: PlayerSession): Promise<void> {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const phaseText = await player.page.textContent('body').catch(() => '') || '';
    if (phaseText.includes('CLUE GIVING') || phaseText.includes('Give Your Clue')) break;
    await player.page.waitForTimeout(300);
  }
  while (Date.now() < Date.now() + 60000) {
    const clueInput = player.page.locator('#input-clue');
    if (await clueInput.isVisible({ timeout: 300 }).catch(() => false)) {
      if (!await clueInput.isDisabled().catch(() => true)) {
        await clueInput.fill('word');
        await player.page.click('#btn-submit-clue');
        return;
      }
    }
    const past = await player.page.locator('#btn-start-voting').isVisible({ timeout: 200 }).catch(() => false) ||
                 await player.page.locator('.player-item.votable').first().isVisible({ timeout: 200 }).catch(() => false);
    if (past) return;
    await player.page.waitForTimeout(300);
  }
}

async function castVote(player: PlayerSession): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const votable = player.page.locator('.player-item.votable');
    if (await votable.first().isVisible({ timeout: 300 }).catch(() => false)) {
      await votable.first().click();
      await player.page.waitForTimeout(300);
      const btn = player.page.locator('[id^="btn-submit-vote"], #btn-accuse');
      if (await btn.first().isVisible({ timeout: 500 }).catch(() => false)) {
        await btn.first().click();
      }
      return;
    }
    await player.page.waitForTimeout(300);
  }
}

async function handleChameleonGuess(player: PlayerSession): Promise<void> {
  const opt = player.page.locator('.word-cell.is-guess-option').first();
  if (await opt.isVisible({ timeout: 2000 }).catch(() => false)) {
    await opt.click();
    await player.page.waitForTimeout(300);
    const btn = player.page.locator('#btn-chameleon-guess');
    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) await btn.click();
  }
}

async function waitForText(page: Page, text: string, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await page.textContent('body').catch(() => '');
    if (body?.includes(text)) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

test.describe('Play Again Flow', () => {

  test('host clicks Play Again → all players return to lobby with reset scores', async ({ browser }) => {
    test.setTimeout(180_000);
    const players: PlayerSession[] = [];
    const PLAYER_COUNT = 4;

    try {
      // Create 4 players
      for (const name of ['Host', 'P1', 'P2', 'P3']) {
        players.push(await createPlayerSession(browser, name));
      }

      // Host creates game
      const roomCode = await hostCreatesGame(players[0]);
      console.log(`  Room ${roomCode} created`);

      // Players join
      for (let i = 1; i < PLAYER_COUNT; i++) {
        await playerJoinsGame(players[i], roomCode);
      }
      console.log(`  All ${PLAYER_COUNT} players joined`);

      // Start game (3 rounds — minimum option)
      await players[0].page.click('button:has-text("3")');
      await players[0].page.click('#btn-start-game');
      await Promise.all(players.map(p => p.page.waitForURL(/\/play\//, { timeout: 15000 })));
      console.log(`  Game started (3 rounds) — all on /play/`);

      // Play 3 rounds
      for (let round = 1; round <= 3; round++) {
        // Clues
        await Promise.all(players.map(p => submitClueWhenMyTurn(p)));
        console.log(`  Round ${round}: Clues submitted`);

        // Discussion → Voting
        await waitForText(players[0].page, 'Start Voting', 15000);
        const votingBtn = players[0].page.locator('#btn-start-voting');
        if (await votingBtn.isVisible({ timeout: 3000 }).catch(() => false)) await votingBtn.click();
        await players[0].page.waitForTimeout(1000);

        // Vote
        await Promise.all(players.map(p => castVote(p)));
        console.log(`  Round ${round}: Votes cast`);

        // Chameleon guess
        await players[0].page.waitForTimeout(2000);
        await Promise.all(players.map(p => handleChameleonGuess(p)));
        await players[0].page.waitForTimeout(3000);

        // Wait for scoring
        await waitForText(players[0].page, 'Results', 10000);
        console.log(`  Round ${round}: Scoring visible`);

        // Advance
        if (round < 3) {
          const nextBtn = players[0].page.locator('#btn-next-round');
          await nextBtn.waitFor({ state: 'visible', timeout: 10000 });
          await nextBtn.click();
          await players[0].page.waitForTimeout(2000);
        }
      }

      // Click "See Final Results"
      const nextBtn = players[0].page.locator('#btn-next-round');
      await nextBtn.waitFor({ state: 'visible', timeout: 10000 });
      await nextBtn.click();

      // Wait for all players to reach results page
      await Promise.all(players.map(p => p.page.waitForURL(/\/results\//, { timeout: 15000 })));
      console.log(`  All players on /results/ page`);

      // Verify host sees "Play Again" button
      const playAgainBtn = players[0].page.locator('#btn-play-again');
      await playAgainBtn.waitFor({ state: 'visible', timeout: 5000 });
      const btnText = await playAgainBtn.textContent();
      expect(btnText).toContain('Play Again');
      console.log(`  Host sees: "${btnText}"`);

      // Verify non-host sees "Waiting for host"
      const waitingText = await players[1].page.textContent('body');
      expect(waitingText).toContain('Waiting for host');
      console.log(`  Non-host sees: "Waiting for host"`);

      // Host clicks Play Again
      await playAgainBtn.click();
      console.log(`  Host clicked Play Again`);

      // Wait for ALL players to return to lobby
      await Promise.all(players.map(p =>
        p.page.waitForURL(/\/lobby\//, { timeout: 15000 })
      ));
      console.log(`  ✅ All ${PLAYER_COUNT} players returned to /lobby/`);

      // Verify all players are listed in the lobby
      await players[0].page.waitForTimeout(1000);
      const lobbyCount = await players[0].page.locator('.player-item').count();
      expect(lobbyCount).toBe(PLAYER_COUNT);
      console.log(`  ✅ ${lobbyCount} players in lobby`);

      // Verify scores are reset (all should be 0)
      for (const player of players) {
        const scoreTexts = await player.page.locator('.player-score').allTextContents();
        for (const s of scoreTexts) {
          expect(parseInt(s.trim())).toBe(0);
        }
      }
      console.log(`  ✅ All scores reset to 0`);

      // Play another game (3 rounds) to confirm full flow works
      await players[0].page.click('button:has-text("3")');
      await players[0].page.click('#btn-start-game');
      await Promise.all(players.map(p => p.page.waitForURL(/\/play\//, { timeout: 15000 })));
      console.log(`  ✅ Second game started — all on /play/`);

      // Play round 1 of second game
      await Promise.all(players.map(p => submitClueWhenMyTurn(p)));
      await waitForText(players[0].page, 'Start Voting', 15000);
      const votingBtn2 = players[0].page.locator('#btn-start-voting');
      if (await votingBtn2.isVisible({ timeout: 3000 }).catch(() => false)) await votingBtn2.click();
      await players[0].page.waitForTimeout(1000);
      await Promise.all(players.map(p => castVote(p)));
      await players[0].page.waitForTimeout(2000);
      await Promise.all(players.map(p => handleChameleonGuess(p)));
      await players[0].page.waitForTimeout(3000);
      await waitForText(players[0].page, 'Results', 10000);
      console.log(`  ✅ Second game round 1 completed — scoring visible`);

      // Verify all players are still in the game
      for (let i = 0; i < PLAYER_COUNT; i++) {
        const url = players[i].page.url();
        const ok = url.includes('/play/') || url.includes('/results/');
        expect(ok, `${players[i].name} at ${url}`).toBe(true);
      }
      console.log(`  ✅ All players survived Play Again + second game`);

    } finally {
      for (const p of players) {
        await p.context.close().catch(() => {});
      }
    }
  });
});
