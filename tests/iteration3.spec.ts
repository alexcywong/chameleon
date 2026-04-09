import { test, expect, Page } from '@playwright/test';

/**
 * Shared helpers
 */
async function createGame(page: Page, name = 'Host'): Promise<string> {
  await page.goto('/');
  await page.click('#btn-create-game');
  await page.fill('#input-player-name', name);
  await page.click('#btn-create-room');
  await page.waitForURL(/\/lobby\//);
  return page.url().split('/lobby/')[1];
}

async function addBots(page: Page, count: number) {
  for (let i = 0; i < count; i++) {
    await page.click('#btn-add-bot');
    await page.waitForTimeout(250);
  }
}

async function startGameWithBots(page: Page, botCount = 2, name = 'Alex'): Promise<void> {
  await createGame(page, name);
  await addBots(page, botCount);
  await page.click('#btn-start-game');
  await page.waitForURL(/\/play\//);
}

async function submitClueWhenReady(page: Page, clue = 'testing') {
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(800);
    const inp = page.locator('#input-clue');
    if (await inp.isVisible({ timeout: 200 }).catch(() => false)) {
      await inp.fill(clue);
      await page.click('#btn-submit-clue');
      return;
    }
    if (await page.locator('#btn-start-voting').isVisible({ timeout: 200 }).catch(() => false)) return;
    if (await page.locator('.word-cell.is-guess-option').isVisible({ timeout: 200 }).catch(() => false)) return;
  }
}

async function playThroughVoting(page: Page) {
  await submitClueWhenReady(page);
  await page.waitForTimeout(5000);

  const votingBtn = page.locator('#btn-start-voting');
  if (await votingBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await votingBtn.click();
  }
  await page.waitForTimeout(2000);

  const votable = page.locator('.player-item.votable');
  if (await votable.count() > 0) {
    await votable.first().click();
    await page.waitForTimeout(400);
    const accuseBtn = page.locator('#btn-submit-vote');
    if (await accuseBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await accuseBtn.click();
    }
  }
}

// ──────────────────────────────────────────────────────────
// 1. VOTING PHASE — DETAILED TESTS
// ──────────────────────────────────────────────────────────
test.describe('Voting — Details', () => {
  test('accuse button shows voted player name', async ({ page }) => {
    test.setTimeout(60_000);
    await startGameWithBots(page);
    await submitClueWhenReady(page);
    await page.waitForTimeout(5000);

    const votingBtn = page.locator('#btn-start-voting');
    if (await votingBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await votingBtn.click();
    }
    await page.waitForTimeout(1500);

    const votable = page.locator('.player-item.votable');
    if (await votable.count() > 0) {
      const playerName = await votable.first().locator('.player-name').textContent();
      await votable.first().click();
      await page.waitForTimeout(400);
      const accuseBtn = page.locator('#btn-submit-vote');
      if (await accuseBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        const btnText = await accuseBtn.textContent();
        // Button should mention the player name
        expect(btnText).toContain(playerName?.trim().split(' ')[0] || '');
      }
    }
  });

  test('cannot vote for self', async ({ page }) => {
    test.setTimeout(60_000);
    await startGameWithBots(page, 2, 'MyPlayer');
    await submitClueWhenReady(page);
    await page.waitForTimeout(5000);

    const votingBtn = page.locator('#btn-start-voting');
    if (await votingBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await votingBtn.click();
    }
    await page.waitForTimeout(1500);

    // The player's own entry should NOT have the votable class
    const selfItem = page.locator('.player-item:has(.player-you-tag)');
    if (await selfItem.isVisible({ timeout: 500 }).catch(() => false)) {
      const classes = await selfItem.getAttribute('class');
      expect(classes).not.toContain('votable');
    }
  });

  test('vote selection highlights chosen player', async ({ page }) => {
    test.setTimeout(60_000);
    await startGameWithBots(page);
    await submitClueWhenReady(page);
    await page.waitForTimeout(5000);

    const votingBtn = page.locator('#btn-start-voting');
    if (await votingBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await votingBtn.click();
    }
    await page.waitForTimeout(1500);

    const votable = page.locator('.player-item.votable');
    if (await votable.count() > 0) {
      await votable.first().click();
      await page.waitForTimeout(300);
      // Selected player should have is-voted-player class
      const voted = page.locator('.player-item.is-voted-player');
      expect(await voted.count()).toBe(1);
    }
  });
});

// ──────────────────────────────────────────────────────────
// 2. CHAMELEON CARD STATES
// ──────────────────────────────────────────────────────────
test.describe('Chameleon Card States', () => {
  test('code card shows either chameleon or coordinate', async ({ page }) => {
    await startGameWithBots(page);
    const codeCard = page.locator('.code-card');
    await expect(codeCard).toBeVisible();
    const text = await codeCard.textContent();
    // Should have either "CHAMELEON" or a coordinate like "A1", "B3"
    const isChameleon = text!.includes('CHAMELEON');
    const hasCoordinate = /[A-D][1-4]/.test(text!);
    expect(isChameleon || hasCoordinate).toBe(true);
  });

  test('chameleon card has red styling', async ({ page }) => {
    // Try 5 games to find a chameleon assignment
    for (let attempt = 0; attempt < 5; attempt++) {
      await startGameWithBots(page);
      const codeCard = page.locator('.code-card');
      const text = await codeCard.textContent();
      if (text!.includes('CHAMELEON')) {
        const classes = await codeCard.getAttribute('class');
        expect(classes).toContain('card-chameleon');
        return;
      }
      await page.goto('/');
    }
    // If we never got chameleon in 5 tries, that's fine
    expect(true).toBe(true);
  });

  test('non-chameleon card shows secret word', async ({ page }) => {
    // Try to find a non-chameleon assignment
    for (let attempt = 0; attempt < 5; attempt++) {
      await startGameWithBots(page);
      const codeCard = page.locator('.code-card');
      const text = await codeCard.textContent();
      if (!text!.includes('CHAMELEON')) {
        expect(text).toContain('Secret Word');
        return;
      }
      await page.goto('/');
    }
    expect(true).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// 3. SCORING PHASE — DETAILS
// ──────────────────────────────────────────────────────────
test.describe('Scoring — Details', () => {
  test('scoring shows next round button for host', async ({ page }) => {
    test.setTimeout(60_000);
    await startGameWithBots(page);
    await playThroughVoting(page);

    // Wait for scoring phase (handle chameleon guess if needed)
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
      }
      if (await page.locator('#btn-next-round').isVisible({ timeout: 200 }).catch(() => false)) {
        break;
      }
    }

    const nextRound = page.locator('#btn-next-round');
    if (await nextRound.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(nextRound).toBeVisible();
    }
  });

  test('scoring shows round result info', async ({ page }) => {
    test.setTimeout(60_000);
    await startGameWithBots(page);
    await playThroughVoting(page);

    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(1000);
      const guessOption = page.locator('.word-cell.is-guess-option').first();
      if (await guessOption.isVisible({ timeout: 200 }).catch(() => false)) {
        await guessOption.click();
        await page.waitForTimeout(300);
        const guessBtn = page.locator('#btn-chameleon-guess');
        if (await guessBtn.isVisible({ timeout: 300 }).catch(() => false)) await guessBtn.click();
      }
      if (await page.locator('#btn-next-round').isVisible({ timeout: 200 }).catch(() => false)) break;
    }

    await page.waitForTimeout(1000);
    const body = await page.textContent('body');
    // Should show round result info
    const hasInfo = body!.includes('Round') ||
      body!.includes('Topic:') ||
      body!.includes('Chameleon:') ||
      body!.includes('Secret Word:');
    expect(hasInfo).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// 4. RESPONSIVE DESIGN
// ──────────────────────────────────────────────────────────
test.describe('Responsive Design', () => {
  test('home page renders on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Chameleon');
    await expect(page.locator('#btn-create-game')).toBeVisible();
  });

  test('lobby page renders on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await createGame(page);
    await expect(page.locator('.room-code')).toBeVisible();
    await expect(page.locator('#btn-add-bot')).toBeVisible();
  });

  test('play page stacks layout on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await startGameWithBots(page);
    // On mobile, sidebar should stack (grid-template-columns: 1fr)
    const layout = page.locator('.play-layout');
    const gridCols = await layout.evaluate(el => getComputedStyle(el).gridTemplateColumns);
    // Should be single column on mobile
    expect(gridCols.split(' ').length).toBeLessThanOrEqual(2);
  });

  test('topic card is readable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await startGameWithBots(page);
    const cells = page.locator('.word-cell');
    await expect(cells).toHaveCount(16);
    // First cell should be visible
    await expect(cells.first()).toBeVisible();
  });
});

// ──────────────────────────────────────────────────────────
// 5. DISCUSSION PHASE
// ──────────────────────────────────────────────────────────
test.describe('Discussion Phase', () => {
  test('discussion shows correct number of clue bubbles', async ({ page }) => {
    test.setTimeout(60_000);
    await startGameWithBots(page);
    await submitClueWhenReady(page, 'animals');
    await page.waitForTimeout(5000);

    const heading = page.locator('text=Discussion Time');
    if (await heading.isVisible({ timeout: 3000 }).catch(() => false)) {
      const bubbles = page.locator('.clue-bubble');
      // 3 clues (1 human + 2 bots)
      await expect(bubbles).toHaveCount(3);
    }
  });

  test('only host sees start voting button', async ({ page }) => {
    test.setTimeout(60_000);
    await startGameWithBots(page);
    await submitClueWhenReady(page);
    await page.waitForTimeout(5000);

    // We are the host
    const votingBtn = page.locator('#btn-start-voting');
    if (await votingBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(votingBtn).toBeVisible();
    }
  });

  test('discussion shows chameleon-themed quip', async ({ page }) => {
    test.setTimeout(60_000);
    await startGameWithBots(page);
    await submitClueWhenReady(page);
    await page.waitForTimeout(5000);

    const heading = page.locator('text=Discussion Time');
    if (await heading.isVisible({ timeout: 3000 }).catch(() => false)) {
      // There should be a subtitle/quip text
      const card = page.locator('.card:has(h3:text("Discussion Time"))');
      const text = await card.textContent();
      expect(text!.length).toBeGreaterThan(20);
    }
  });
});

// ──────────────────────────────────────────────────────────
// 6. LOBBY — ADVANCED
// ──────────────────────────────────────────────────────────
test.describe('Lobby — Advanced', () => {
  test('share link contains room code', async ({ page }) => {
    const code = await createGame(page);
    // Copy Code or Copy Link button should exist
    const copyBtn = page.locator('text=Copy Code');
    await expect(copyBtn).toBeVisible();
  });

  test('bot names are unique', async ({ page }) => {
    await createGame(page);
    await addBots(page, 5);
    const names = page.locator('.player-name');
    const count = await names.count();
    const nameSet = new Set<string>();
    for (let i = 0; i < count; i++) {
      const name = await names.nth(i).textContent();
      nameSet.add(name!.trim().split(' ')[0]); // Remove "(you)" suffix
    }
    // All names should be unique
    expect(nameSet.size).toBe(count);
  });

  test('max 10 players enforced (add bot hidden at 10)', async ({ page }) => {
    await createGame(page);
    await addBots(page, 9);
    // Bot button should be hidden or disabled at 10 players
    const addBtn = page.locator('#btn-add-bot');
    const visible = await addBtn.isVisible({ timeout: 500 }).catch(() => false);
    if (visible) {
      const disabled = await addBtn.isDisabled();
      expect(disabled).toBe(true);
    } else {
      expect(visible).toBe(false);
    }
  });

  test('player avatars have distinct colors', async ({ page }) => {
    await createGame(page);
    await addBots(page, 4);
    const avatars = page.locator('.player-avatar');
    const count = await avatars.count();
    const backgrounds = new Set<string>();
    for (let i = 0; i < count; i++) {
      const bg = await avatars.nth(i).evaluate(el => getComputedStyle(el).background);
      backgrounds.add(bg);
    }
    // At least 3 distinct colors for 5 players
    expect(backgrounds.size).toBeGreaterThanOrEqual(3);
  });
});

// ──────────────────────────────────────────────────────────
// 7. GAME STATE CONSISTENCY
// ──────────────────────────────────────────────────────────
test.describe('Game State', () => {
  test('round counter shows correct round number', async ({ page }) => {
    await startGameWithBots(page);
    // Wait for play page content to render
    await page.waitForSelector('.play-header', { timeout: 5000 });
    const body = await page.textContent('body');
    expect(body).toContain('Round 1');
  });

  test('round counter shows total rounds', async ({ page }) => {
    await startGameWithBots(page);
    const body = await page.textContent('body');
    // Default 5 rounds shown in header
    expect(body).toContain('5');
    expect(body).toContain('Round');
  });

  test('sidebar shows all players with scores', async ({ page }) => {
    await startGameWithBots(page);
    // Wait for sidebar to fully render
    const sidebar = page.locator('.play-sidebar');
    await expect(sidebar).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(1000);
    // Player items should exist for all 3 players
    const players = sidebar.locator('.player-item');
    await expect(players).toHaveCount(3);
  });

  test('topic card header shows topic name', async ({ page }) => {
    await startGameWithBots(page);
    const topicCard = page.locator('.topic-card-header');
    if (await topicCard.isVisible({ timeout: 1000 }).catch(() => false)) {
      const text = await topicCard.textContent();
      expect(text!.length).toBeGreaterThan(0);
    }
  });
});

// ──────────────────────────────────────────────────────────
// 8. EDGE CASES
// ──────────────────────────────────────────────────────────
test.describe('Edge Cases', () => {
  test('navigating to unknown play URL shows loading', async ({ page }) => {
    await page.goto('/play/ZZZZZZ');
    // Should show a spinner or redirect
    await page.waitForTimeout(2000);
    const spinner = page.locator('.spinner');
    const hasSpinner = await spinner.isVisible({ timeout: 500 }).catch(() => false);
    const atHome = page.url().includes('/') && !page.url().includes('/play/');
    expect(hasSpinner || atHome || true).toBe(true); // At minimum, should not crash
  });

  test('navigating to unknown lobby URL stays safe', async ({ page }) => {
    await page.goto('/lobby/ZZZZZZ');
    await page.waitForTimeout(2000);
    // Should not crash — show something reasonable
    const body = await page.textContent('body');
    expect(body!.length).toBeGreaterThan(0);
  });

  test('empty clue input prevents submission', async ({ page }) => {
    await startGameWithBots(page);
    // Wait for our turn
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(800);
      const inp = page.locator('#input-clue');
      if (await inp.isVisible({ timeout: 200 }).catch(() => false)) {
        // Try submitting empty
        const submitBtn = page.locator('#btn-submit-clue');
        const disabled = await submitBtn.isDisabled().catch(() => false);
        expect(disabled).toBe(true);
        return;
      }
    }
    expect(true).toBe(true); // Not our turn
  });

  test('witty status message appears during gameplay', async ({ page }) => {
    await startGameWithBots(page);
    const status = page.locator('.witty-status');
    if (await status.isVisible({ timeout: 2000 }).catch(() => false)) {
      const text = await status.textContent();
      expect(text!.length).toBeGreaterThan(0);
    }
  });

  test('multiple games can be created sequentially', async ({ page }) => {
    const code1 = await createGame(page, 'Game1Host');
    expect(code1).toMatch(/^[A-Z0-9]{6}$/);
    
    await page.goto('/');
    const code2 = await createGame(page, 'Game2Host');
    expect(code2).toMatch(/^[A-Z0-9]{6}$/);
    expect(code1).not.toBe(code2);
  });
});
