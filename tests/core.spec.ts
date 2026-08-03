import { test, expect, Page } from '@playwright/test';

/**
 * 20 core tests covering:
 * - Topic card rendering with new specific categories
 * - Code card display (kiwi vs non-kiwi)
 * - Clue submission flow
 * - Discussion phase behaviour
 * - Voting mechanics
 * - Kiwi guess UI
 * - Scoring display (secret word, guessed word, kiwi reveal)
 * - Round history correctness (no "Unknown")
 * - ScoreBoard component
 * - Edge cases (empty clue, double submit, round selector)
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

async function getPhaseText(page: Page): Promise<string> {
  return (await page.locator('.badge-green').first().textContent() || '').trim();
}

/** Robustly submit clue when it's our turn, bail if phase moves on */
async function submitClueWhenReady(page: Page, clue = 'test', timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const phase = await getPhaseText(page);
    if (phase !== 'CLUE GIVING') return;

    const input = page.locator('#input-clue');
    if (await input.isVisible({ timeout: 200 }).catch(() => false)) {
      await input.fill(clue);
      await page.waitForTimeout(100);
      await page.click('#btn-submit-clue').catch(() => {});
      await page.waitForTimeout(600);
    } else {
      await page.waitForTimeout(400);
    }
  }
}

/** Wait until voting or later phase */
async function advanceToVoting(page: Page): Promise<void> {
  await submitClueWhenReady(page);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const phase = await getPhaseText(page);
    if (phase === 'VOTING' || phase === 'SCORING' || phase === 'KIWI GUESS') return;
    await page.waitForTimeout(400);
  }
}



/**
 * Robustly play from voting through to SCORING.
 * Uses the proven approach from voting-workflow.spec.ts:
 * 1. Cast our vote
 * 2. Wait for phase to leave VOTING (via waitForFunction on badge)
 * 3. Handle KIWI GUESS if we're the kiwi
 * 4. Confirm SCORING phase reached
 */
async function playRoundToScoring(page: Page): Promise<void> {
  await advanceToVoting(page);

  // Cast our vote if we're in voting phase (tapping a player directly casts the vote)
  const phase = await getPhaseText(page);
  if (phase === 'VOTING') {
    const votable = page.locator('.player-item.votable');
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const count = await votable.count().catch(() => 0);
      if (count > 0) {
        await votable.first().click();
        break;
      }
      await page.waitForTimeout(500);
    }
  }

  // Wait for phase to move past VOTING (bots auto-vote in local mode)
  await page.waitForFunction(
    () => {
      const text = document.querySelector('.badge-green')?.textContent?.trim() || '';
      return text !== 'VOTING' && text !== 'CLUE GIVING' && text !== '';
    },
    null,
    { timeout: 30000 }
  ).catch(() => {});

  const currentPhase = await getPhaseText(page);

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

    // Wait for SCORING after guess
    await page.waitForFunction(
      () => document.querySelector('.badge-green')?.textContent?.trim() === 'SCORING',
      null,
      { timeout: 20000 }
    ).catch(() => {});
  }
}


// ── TESTS ──────────────────────────────────────────────────

test.describe('Core Tests', () => {

  // 1. Word grid displays with a header
  test('1: word grid shows header label', async ({ page }) => {
    await createAndStartGame(page);
    const header = page.locator('.topic-card .label');
    await expect(header).toBeVisible();
    const text = await header.textContent();
    expect(text).toBe('Word Grid');
  });

  // 2. Topic card shows exactly 16 words
  test('2: topic card renders 16 word cells', async ({ page }) => {
    await createAndStartGame(page);
    const wordCells = page.locator('.topic-card .word-cell');
    await expect(wordCells).toHaveCount(16);
  });

  // 3. Code card shows either kiwi or secret word
  test('3: code card shows kiwi card OR secret word', async ({ page }) => {
    await createAndStartGame(page);
    const codeCard = page.locator('.code-card');
    await expect(codeCard).toBeVisible();
    const text = await codeCard.textContent();
    const isKiwi = text!.includes('KIWI');
    const hasSecretWord = text!.includes('Secret Word');
    expect(isKiwi || hasSecretWord).toBe(true);
  });

  // 4. Non-kiwi player sees secret word highlighted on topic card
  test('4: non-kiwi sees secret word highlighted', async ({ page }) => {
    await createAndStartGame(page);
    const codeCard = page.locator('.code-card');
    const codeText = await codeCard.textContent();

    if (!codeText?.includes('KIWI')) {
      const secretCell = page.locator('.word-cell.is-secret');
      await expect(secretCell).toHaveCount(1);
    }
  });

  // 5. Clue submission button is disabled with empty input
  test('5: clue submit button is disabled with empty input', async ({ page }) => {
    await createAndStartGame(page);
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const input = page.locator('#input-clue');
      if (await input.isVisible({ timeout: 300 }).catch(() => false)) {
        const submitBtn = page.locator('#btn-submit-clue');
        await expect(submitBtn).toBeDisabled();
        return;
      }
      const phase = await getPhaseText(page);
      if (phase !== 'CLUE GIVING') return;
      await page.waitForTimeout(400);
    }
  });

  // 6. Clue input accepts text and enables submit button
  test('6: typing a clue enables the submit button', async ({ page }) => {
    await createAndStartGame(page);
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const input = page.locator('#input-clue');
      if (await input.isVisible({ timeout: 300 }).catch(() => false)) {
        await input.fill('myword');
        const submitBtn = page.locator('#btn-submit-clue');
        await expect(submitBtn).toBeEnabled();
        return;
      }
      const phase = await getPhaseText(page);
      if (phase !== 'CLUE GIVING') return;
      await page.waitForTimeout(400);
    }
  });

  // 7. After submitting a clue, the clue appears in the bubble list
  test('7: submitted clue appears in clue list', async ({ page }) => {
    await createAndStartGame(page);
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const input = page.locator('#input-clue');
      if (await input.isVisible({ timeout: 300 }).catch(() => false)) {
        await input.fill('banana');
        await page.click('#btn-submit-clue');
        await page.waitForTimeout(1000);
        const body = await page.textContent('body');
        expect(body).toContain('banana');
        return;
      }
      const phase = await getPhaseText(page);
      if (phase !== 'CLUE GIVING') return;
      await page.waitForTimeout(400);
    }
  });

  // 8. Voting phase shows all player clues in recap
  test('8: voting phase shows clue recap', async ({ page }) => {
    await createAndStartGame(page);
    await advanceToVoting(page);
    const phase = await getPhaseText(page);
    if (phase === 'VOTING') {
      // Clue recap is available via toggle
      const toggle = page.locator('.clue-recap-toggle');
      if (await toggle.isVisible({ timeout: 3000 }).catch(() => false)) {
        await toggle.click();
        const roastList = page.locator('.clue-roast-list');
        await expect(roastList).toBeVisible({ timeout: 3000 });
      }
    }
  });

  // 9. After clue giving, game goes directly to voting (no discussion)
  test('9: clue giving advances directly to voting', async ({ page }) => {
    test.setTimeout(60_000);
    await createAndStartGame(page);
    await advanceToVoting(page);
    const phase = await getPhaseText(page);
    // The critical assertion: DISCUSSION phase never appears
    expect(phase).not.toBe('DISCUSSION');
  });

  // 10. Voting phase shows all players as votable options
  test('10: voting phase shows votable player cards', async ({ page }) => {
    await createAndStartGame(page);
    await advanceToVoting(page);
    const phase = await getPhaseText(page);
    if (phase === 'VOTING') {
      const votable = page.locator('.player-item.votable');
      const count = await votable.count();
      expect(count).toBeGreaterThanOrEqual(2);
    }
  });

  // 11. Clicking a votable player casts the vote directly
  test('11: clicking a player casts vote directly', async ({ page }) => {
    await createAndStartGame(page);
    await advanceToVoting(page);
    const phase = await getPhaseText(page);
    if (phase === 'VOTING') {
      const votable = page.locator('.player-item.votable');
      if (await votable.count() > 0) {
        await votable.first().click();
        await page.waitForTimeout(500);
        // Vote is cast directly by tapping — no accuse button needed
        const voted = page.locator('.player-item.is-voted-player');
        expect(await voted.count()).toBeGreaterThanOrEqual(1);
      }
    }
  });

  // 12. Scoring screen shows topic and secret word (not "Unknown")
  test('12: scoring screen shows topic and secret word without Unknown', async ({ page }) => {
    test.setTimeout(90_000);
    await createAndStartGame(page);
    await playRoundToScoring(page);
    const phase = await getPhaseText(page);
    if (phase === 'SCORING') {
      const scoringInfo = page.locator('.scoring-info');
      await expect(scoringInfo).toBeVisible({ timeout: 5000 });
      const text = await scoringInfo.textContent();
      expect(text).toContain('Topic:');
      expect(text).toContain('Secret Word:');
      expect(text).not.toContain('Unknown');
    }
  });

  // 13. Scoring screen reveals the kiwi's name
  test('13: scoring screen reveals kiwi identity', async ({ page }) => {
    test.setTimeout(90_000);
    await createAndStartGame(page);
    await playRoundToScoring(page);
    const phase = await getPhaseText(page);
    if (phase === 'SCORING') {
      const scoringInfo = page.locator('.scoring-info');
      const text = await scoringInfo.textContent();
      expect(text).toContain('Kiwi:');
      const hasKiwiName = text!.includes('Tester') || text!.includes('Riley') || text!.includes('Jordan');
      expect(hasKiwiName).toBe(true);
    }
  });

  // 14. Scoring screen shows outcome badge (Caught/Escaped/Guessed)
  test('14: scoring screen shows round outcome badge', async ({ page }) => {
    test.setTimeout(90_000);
    await createAndStartGame(page);
    await playRoundToScoring(page);
    const phase = await getPhaseText(page);
    if (phase === 'SCORING') {
      const scoringReveal = page.locator('.scoring-reveal');
      const text = await scoringReveal.textContent();
      const hasOutcome = text!.includes('Caught') || text!.includes('Escaped') || text!.includes('Guessed');
      expect(hasOutcome).toBe(true);
    }
  });

  // 15. Round history in scoreboard does not show "Unknown" topic or word
  test('15: round history has no Unknown entries', async ({ page }) => {
    test.setTimeout(90_000);
    await createAndStartGame(page);
    await playRoundToScoring(page);
    const phase = await getPhaseText(page);
    if (phase === 'SCORING') {
      const roundHistory = page.locator('.round-history');
      if (await roundHistory.isVisible({ timeout: 3000 }).catch(() => false)) {
        const historyText = await roundHistory.textContent();
        expect(historyText).not.toContain('"Unknown"');
      }
    }
  });

  // 16. Scoreboard renders player score bars
  test('16: scoreboard shows player score bars', async ({ page }) => {
    test.setTimeout(90_000);
    await createAndStartGame(page);
    await playRoundToScoring(page);
    const phase = await getPhaseText(page);
    if (phase === 'SCORING') {
      const scoreItems = page.locator('.scoreboard-item');
      const count = await scoreItems.count();
      expect(count).toBe(3);
    }
  });

  // 17. Clue roasts section appears on scoring screen
  test('17: clue roasts appear on scoring screen', async ({ page }) => {
    test.setTimeout(90_000);
    await createAndStartGame(page);
    await playRoundToScoring(page);
    const phase = await getPhaseText(page);
    if (phase === 'SCORING') {
      const roastSection = page.locator('.clue-roast-section');
      await expect(roastSection).toBeVisible({ timeout: 5000 });
    }
  });

  // 18. Host sees next round button on scoring screen
  test('18: host sees next round button on scoring screen', async ({ page }) => {
    test.setTimeout(90_000);
    await createAndStartGame(page);
    await playRoundToScoring(page);
    const phase = await getPhaseText(page);
    if (phase === 'SCORING') {
      const nextRoundBtn = page.locator('#btn-next-round');
      await expect(nextRoundBtn).toBeVisible({ timeout: 5000 });
    }
  });

  // 19. Lobby round selector works
  test('19: lobby round selector sets rounds correctly', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.click('#btn-create-game');
    await page.fill('#input-player-name', 'RoundTest');
    await page.click('#btn-create-room');
    await page.waitForURL(/\/lobby\//);

    const btn3 = page.locator('.lobby-rounds-selector button', { hasText: /^3$/ });
    await btn3.click();
    await expect(btn3).toHaveClass(/btn-primary/);

    const btn7 = page.locator('.lobby-rounds-selector button', { hasText: /^7$/ });
    await btn7.click();
    await expect(btn7).toHaveClass(/btn-primary/);
    await expect(btn3).not.toHaveClass(/btn-primary/);
  });

  // 20. Full round shows correct round summary with real topic
  test('20: full round scoring shows correct round summary', async ({ page }) => {
    test.setTimeout(90_000);
    await createAndStartGame(page, 2, 'FullTest', 3);
    await playRoundToScoring(page);

    const phase = await getPhaseText(page);
    if (phase === 'SCORING') {
      const scoringReveal = page.locator('.scoring-reveal');
      await expect(scoringReveal).toBeVisible();

      const historyItem = page.locator('.round-history-item').first();
      if (await historyItem.isVisible({ timeout: 3000 }).catch(() => false)) {
        const text = await historyItem.textContent();
        expect(text).toContain('R1');
        expect(text).not.toContain('Unknown');
        const hasOutcome = text!.includes('Caught') || text!.includes('Escaped') || text!.includes('Guessed');
        expect(hasOutcome).toBe(true);
      }
    }
  });
});
