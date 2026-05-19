/**
 * Opens 3 browser windows, creates a multiplayer game, and plays through all rounds.
 * Run while `npm run dev` is active (default: http://localhost:5173 or 5174).
 */
import { chromium } from '@playwright/test';

const BASE = process.env.PLAY_URL || 'http://localhost:5174';
const ROUNDS = Number(process.env.ROUNDS || 3);

async function hostCreates(page, name) {
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.click('#btn-create-game');
  await page.fill('#input-player-name', name);
  await page.click('#btn-create-room');
  await page.waitForURL(/\/lobby\//, { timeout: 10000 });
  const roomCode = (await page.locator('.room-code').textContent())?.trim() || '';
  return roomCode;
}

async function playerJoins(page, name, roomCode) {
  await page.goto(`${BASE}/join/${roomCode}`);
  await page.fill('#input-join-name', name);
  await page.click('#btn-join-room');
  await page.waitForURL(/\/lobby\//, { timeout: 10000 });
}

async function submitClueIfMyTurn(page) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const input = page.locator('#input-clue');
    if (await input.isVisible({ timeout: 200 }).catch(() => false)) {
      const disabled = await input.isDisabled().catch(() => true);
      if (!disabled) {
        await input.fill(['ocean', 'swift', 'bright', 'mystic', 'fuzzy'][Math.floor(Math.random() * 5)]);
        await page.click('#btn-submit-clue');
        return;
      }
    }
    const voting = await page.locator('text=Cast Your Vote').isVisible({ timeout: 200 }).catch(() => false);
    if (voting) return;
    await page.waitForTimeout(400);
  }
}

async function voteIfNeeded(page) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const votable = page.locator('.player-item.votable');
    const count = await votable.count().catch(() => 0);
    if (count > 0) {
      await votable.first().click();
      await page.waitForTimeout(200);
      const btn = page.locator('[id^="btn-submit-vote"]');
      if (await btn.first().isVisible({ timeout: 500 }).catch(() => false)) {
        await btn.first().click();
      }
      return;
    }
    const scoring = await page.locator('text=/Round \\d+ Results/').isVisible({ timeout: 200 }).catch(() => false);
    if (scoring) return;
    await page.waitForTimeout(400);
  }
}

async function kiwiGuessIfNeeded(page) {
  const cell = page.locator('.word-cell.is-guess-option').first();
  if (await cell.isVisible({ timeout: 2000 }).catch(() => false)) {
    await cell.click();
    const btn = page.locator('#btn-kiwi-guess');
    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await btn.click();
    }
  }
}

async function playOneRound(pages, roundNum) {
  console.log(`Round ${roundNum}/${ROUNDS} — clues → vote → score…`);
  await Promise.all(pages.map((p) => submitClueIfMyTurn(p)));
  await pages[0].waitForSelector('text=Cast Your Vote', { timeout: 30000 });
  await Promise.all(pages.map((p) => voteIfNeeded(p)));
  await pages[0].waitForTimeout(1500);
  await Promise.all(pages.map((p) => kiwiGuessIfNeeded(p)));
  await pages[0].waitForSelector('text=/Round \\d+ Results/', { timeout: 45000 });
}

async function hostAdvanceRound(hostPage, isLastRound) {
  const btn = hostPage.locator('#btn-next-round');
  await btn.waitFor({ state: 'visible', timeout: 10000 });
  await btn.click();
  if (isLastRound) {
    await hostPage.waitForURL(/\/results\//, { timeout: 15000 });
    await hostPage.waitForSelector('text=Game Over', { timeout: 10000 }).catch(() => {});
  } else {
    await hostPage.waitForFunction(
      () => !document.body.textContent?.match(/Round \d+ Results/),
      null,
      { timeout: 15000 }
    ).catch(() => {});
    await hostPage.waitForTimeout(800);
  }
}

const browser = await chromium.launch({ headless: false, slowMo: 80 });
const names = ['Alex (Host)', 'Sam', 'Jordan'];
const contexts = await Promise.all(names.map(() => browser.newContext()));
const pages = await Promise.all(contexts.map((ctx) => ctx.newPage()));

try {
  const roomCode = await hostCreates(pages[0], names[0]);
  console.log(`\n🥝 Room code: ${roomCode}\n   ${BASE}/join/${roomCode}\n`);

  await Promise.all([playerJoins(pages[1], names[1], roomCode), playerJoins(pages[2], names[2], roomCode)]);

  await pages[0].waitForFunction(
    () => document.querySelectorAll('.player-item').length >= 3,
    null,
    { timeout: 10000 }
  );

  await pages[0].locator('.lobby-rounds-selector button', { hasText: String(ROUNDS) }).click();
  await pages[0].click('#btn-start-game');
  await Promise.all(pages.map((p) => p.waitForURL(/\/play\//, { timeout: 15000 })));

  for (let r = 1; r <= ROUNDS; r++) {
    await playOneRound(pages, r);
    if (r < ROUNDS) {
      await hostAdvanceRound(pages[0], false);
    }
  }

  console.log('\nFinal round — opening results…');
  await hostAdvanceRound(pages[0], true);

  console.log(`\n✅ Game complete (${ROUNDS} rounds). Windows stay open — press Ctrl+C to exit.\n`);
  await new Promise((resolve) => {
    process.on('SIGINT', resolve);
    process.on('SIGTERM', resolve);
  });
  await browser.close();
} catch (err) {
  console.error(err);
  await browser.close();
  process.exit(1);
}
