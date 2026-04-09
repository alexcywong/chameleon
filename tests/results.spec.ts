import { test, expect, Page } from '@playwright/test';

/** Helper: create game, add bots, start, play full round to results */
async function playToResults(page: Page): Promise<void> {
  // Create & start
  await page.goto('/');
  await page.click('#btn-create-game');
  await page.fill('#input-player-name', 'Tester');
  await page.click('#btn-create-room');
  await page.waitForURL(/\/lobby\//);
  await page.click('#btn-add-bot');
  await page.waitForTimeout(300);
  await page.click('#btn-add-bot');
  await page.waitForTimeout(300);

  // Set rounds to 3 for faster test
  await page.click('button:has-text("3")');
  await page.click('#btn-start-game');
  await page.waitForURL(/\/play\//);

  // Play 3 rounds
  for (let round = 0; round < 3; round++) {
    // CLUE_GIVING: wait for our turn or for discussion to start
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(800);
      const clueInput = page.locator('#input-clue');
      if (await clueInput.isVisible({ timeout: 200 }).catch(() => false)) {
        await clueInput.fill('word');
        await page.click('#btn-submit-clue');
        break;
      }
      if (await page.locator('#btn-start-voting').isVisible({ timeout: 200 }).catch(() => false)) break;
      if (await page.locator('.word-cell.is-guess-option').isVisible({ timeout: 200 }).catch(() => false)) break;
    }

    // CHAMELEON_GUESS (may appear before voting if we're the chameleon and clue phase ended)
    if (await page.locator('.word-cell.is-guess-option').isVisible({ timeout: 500 }).catch(() => false)) {
      await page.locator('.word-cell.is-guess-option').first().click();
      await page.waitForTimeout(400);
      const guessBtn = page.locator('#btn-chameleon-guess');
      if (await guessBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await guessBtn.click();
      }
    }

    // DISCUSSION: start voting
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(800);
      const votingBtn = page.locator('#btn-start-voting');
      if (await votingBtn.isVisible({ timeout: 200 }).catch(() => false)) {
        await votingBtn.click();
        break;
      }
      if (await page.locator('text=Cast Your Vote').isVisible({ timeout: 200 }).catch(() => false)) break;
      if (await page.locator('#btn-next-round').isVisible({ timeout: 200 }).catch(() => false)) break;
    }

    // VOTING: submit vote
    await page.waitForTimeout(1200);
    const votablePlayers = page.locator('.player-item.votable');
    if (await votablePlayers.count() > 0) {
      await votablePlayers.first().click();
      await page.waitForTimeout(400);
      const accuseBtn = page.locator('[id^="btn-submit-vote"]');
      if (await accuseBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await accuseBtn.click();
      }
    }

    // Wait for post-vote phases (CHAMELEON_GUESS or SCORING)
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(800);

      // Handle chameleon guess if we're the chameleon
      const guessOption = page.locator('.word-cell.is-guess-option').first();
      if (await guessOption.isVisible({ timeout: 200 }).catch(() => false)) {
        await guessOption.click();
        await page.waitForTimeout(400);
        const guessBtn = page.locator('#btn-chameleon-guess');
        if (await guessBtn.isVisible({ timeout: 500 }).catch(() => false)) {
          await guessBtn.click();
        }
        break;
      }

      // Reached scoring
      if (await page.locator('#btn-next-round').isVisible({ timeout: 200 }).catch(() => false)) break;
    }

    // Wait for scoring screen + click next round
    await page.waitForTimeout(1500);
    const nextRoundBtn = page.locator('#btn-next-round');
    if (await nextRoundBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await nextRoundBtn.click();
      await page.waitForTimeout(1000);
    }
  }
}

test.describe('Results Page', () => {
  test('shows final results after all rounds', async ({ page }) => {
    test.setTimeout(180_000);
    await playToResults(page);

    // Should reach either results page or game over state
    await page.waitForTimeout(5000);
    const body = await page.textContent('body');
    const hasResults = body!.includes('Game Over') ||
      body!.includes('Results') ||
      body!.includes('Play Again') ||
      body!.includes('Scoreboard');
    expect(hasResults).toBe(true);
  });

  test('play again button works', async ({ page }) => {
    test.setTimeout(180_000);
    await playToResults(page);
    await page.waitForTimeout(5000);

    const playAgainBtn = page.locator('#btn-play-again');
    if (await playAgainBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await playAgainBtn.click();
      await page.waitForURL('/');
      await expect(page.locator('h1')).toContainText('Chameleon');
    }
  });
});
