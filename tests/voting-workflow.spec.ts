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
  return (await page.locator('.badge-green').textContent() || '').trim();
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
async function playThroughClueGiving(page: Page, timeout = 30000): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const phase = await getPhase(page);
    if (phase !== 'CLUE GIVING') return;

    const clueInput = page.locator('#input-clue');
    if (await clueInput.isVisible({ timeout: 300 }).catch(() => false)) {
      // Use click + clear + type to ensure React's onChange fires
      await clueInput.click();
      await clueInput.fill('');
      await clueInput.type('test', { delay: 30 });
      await page.waitForTimeout(200);
      const sendBtn = page.locator('#btn-submit-clue');
      if (await sendBtn.isVisible({ timeout: 300 }).catch(() => false)) {
        // Make sure the button is not disabled
        const disabled = await sendBtn.isDisabled();
        if (!disabled) {
          await sendBtn.click();
          // Wait for the clue to actually get processed
          await page.waitForTimeout(500);
        }
      }
    }
    await page.waitForTimeout(500);
  }
}

/** Play from current state through to VOTING phase */
async function reachVotingPhase(page: Page): Promise<void> {
  await playThroughClueGiving(page, 30000);
  await waitForPhase(page, 'DISCUSSION', 15000);
  await page.click('#btn-start-voting');
  await waitForPhase(page, 'VOTING', 5000);
}

/** Cast a vote for a non-self player */
async function castVote(page: Page): Promise<void> {
  const votable = page.locator('.player-item.votable');
  await votable.first().click({ timeout: 5000 });
  await page.locator('#btn-submit-vote').click({ timeout: 5000 });
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

  expect(phase).toBe('SCORING');
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

    await expect(page.locator('.scoring-reveal')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Topic:')).toBeVisible();
    await expect(page.locator('text=Secret Word:')).toBeVisible();
    await expect(page.locator('text=Chameleon:')).toBeVisible();
  });

  test('scoring shows outcome badge', async ({ page }) => {
    await startGameWithBots(page);
    await playRoundToScoring(page);

    const scoringText = await page.locator('.scoring-reveal').textContent() || '';
    const hasOutcome = scoringText.includes('Escaped') ||
                       scoringText.includes('Caught') ||
                       scoringText.includes('Guessed correctly');
    expect(hasOutcome).toBe(true);
  });

  test('next round button advances to round 2', async ({ page }) => {
    await startGameWithBots(page);
    await playRoundToScoring(page);

    await page.locator('#btn-next-round').click({ timeout: 5000 });
    await waitForPhase(page, 'CLUE GIVING', 10000);
    await expect(page.locator('text=Round 2')).toBeVisible();
  });

  test('host sees next round button after scoring', async ({ page }) => {
    await startGameWithBots(page);
    await playRoundToScoring(page);
    await expect(page.locator('#btn-next-round')).toBeVisible();
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
        await page.locator('#btn-next-round').click({ timeout: 5000 });
      }
    }

    const finalBtn = page.locator('#btn-next-round');
    await expect(finalBtn).toContainText('Final Results');
    await finalBtn.click();
    await page.waitForURL(/\/results\//, { timeout: 5000 });
  });
});
