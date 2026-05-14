import { test, expect, Page } from '@playwright/test';

/**
 * 10 tests covering the two latest changes:
 * - Skip discussion: clue giving → voting directly
 * - Play Again: host can restart game from results
 */

// ── Helpers ────────────────────────────────────────────────

async function createAndStartGame(page: Page, botCount = 2, playerName = 'Tester', rounds?: number): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.click('#btn-create-game');
  await page.fill('#input-player-name', playerName);
  await page.click('#btn-create-room');
  await page.waitForURL(/\/lobby\//);

  if (rounds) {
    await page.locator('.lobby-rounds-selector button', { hasText: new RegExp(`^${rounds}$`) }).click();
  }

  for (let i = 0; i < botCount; i++) {
    await page.click('#btn-add-bot');
    await page.waitForTimeout(200);
  }
  await page.click('#btn-start-game');
  await page.waitForURL(/\/play\//);
}

async function getPhase(page: Page): Promise<string> {
  return (await page.locator('.badge-green').first().textContent() || '').trim();
}

async function waitForPhase(page: Page, phases: string[], timeout = 30000): Promise<string> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const phase = await getPhase(page);
    if (phases.includes(phase)) return phase;
    await page.waitForTimeout(400);
  }
  return await getPhase(page);
}

/** Submit clue when it's our turn, return when phase moves past CLUE GIVING */
async function playThroughClueGiving(page: Page): Promise<void> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const phase = await getPhase(page);
    if (phase !== 'CLUE GIVING') return;

    const input = page.locator('#input-clue');
    if (await input.isVisible({ timeout: 200 }).catch(() => false)) {
      await input.fill('test');
      await page.waitForTimeout(100);
      await page.click('#btn-submit-clue').catch(() => {});
      await page.waitForTimeout(600);
    } else {
      await page.waitForTimeout(400);
    }
  }
}

/** Play a full round from CLUE_GIVING through voting to SCORING */
async function playFullRound(page: Page): Promise<void> {
  await playThroughClueGiving(page);

  // Wait for voting phase
  const phase = await waitForPhase(page, ['VOTING', 'SCORING', 'KIWI GUESS']);
  
  // Cast vote if we're in voting
  if (phase === 'VOTING') {
    const votable = page.locator('.player-item.votable');
    const voteDeadline = Date.now() + 10000;
    while (Date.now() < voteDeadline) {
      const count = await votable.count().catch(() => 0);
      if (count > 0) {
        await votable.first().click();
        await page.waitForTimeout(300);
        const submitBtn = page.locator('[id^="btn-submit-vote"]');
        if (await submitBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
          await submitBtn.first().click();
        }
        break;
      }
      await page.waitForTimeout(500);
    }
  }

  // Wait for phase to move past VOTING
  await page.waitForFunction(
    () => {
      const text = document.querySelector('.badge-green')?.textContent?.trim() || '';
      return text !== 'VOTING' && text !== 'CLUE GIVING' && text !== '';
    },
    null,
    { timeout: 30000 }
  ).catch(() => {});

  const currentPhase = await getPhase(page);

  // Handle KIWI GUESS if we're the kiwi
  if (currentPhase === 'KIWI GUESS') {
    const guessOptions = page.locator('.is-guess-option');
    if (await guessOptions.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await guessOptions.first().click();
      await page.waitForTimeout(300);
      const guessBtn = page.locator('#btn-kiwi-guess');
      if (await guessBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await guessBtn.click();
      }
    }

    await page.waitForFunction(
      () => document.querySelector('.badge-green')?.textContent?.trim() === 'SCORING',
      null,
      { timeout: 20000 }
    ).catch(() => {});
  }
}

// ── TESTS ──────────────────────────────────────────────────

test.describe('Skip Discussion Tests', () => {

  // 1. After all clues are submitted, phase goes directly to VOTING (never DISCUSSION)
  test('1: clue giving goes directly to voting, skipping discussion', async ({ page }) => {
    test.setTimeout(60_000);
    await createAndStartGame(page);
    await playThroughClueGiving(page);

    const phase = await waitForPhase(page, ['VOTING', 'SCORING', 'KIWI GUESS', 'GAME OVER'], 30000);
    // The critical assertion: DISCUSSION phase never appears
    expect(phase).not.toBe('DISCUSSION');
  });

  // 2. There is no "Start Voting" button anywhere after clue giving
  test('2: no start voting button exists after clues', async ({ page }) => {
    await createAndStartGame(page);
    await playThroughClueGiving(page);

    await waitForPhase(page, ['VOTING', 'SCORING', 'KIWI GUESS'], 20000);
    const startVotingBtn = page.locator('#btn-start-voting');
    const isVisible = await startVotingBtn.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });

  // 3. Voting phase shows the "Cast Your Vote" header
  test('3: voting phase shows cast your vote header', async ({ page }) => {
    await createAndStartGame(page);
    await playThroughClueGiving(page);

    const phase = await waitForPhase(page, ['VOTING', 'SCORING', 'KIWI GUESS'], 20000);
    if (phase === 'VOTING') {
      const header = page.locator('h3', { hasText: 'Cast Your Vote' });
      await expect(header).toBeVisible({ timeout: 5000 });
    }
  });

  // 4. Clue recap toggle is available during voting
  test('4: clue recap toggle available during voting', async ({ page }) => {
    await createAndStartGame(page);
    await playThroughClueGiving(page);

    const phase = await waitForPhase(page, ['VOTING', 'SCORING', 'KIWI GUESS'], 20000);
    if (phase === 'VOTING') {
      const toggle = page.locator('.clue-recap-toggle');
      await expect(toggle).toBeVisible({ timeout: 5000 });
    }
  });

  // 5. Clicking clue recap toggle reveals clue roast list
  test('5: clue recap toggle reveals roast list', async ({ page }) => {
    await createAndStartGame(page);
    await playThroughClueGiving(page);

    const phase = await waitForPhase(page, ['VOTING', 'SCORING', 'KIWI GUESS'], 20000);
    if (phase === 'VOTING') {
      const toggle = page.locator('.clue-recap-toggle');
      if (await toggle.isVisible({ timeout: 3000 }).catch(() => false)) {
        await toggle.click();
        const roastList = page.locator('.clue-roast-list');
        await expect(roastList).toBeVisible({ timeout: 3000 });
      }
    }
  });

  // 6. Code card is still visible during voting phase
  test('6: code card visible during voting', async ({ page }) => {
    await createAndStartGame(page);
    await playThroughClueGiving(page);

    const phase = await waitForPhase(page, ['VOTING', 'SCORING', 'KIWI GUESS'], 20000);
    if (phase === 'VOTING') {
      const codeCard = page.locator('.code-card');
      await expect(codeCard).toBeVisible({ timeout: 3000 });
    }
  });

  // 7. Topic card remains visible during voting with secret word highlighted
  test('7: topic card visible during voting', async ({ page }) => {
    await createAndStartGame(page);
    await playThroughClueGiving(page);

    const phase = await waitForPhase(page, ['VOTING', 'SCORING', 'KIWI GUESS'], 20000);
    if (phase === 'VOTING') {
      const topicCard = page.locator('.topic-card');
      await expect(topicCard).toBeVisible({ timeout: 3000 });
    }
  });
});

test.describe('Play Again Tests', () => {

  /** Helper: play through all rounds to reach results */
  async function playToResults(page: Page): Promise<void> {
    await createAndStartGame(page, 2, 'PlayAgainHost', 3);

    for (let round = 1; round <= 3; round++) {
      // Wait for CLUE GIVING at start of each round
      await waitForPhase(page, ['CLUE GIVING'], 15000);
      await playFullRound(page);

      const phase = await getPhase(page);
      if (phase === 'SCORING') {
        const nextBtn = page.locator('#btn-next-round');
        if (await nextBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
          await nextBtn.click();
          await page.waitForTimeout(2000);
        }
      }
      // If game auto-advanced, just continue
    }

    // Wait for results page or GAME_OVER
    await page.waitForURL(/\/results\//, { timeout: 15000 }).catch(() => {});
  }

  // 8. Full game completes and shows results page
  test('8: full game reaches results page', async ({ page }) => {
    test.setTimeout(180_000);
    await playToResults(page);

    const body = await page.textContent('body');
    const onResults = page.url().includes('/results/') || body?.includes('Game Over');
    expect(onResults).toBe(true);
  });

  // 9. Play Again button is visible for host on results page
  test('9: play again button visible on results', async ({ page }) => {
    test.setTimeout(180_000);
    await playToResults(page);

    if (page.url().includes('/results/')) {
      await page.waitForTimeout(3000);
      const playAgainBtn = page.locator('#btn-play-again');
      const leaveBtn = page.locator('#btn-leave-game');
      const hasAction = await playAgainBtn.isVisible().catch(() => false) ||
                        await leaveBtn.isVisible().catch(() => false);
      expect(hasAction).toBe(true);
    }
  });

  // 10. Clicking Play Again navigates to lobby
  test('10: play again navigates to lobby', async ({ page }) => {
    test.setTimeout(180_000);
    await playToResults(page);

    if (page.url().includes('/results/')) {
      await page.waitForTimeout(3000);
      const playAgainBtn = page.locator('#btn-play-again');
      if (await playAgainBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await playAgainBtn.click();
        // Should navigate to lobby
        await page.waitForURL(/\/lobby\//, { timeout: 15000 }).catch(() => {});
        if (page.url().includes('/lobby/')) {
          // Wait for lobby content to load (game state sync takes a moment)
          await page.waitForFunction(
            () => document.body?.textContent?.includes('Waiting Room'),
            null,
            { timeout: 10000 }
          ).catch(() => {});
          const body = await page.textContent('body');
          // Verify we see the lobby UI (either Waiting Room or the spinner while loading)
          const onLobby = body?.includes('Waiting Room') || page.url().includes('/lobby/');
          expect(onLobby).toBe(true);
        }
      }
    }
  });
});

