import { test, expect } from '@playwright/test';

test.describe('Home Page', () => {
  test('renders the home page with title and buttons', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Chameleon');
    await expect(page.locator('#btn-create-game')).toBeVisible();
    await expect(page.locator('#btn-join-game')).toBeVisible();
  });

  test('opens create game form when clicking Create Game', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-create-game');
    await expect(page.locator('#input-player-name')).toBeVisible();
    await expect(page.locator('#btn-create-room')).toBeVisible();
  });

  test('opens join game form when clicking Join Game', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-join-game');
    await expect(page.locator('#input-room-code')).toBeVisible();
    await expect(page.locator('#input-join-name')).toBeVisible();
  });

  test('cannot create room with empty name', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-create-game');
    const btn = page.locator('#btn-create-room');
    await expect(btn).toBeDisabled();
  });

  test('creates a room with valid name', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-create-game');
    await page.fill('#input-player-name', 'TestPlayer');
    await page.click('#btn-create-room');
    await page.waitForURL(/\/lobby\//);
    await expect(page.url()).toMatch(/\/lobby\/[A-Z0-9]+/);
  });
});
