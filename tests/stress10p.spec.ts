import { test, expect, Page } from '@playwright/test';

/**
 * Stress test: play 5 full games with 10 players each.
 * Each game runs 3 rounds to completion.
 */

async function playFullGame(page: Page, gameNum: number): Promise<string> {
  // 1. Create game
  await page.goto('/');
  await page.click('#btn-create-game');
  await page.fill('#input-player-name', `Host${gameNum}`);
  await page.click('#btn-create-room');
  await page.waitForURL(/\/lobby\//);

  // 2. Add 9 bots (10 players total)
  for (let b = 0; b < 9; b++) {
    await page.click('#btn-add-bot');
    await page.waitForTimeout(200);
  }

  // Verify 10 players in lobby
  const playerItems = page.locator('.player-item');
  await expect(playerItems).toHaveCount(10);

  // 3. Start game with 3 rounds for speed
  await page.click('button:has-text("3")');
  await page.click('#btn-start-game');
  await page.waitForURL(/\/play\//);

  // 4. Play 3 rounds
  for (let round = 0; round < 3; round++) {
    // CLUE_GIVING: wait for our turn or for discussion to start
    for (let i = 0; i < 25; i++) {
      await page.waitForTimeout(800);
      const clueInput = page.locator('#input-clue');
      if (await clueInput.isVisible({ timeout: 200 }).catch(() => false)) {
        await clueInput.fill(`clue${round}`);
        await page.click('#btn-submit-clue');
        break;
      }
      if (await page.locator('#btn-start-voting').isVisible({ timeout: 200 }).catch(() => false)) break;
      if (await page.locator('.word-cell.is-guess-option').isVisible({ timeout: 200 }).catch(() => false)) break;
    }

    // CHAMELEON_GUESS (before voting — if we're the chameleon)
    if (await page.locator('.word-cell.is-guess-option').isVisible({ timeout: 500 }).catch(() => false)) {
      await page.locator('.word-cell.is-guess-option').first().click();
      await page.waitForTimeout(400);
      const guessBtn = page.locator('#btn-chameleon-guess');
      if (await guessBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await guessBtn.click();
      }
    }

    // DISCUSSION → start voting
    for (let i = 0; i < 15; i++) {
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
    await page.waitForTimeout(1500);
    const votable = page.locator('.player-item.votable');
    if (await votable.count() > 0) {
      await votable.first().click();
      await page.waitForTimeout(400);
      const accuseBtn = page.locator('[id^="btn-submit-vote"]');
      if (await accuseBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await accuseBtn.click();
      }
    }

    // Wait for post-vote phases
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(1000);
      const guessOption = page.locator('.word-cell.is-guess-option').first();
      if (await guessOption.isVisible({ timeout: 200 }).catch(() => false)) {
        await guessOption.click();
        await page.waitForTimeout(300);
        const guessBtn = page.locator('#btn-chameleon-guess');
        if (await guessBtn.isVisible({ timeout: 300 }).catch(() => false)) {
          await guessBtn.click();
        }
        break;
      }
      if (await page.locator('#btn-next-round').isVisible({ timeout: 200 }).catch(() => false)) break;
    }

    // SCORING: next round
    await page.waitForTimeout(1500);
    const nextRoundBtn = page.locator('#btn-next-round');
    if (await nextRoundBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nextRoundBtn.click();
      await page.waitForTimeout(1000);
    }
  }

  // 5. Should reach results
  await page.waitForTimeout(3000);
  const body = await page.textContent('body');
  const hasResults = body!.includes('Game Over') ||
    body!.includes('Results') ||
    body!.includes('Play Again') ||
    body!.includes('Scoreboard') ||
    body!.includes('Final');

  return hasResults ? 'PASS' : 'INCOMPLETE';
}

test.describe('10-Player Stress Test', () => {
  for (let i = 1; i <= 5; i++) {
    test(`game ${i} of 5: 10 players, 3 rounds`, async ({ page }) => {
      test.setTimeout(180_000); // 3 minutes per game
      const result = await playFullGame(page, i);
      expect(result).toBe('PASS');
    });
  }
});
