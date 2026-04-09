import { test, expect, Page } from '@playwright/test';

/** Helper: create a game and navigate to lobby */
async function createGame(page: Page, playerName = 'Host'): Promise<string> {
  await page.goto('/');
  await page.click('#btn-create-game');
  await page.fill('#input-player-name', playerName);
  await page.click('#btn-create-room');
  await page.waitForURL(/\/lobby\//);
  const url = page.url();
  return url.split('/lobby/')[1];
}

/** Helper: add N bot players */
async function addBots(page: Page, count: number) {
  for (let i = 0; i < count; i++) {
    await page.click('#btn-add-bot');
    await page.waitForTimeout(300);
  }
}

test.describe('Lobby Page', () => {
  test('shows room code after creating game', async ({ page }) => {
    const roomCode = await createGame(page);
    expect(roomCode).toMatch(/^[A-Z0-9]{6}$/);
    await expect(page.locator('.room-code')).toContainText(roomCode);
  });

  test('shows the host player with crown', async ({ page }) => {
    await createGame(page, 'Alex');
    await expect(page.locator('text=Alex')).toBeVisible();
    await expect(page.locator('text=(you)')).toBeVisible();
  });

  test('start button is disabled with fewer than 3 players', async ({ page }) => {
    await createGame(page);
    const btn = page.locator('#btn-start-game');
    await expect(btn).toBeDisabled();
    await expect(btn).toContainText('Waiting for players');
  });

  test('can add bot players in local mode', async ({ page }) => {
    await createGame(page);
    await addBots(page, 2);
    await expect(page.locator('text=Riley')).toBeVisible();
    await expect(page.locator('text=Jordan')).toBeVisible();
  });

  test('start button enables at 3 players', async ({ page }) => {
    await createGame(page);
    await addBots(page, 2);
    const btn = page.locator('#btn-start-game');
    await expect(btn).toBeEnabled();
    await expect(btn).toContainText('Start Game');
  });

  test('shows "Need X more" badge when < 3 players', async ({ page }) => {
    await createGame(page);
    await expect(page.locator('.badge-amber')).toContainText('Need 2 more');
    await addBots(page, 1);
    await expect(page.locator('.badge-amber')).toContainText('Need 1 more');
  });

  test('shows "Ready!" badge at 3+ players', async ({ page }) => {
    await createGame(page);
    await addBots(page, 2);
    await expect(page.locator('.badge-green')).toContainText('Ready!');
  });

  test('can add up to 9 bots (10 players total)', async ({ page }) => {
    await createGame(page);
    await addBots(page, 9);
    // Should have 10 players (host + 9 bots), bot button should be gone
    await expect(page.locator('#btn-add-bot')).toBeHidden();
  });

  test('copy code button exists', async ({ page }) => {
    await createGame(page);
    await expect(page.locator('text=Copy Code')).toBeVisible();
    await expect(page.locator('text=Copy Link')).toBeVisible();
  });

  test('navigates to play page on game start', async ({ page }) => {
    await createGame(page);
    await addBots(page, 2);
    await page.click('#btn-start-game');
    await page.waitForURL(/\/play\//);
    expect(page.url()).toMatch(/\/play\/[A-Z0-9]+/);
  });
});
