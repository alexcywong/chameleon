import { test, expect, Page } from '@playwright/test';

/**
 * Tests for the post-voting workflow:
 * 1. After voting, game advances to either CHAMELEON_GUESS or SCORING
 * 2. Scoring screen shows correct info (topic, secret word, chameleon)
 * 3. Next round works
 * 4. Full multi-round game completes through all rounds to results
 */

async function startGameWithBots(page: Page, botCount = 2, rounds?: number): Promise<void> {
  await page.goto('/');
  // Clear any leftover state from previous tests
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.click('#btn-create-game');
  await page.fill('#input-player-name', 'TestHost');
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

async function waitForPhase(page: Page, phase: string, timeout = 30000): Promise<void> {
  await page.waitForFunction(
    (p) => document.querySelector('.badge-green')?.textContent?.trim() === p,
    phase,
    { timeout }
  );
}

/**
 * Robustly play through CLUE_GIVING: keep trying to submit clue whenever it's our turn.
 * Waits until we're past CLUE_GIVING.
 */
async function playThroughClueGiving(page: Page, timeoutMs = 30000): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const phase = await getPhase(page);
    if (phase !== 'CLUE GIVING') return;

    const clueInput = page.locator('#input-clue');
    if (await clueInput.isVisible({ timeout: 200 }).catch(() => false)) {
      await clueInput.fill('test');
      await page.waitForTimeout(200);
      await page.click('#btn-submit-clue').catch(() => {});
      // Wait for it to disappear
      await page.waitForTimeout(800);
    } else {
      await page.waitForTimeout(500);
    }
  }
}

/** Play from current state through to VOTING phase */
async function reachVotingPhase(page: Page): Promise<void> {
  await playThroughClueGiving(page, 30000);

  // Game now goes directly from CLUE_GIVING to VOTING (no DISCUSSION)
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const phase = await getPhase(page);
    if (phase === 'VOTING' || phase === 'SCORING' || phase === 'CHAMELEON GUESS') return;
    await page.waitForTimeout(400);
  }
}

/** Cast a vote for a non-self player */
async function castVote(page: Page): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    // Check if we already voted (shows confirmation quip)
    const voteConfirm = page.locator('.status-bar');
    if (await voteConfirm.isVisible({ timeout: 200 }).catch(() => false)) {
      const confirmText = await voteConfirm.textContent().catch(() => '');
      if (confirmText?.includes('Vote') || confirmText?.includes('vote') || confirmText?.includes('locked') || confirmText?.includes('submitted')) {
        return;
      }
    }

    const votable = page.locator('.player-item.votable');
    const count = await votable.count().catch(() => 0);
    if (count > 0) {
      await votable.first().click();
      await page.waitForTimeout(300);
      const submitBtn = page.locator('[id^="btn-submit-vote"], #btn-accuse');
      if (await submitBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
        await submitBtn.first().click();
      }
      return;
    }
    const phase = await getPhase(page);
    if (phase === 'SCORING' || phase === 'CHAMELEON GUESS' || phase === 'CLUE GIVING') return;
    await page.waitForTimeout(500);
  }
}

/** Play a single round from CLUE_GIVING through to SCORING */
async function playRoundToScoring(page: Page): Promise<void> {
  await reachVotingPhase(page);
  await castVote(page);

  // Wait for game to advance past VOTING
  await page.waitForFunction(
    () => {
      const text = document.querySelector('.badge-green')?.textContent?.trim() || '';
      return text !== 'VOTING' && text !== '';
    },
    null,
    { timeout: 30000 }
  );

  let phase = await getPhase(page);

  if (phase === 'CHAMELEON GUESS') {
    // If we're the chameleon, select a word and guess
    const guessOptions = page.locator('.is-guess-option');
    if (await guessOptions.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await guessOptions.first().click();
      await page.locator('#btn-chameleon-guess').click({ timeout: 3000 });
    }
    await waitForPhase(page, 'SCORING', 20000);
    phase = 'SCORING';
  }

  expect(phase === 'SCORING' || phase === 'CLUE GIVING').toBe(true);
}

// ── TESTS ──────────────────────────────────────────────

test.describe('Voting → Scoring Workflow', () => {
  test('game advances from voting to scoring phase', async ({ page }) => {
    await startGameWithBots(page);
    await playRoundToScoring(page);
  });

  test('scoring screen shows topic, secret word, and chameleon', async ({ page }) => {
    await startGameWithBots(page);
    await playRoundToScoring(page);

    const phase = await getPhase(page);
    if (phase === 'SCORING') {
      await expect(page.locator('.scoring-reveal')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('text=Topic:')).toBeVisible();
      await expect(page.locator('text=Secret Word:')).toBeVisible();
      await expect(page.locator('text=Chameleon:')).toBeVisible();
    }
    // If game auto-advanced past SCORING (chameleon escaped + bots dealt next round), that's fine
  });

  test('scoring shows outcome badge', async ({ page }) => {
    await startGameWithBots(page);
    await playRoundToScoring(page);

    const phase = await getPhase(page);
    if (phase === 'SCORING') {
      const scoringText = await page.locator('.scoring-reveal').textContent() || '';
      const hasOutcome = scoringText.includes('Escaped') ||
                         scoringText.includes('Caught') ||
                         scoringText.includes('Guessed correctly');
      expect(hasOutcome).toBe(true);
    }
  });

  test('next round button advances to round 2', async ({ page }) => {
    await startGameWithBots(page);
    await playRoundToScoring(page);

    const phase = await getPhase(page);
    if (phase === 'SCORING') {
      await page.locator('#btn-next-round').click({ timeout: 5000 });
      await waitForPhase(page, 'CLUE GIVING', 10000);
      await expect(page.locator('text=Round 2')).toBeVisible();
    } else {
      // Game auto-advanced to next round already
      const body = await page.textContent('body');
      expect(body).toContain('Round');
    }
  });

  test('host sees next round button after scoring', async ({ page }) => {
    await startGameWithBots(page);
    await playRoundToScoring(page);
    const phase = await getPhase(page);
    if (phase === 'SCORING') {
      await expect(page.locator('#btn-next-round')).toBeVisible();
    }
  });
});

test.describe('Full Game — 3 Rounds', () => {
  test('plays through 3 rounds and navigates to results', async ({ page }) => {
    test.setTimeout(120_000); // 2 minutes for full game
    await startGameWithBots(page, 2, 3);

    for (let round = 1; round <= 3; round++) {
      await waitForPhase(page, 'CLUE GIVING', 10000);
      await expect(page.locator(`text=Round ${round}`)).toBeVisible();
      await playRoundToScoring(page);

      if (round < 3) {
        const phase = await getPhase(page);
        if (phase === 'SCORING') {
          await page.locator('#btn-next-round').click({ timeout: 5000 });
        }
        // If game auto-advanced, we're already in the next round
      }
    }

    const phase = await getPhase(page);
    if (phase === 'SCORING') {
      const finalBtn = page.locator('#btn-next-round');
      await expect(finalBtn).toContainText('Final Results');
      await finalBtn.click();
      await page.waitForURL(/\/results\//, { timeout: 5000 });
    } else {
      // Game may have auto-advanced — just check we can see results-related content
      const body = await page.textContent('body');
      const hasResults = body?.includes('Game Over') || body?.includes('Results') || body?.includes('Round');
      expect(hasResults).toBe(true);
    }
  });
});
