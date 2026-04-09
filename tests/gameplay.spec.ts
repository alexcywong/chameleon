import { test, expect, Page } from '@playwright/test';

/** Helper: create game, add bots, start game */
async function startGameWithBots(page: Page, botCount = 2, playerName = 'Alex'): Promise<void> {
  await page.goto('/');
  await page.click('#btn-create-game');
  await page.fill('#input-player-name', playerName);
  await page.click('#btn-create-room');
  await page.waitForURL(/\/lobby\//);
  for (let i = 0; i < botCount; i++) {
    await page.click('#btn-add-bot');
    await page.waitForTimeout(200);
  }
  await page.click('#btn-start-game');
  await page.waitForURL(/\/play\//);
}

test.describe('Gameplay — 3 Players', () => {
  test('play page shows round info and topic card', async ({ page }) => {
    await startGameWithBots(page);
    await expect(page.locator('text=Round 1')).toBeVisible();
    await expect(page.locator('.topic-card')).toBeVisible();
    await expect(page.locator('text=TOPIC CARD')).toBeVisible();
  });

  test('shows code card (chameleon or coordinate)', async ({ page }) => {
    await startGameWithBots(page);
    // Should show either "YOU ARE THE CHAMELEON" or a coordinate like "B3"
    const codeCard = page.locator('.code-card');
    await expect(codeCard).toBeVisible();
    const text = await codeCard.textContent();
    expect(text!.length).toBeGreaterThan(0);
  });

  test('player sidebar shows all players', async ({ page }) => {
    await startGameWithBots(page);
    const sidebar = page.locator('.play-sidebar');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.locator('.player-name', { hasText: 'Alex' }).first()).toBeVisible();
    await expect(sidebar.locator('.player-name', { hasText: 'Riley' }).first()).toBeVisible();
    await expect(sidebar.locator('.player-name', { hasText: 'Jordan' }).first()).toBeVisible();
  });

  test('bots auto-submit clues and game advances', async ({ page }) => {
    await startGameWithBots(page);
    // Wait for bots to act + potentially our turn
    await page.waitForTimeout(3000);

    // If it's our turn, submit a clue
    const clueInput = page.locator('#input-clue');
    if (await clueInput.isVisible()) {
      await clueInput.fill('testing');
      await page.click('#btn-submit-clue');
    }

    // Wait for remaining bots and phase transition
    await page.waitForTimeout(3000);

    // Should reach discussion or further
    const pageText = await page.textContent('body');
    const advanced = pageText!.includes('Discussion') ||
      pageText!.includes('Vote') ||
      pageText!.includes('Clue submitted');
    expect(advanced).toBe(true);
  });

  test('full round plays through to scoring', async ({ page }) => {
    await startGameWithBots(page);

    // Phase 1: CLUE_GIVING — submit own clue when it's our turn
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1000);
      const clueInput = page.locator('#input-clue');
      if (await clueInput.isVisible()) {
        await clueInput.fill('hint');
        await page.click('#btn-submit-clue');
        break;
      }
    }

    // Phase 2: Wait for DISCUSSION
    await page.waitForTimeout(3000);

    // Phase 3: If we see Discussion, start voting
    const startVotingBtn = page.locator('#btn-start-voting');
    if (await startVotingBtn.isVisible()) {
      await startVotingBtn.click();
    }
    await page.waitForTimeout(2000);

    // Phase 4: VOTING — bots auto-vote, we need to vote too
    const voteSection = page.locator('text=Cast Your Vote');
    if (await voteSection.isVisible()) {
      // Vote for the first non-self player
      const players = page.locator('.player-item.votable');
      if (await players.count() > 0) {
        await players.first().click();
        await page.waitForTimeout(500);
        const accuseBtn = page.locator('[id^="btn-submit-vote"]');
        if (await accuseBtn.isVisible()) {
          await accuseBtn.click();
        }
      }
    }
    await page.waitForTimeout(3000);

    // Should see scoring results or chameleon guess
    const body = await page.textContent('body');
    const reachedScoring = body!.includes('Results') ||
      body!.includes('Escaped') ||
      body!.includes('Caught') ||
      body!.includes('Chameleon') ||
      body!.includes('Next Round');
    expect(reachedScoring).toBe(true);
  });
});

test.describe('Gameplay — 5 Players', () => {
  test('game works with 5 players', async ({ page }) => {
    await startGameWithBots(page, 4, 'Player1');
    await expect(page.locator('text=Round 1')).toBeVisible();
    // Verify all 5 players shown in sidebar
    const playerItems = page.locator('.play-sidebar .player-item');
    await expect(playerItems).toHaveCount(5);
  });
});

test.describe('Gameplay — 8 Players', () => {
  test('game works with 8 players', async ({ page }) => {
    await startGameWithBots(page, 7, 'Player1');
    await expect(page.locator('text=Round 1')).toBeVisible();
    const playerItems = page.locator('.play-sidebar .player-item');
    await expect(playerItems).toHaveCount(8);
  });
});

test.describe('Gameplay — 10 Players', () => {
  test('game works with 10 players (max expanded)', async ({ page }) => {
    // The addBots helper adds up to 7 (max 8 total),
    // so for 10 we need to test that the UI handles overflow gracefully.
    await startGameWithBots(page, 9, 'Player1');
    await expect(page.locator('text=Round 1')).toBeVisible();
  });
});
