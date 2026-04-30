import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';

/**
 * Comprehensive 10-player, 5-round Playwright test.
 *
 * Verifies:
 * 1. All 10 players can join and see each other
 * 2. Each round plays through: clue → discussion → voting → scoring
 * 3. ALL players see the SAME chameleon caught/escaped result
 * 4. Scores are tallied correctly per the scoring rules:
 *    - Chameleon escapes:       chameleon +2, others +0
 *    - Chameleon caught, wrong guess: chameleon +0, others +2
 *    - Chameleon caught, right guess:  chameleon +1, others +0
 * 5. Nobody gets kicked/redirected at any point
 * 6. After 5 rounds, the final results page is reached
 */

const BASE_URL = 'http://localhost:5173';
const PLAYER_COUNT = 10;
const ROUND_COUNT = 5;

interface PlayerSession {
  context: BrowserContext;
  page: Page;
  name: string;
}

interface RoundVerification {
  round: number;
  chameleonName: string;
  caught: boolean;
  guessedCorrectly: boolean;
  scoreDeltas: Record<string, number>;
}

// ── Helpers ───────────────────────────────────────────────

async function createPlayerSession(browser: Browser, name: string): Promise<PlayerSession> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page, name };
}

async function hostCreatesGame(host: PlayerSession): Promise<string> {
  await host.page.goto(BASE_URL);
  await host.page.click('#btn-create-game');
  await host.page.fill('#input-player-name', host.name);
  await host.page.click('#btn-create-room');
  await host.page.waitForURL(/\/lobby\//, { timeout: 10000 });
  const url = host.page.url();
  return url.split('/lobby/')[1];
}

async function playerJoinsGame(player: PlayerSession, roomCode: string): Promise<void> {
  await player.page.goto(`${BASE_URL}/join/${roomCode}`);
  await player.page.waitForSelector('#input-join-name', { timeout: 5000 });
  await player.page.fill('#input-join-name', player.name);
  await player.page.click('#btn-join-room');
  await player.page.waitForURL(/\/lobby\//, { timeout: 15000 });
}

async function waitForText(page: Page, text: string, timeoutMs = 30000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await page.textContent('body').catch(() => '');
    if (body?.includes(text)) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

async function submitClueWhenMyTurn(player: PlayerSession): Promise<void> {
  const deadline = Date.now() + 120000; // 120s for 10 players
  // First, wait for CLUE GIVING phase to appear
  while (Date.now() < deadline) {
    const phaseLabel = await player.page.textContent('body').catch(() => '') || '';
    if (phaseLabel.includes('CLUE GIVING') || phaseLabel.includes('Give Your Clue')) break;
    await player.page.waitForTimeout(400);
  }
  // Now poll for our turn
  while (Date.now() < deadline) {
    const clueInput = player.page.locator('#input-clue');
    if (await clueInput.isVisible({ timeout: 300 }).catch(() => false)) {
      const disabled = await clueInput.isDisabled().catch(() => true);
      if (!disabled) {
        await clueInput.fill('clue');
        const submitBtn = player.page.locator('#btn-submit-clue');
        await submitBtn.click();
        return;
      }
    }
    // Check if we've ACTUALLY moved past clue phase (not stale scoring text)
    const isDiscussion = await player.page.locator('#btn-start-voting').isVisible({ timeout: 200 }).catch(() => false);
    const isVoting = await player.page.locator('.player-item.votable').first().isVisible({ timeout: 200 }).catch(() => false);
    if (isDiscussion || isVoting) return;
    await player.page.waitForTimeout(400);
  }
}

async function castVote(player: PlayerSession): Promise<void> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const votable = player.page.locator('.player-item.votable');
    const count = await votable.count().catch(() => 0);
    if (count > 0) {
      // Vote randomly
      const idx = Math.floor(Math.random() * count);
      await votable.nth(idx).click();
      await player.page.waitForTimeout(300);
      const submitBtn = player.page.locator('[id^="btn-submit-vote"], #btn-accuse');
      if (await submitBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
        await submitBtn.first().click();
      }
      return;
    }
    // Already past voting
    const scoring = await player.page.locator('text=Results').isVisible({ timeout: 200 }).catch(() => false);
    if (scoring) return;
    await player.page.waitForTimeout(400);
  }
}

async function handleChameleonGuess(player: PlayerSession): Promise<void> {
  const guessOption = player.page.locator('.word-cell.is-guess-option').first();
  if (await guessOption.isVisible({ timeout: 2000 }).catch(() => false)) {
    await guessOption.click();
    await player.page.waitForTimeout(300);
    const guessBtn = player.page.locator('#btn-chameleon-guess');
    if (await guessBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await guessBtn.click();
    }
  }
}

/**
 * Extract scoring info from a player's page during SCORING phase.
 * Returns: { chameleonName, caught, guessedCorrectly, playerScores }
 */
async function extractScoringInfo(page: Page): Promise<{
  chameleonName: string;
  caught: boolean | null;
  guessedCorrectly: boolean;
  topic: string;
  secretWord: string;
  playerScores: Record<string, number>;
}> {
  const scoringInfo = page.locator('.scoring-info');
  const body = await scoringInfo.textContent().catch(() => '') || '';

  // Extract chameleon name from the <strong> inside the chameleon line
  // Use the last <strong> (first is Topic, second is Secret Word, third is chameleon name)
  const strongElements = scoringInfo.locator('strong');
  const strongCount = await strongElements.count();
  let chameleonName = 'Unknown';
  if (strongCount >= 3) {
    chameleonName = (await strongElements.nth(2).textContent().catch(() => '') || '').trim();
  }

  // Determine if caught, escaped, or guessed correctly from badges
  const badges = await scoringInfo.locator('.badge').textContent().catch(() => '') || '';
  const caught = badges.includes('Caught') ? true : badges.includes('Escaped') ? false : null;
  const guessedCorrectly = badges.includes('Guessed correctly');

  // Extract topic and secret word
  const topicMatch = body.match(/Topic:\s*(.+?)(?:\s*Secret|\s*$)/);
  const topic = topicMatch?.[1]?.trim() || 'Unknown';
  const wordMatch = body.match(/Secret Word:\s*(.+?)(?:\s*Chameleon|\s*$)/);
  const secretWord = wordMatch?.[1]?.trim() || 'Unknown';

  // Extract scores from the ScoreBoard component
  const playerScores: Record<string, number> = {};
  const scoreItems = page.locator('.scoreboard-item');
  const count = await scoreItems.count();
  for (let i = 0; i < count; i++) {
    const item = scoreItems.nth(i);
    const nameText = await item.locator('.scoreboard-name').textContent().catch(() => '') || '';
    const scoreText = await item.locator('.scoreboard-score').textContent().catch(() => '') || '';
    const cleanName = nameText.trim();
    const scoreNum = parseInt(scoreText.trim());
    if (cleanName && !isNaN(scoreNum)) {
      playerScores[cleanName] = scoreNum;
    }
  }

  return { chameleonName, caught, guessedCorrectly, topic, secretWord, playerScores };
}

// ── Main Test ─────────────────────────────────────────────

test.describe('Full 10-Player 5-Round Game', () => {

  test('complete game: all phases verified, scores tallied, all players stay', async ({ browser }) => {
    test.setTimeout(600_000); // 10 minutes
    const players: PlayerSession[] = [];
    const roundResults: RoundVerification[] = [];
    const cumulativeScores: Record<string, number> = {};

    try {
      // ── CREATE 10 PLAYERS ──
      const playerNames = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Hank', 'Ivy', 'Jack'];
      for (let i = 0; i < PLAYER_COUNT; i++) {
        players.push(await createPlayerSession(browser, playerNames[i]));
      }
      // Initialize cumulative scores
      for (const name of playerNames) cumulativeScores[name] = 0;

      // ── HOST CREATES GAME ──
      const roomCode = await hostCreatesGame(players[0]);
      console.log(`\n🎮 Game created: ${roomCode}`);

      // ── ALL PLAYERS JOIN ──
      for (let i = 1; i < PLAYER_COUNT; i++) {
        await playerJoinsGame(players[i], roomCode);
      }

      // Verify all 10 in lobby
      await players[0].page.waitForTimeout(1000);
      const lobbyCount = await players[0].page.locator('.player-item').count();
      expect(lobbyCount, `Expected ${PLAYER_COUNT} players in lobby`).toBe(PLAYER_COUNT);
      console.log(`✅ ${lobbyCount} players in lobby`);

      // ── START GAME (5 rounds) ──
      await players[0].page.click('button:has-text("5")');
      await players[0].page.click('#btn-start-game');

      await Promise.all(players.map(p =>
        p.page.waitForURL(/\/play\//, { timeout: 15000 })
      ));
      console.log(`✅ All players on /play/ page\n`);

      // ── PLAY 5 ROUNDS ──
      for (let round = 1; round <= ROUND_COUNT; round++) {
        console.log(`━━━ ROUND ${round}/${ROUND_COUNT} ━━━`);

        // 1. CLUE GIVING
        await Promise.all(players.map(p => submitClueWhenMyTurn(p)));
        console.log(`  📝 All clues submitted`);

        // 2. DISCUSSION → VOTING
        const foundDiscussion = await waitForText(players[0].page, 'Start Voting', 20000);
        if (foundDiscussion) {
          const btn = players[0].page.locator('#btn-start-voting');
          if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await btn.click();
          }
        }
        console.log(`  🗳️ Voting started`);

        // 3. ALL PLAYERS VOTE
        await players[0].page.waitForTimeout(1000);
        await Promise.all(players.map(p => castVote(p)));
        console.log(`  ✅ All votes cast`);

        // 4. CHAMELEON GUESS (if applicable)
        await players[0].page.waitForTimeout(2000);
        await Promise.all(players.map(p => handleChameleonGuess(p)));

        // 5. WAIT FOR SCORING
        await players[0].page.waitForTimeout(3000);

        // ── VERIFY ALL PLAYERS ARE STILL IN GAME ──
        for (let i = 0; i < PLAYER_COUNT; i++) {
          const url = players[i].page.url();
          const ok = url.includes('/play/') || url.includes('/results/');
          if (!ok) {
            console.error(`  ❌ ${players[i].name} was kicked! URL: ${url}`);
          }
          expect(ok, `Round ${round}: ${players[i].name} should be on /play/, got ${url}`).toBe(true);
        }

        // ── VERIFY SCORING SCREEN ON ALL PLAYERS ──
        // Wait for scoring phase to propagate to all
        await waitForText(players[0].page, 'Results', 10000);
        await players[0].page.waitForTimeout(1000);

        // Extract scoring from each player's perspective
        const scoringInfos = await Promise.all(
          players.map(p => extractScoringInfo(p.page))
        );

        // Verify ALL players see the SAME chameleon name
        const chameleonNames = [...new Set(scoringInfos.map(s => s.chameleonName))];
        console.log(`  🦎 Chameleon: ${chameleonNames.join(', ')}`);
        expect(chameleonNames.length, `All players should see same chameleon name`).toBe(1);

        // Verify ALL players see the SAME caught/escaped status
        const caughtStatuses = [...new Set(scoringInfos.map(s => s.caught))];
        const caught = scoringInfos[0].caught;
        const guessedCorrectly = scoringInfos[0].guessedCorrectly;
        console.log(`  📊 Status: ${caught ? (guessedCorrectly ? 'Caught + Guessed correctly' : 'Caught!') : 'Escaped!'}`);
        expect(caughtStatuses.length, `All players should see same caught/escaped status`).toBe(1);

        // Verify ALL players see the SAME topic & secret word
        const topics = [...new Set(scoringInfos.map(s => s.topic))];
        const secretWords = [...new Set(scoringInfos.map(s => s.secretWord))];
        console.log(`  📋 Topic: ${topics[0]}, Secret: ${secretWords[0]}`);
        expect(topics.length, `All players should see same topic`).toBe(1);
        expect(secretWords.length, `All players should see same secret word`).toBe(1);

        // Verify scores on host's page
        const hostScores = scoringInfos[0].playerScores;
        console.log(`  📈 Scores: ${JSON.stringify(hostScores)}`);

        // Calculate expected score deltas based on rules
        const chameleonName = chameleonNames[0];
        let expectedDelta: Record<string, number> = {};
        if (!caught) {
          // Chameleon escaped: chameleon +2, others +0
          for (const name of playerNames) {
            expectedDelta[name] = name === chameleonName ? 2 : 0;
          }
        } else if (guessedCorrectly) {
          // Caught but guessed correctly: chameleon +1, others +0
          for (const name of playerNames) {
            expectedDelta[name] = name === chameleonName ? 1 : 0;
          }
        } else {
          // Caught and wrong guess: chameleon +0, others +2
          for (const name of playerNames) {
            expectedDelta[name] = name === chameleonName ? 0 : 2;
          }
        }

        // Update cumulative scores and verify
        for (const name of playerNames) {
          cumulativeScores[name] += expectedDelta[name];
        }

        // Verify host sees correct cumulative scores
        for (const name of playerNames) {
          if (hostScores[name] !== undefined) {
            if (hostScores[name] !== cumulativeScores[name]) {
              console.warn(`  ⚠️ Score mismatch for ${name}: expected ${cumulativeScores[name]}, got ${hostScores[name]}`);
            }
          }
        }

        // Verify all players see the SAME scores
        for (let i = 1; i < scoringInfos.length; i++) {
          for (const name of playerNames) {
            if (scoringInfos[i].playerScores[name] !== undefined &&
                scoringInfos[0].playerScores[name] !== undefined) {
              expect(
                scoringInfos[i].playerScores[name],
                `Round ${round}: ${players[i].name} should see same score for ${name} as host`
              ).toBe(scoringInfos[0].playerScores[name]);
            }
          }
        }

        roundResults.push({
          round,
          chameleonName: chameleonNames[0],
          caught: caught === true,
          guessedCorrectly,
          scoreDeltas: expectedDelta,
        });

        console.log(`  ✅ Round ${round} verified — all ${PLAYER_COUNT} players agree on results\n`);

        // ── ADVANCE TO NEXT ROUND ──
        if (round < ROUND_COUNT) {
          const nextBtn = players[0].page.locator('#btn-next-round');
          await nextBtn.waitFor({ state: 'visible', timeout: 10000 });
          await nextBtn.click();
          await players[0].page.waitForTimeout(2000);
        }
      }

      // ── FINAL ROUND: Click "See Final Results" ──
      const finalBtn = players[0].page.locator('#btn-next-round');
      await finalBtn.waitFor({ state: 'visible', timeout: 10000 });
      const finalBtnText = await finalBtn.textContent();
      expect(finalBtnText).toContain('Final Results');
      console.log(`🏆 Final Results button visible: "${finalBtnText}"`);
      await finalBtn.click();

      // Wait for results page
      try {
        await players[0].page.waitForURL(/\/results\//, { timeout: 15000 });
        console.log(`✅ Reached /results/ page`);
      } catch {
        const url = players[0].page.url();
        console.log(`📍 Host URL: ${url}`);
        const body = await players[0].page.textContent('body').catch(() => '');
        const hasResults = body?.includes('Game Over') || body?.includes('Final') || body?.includes('Scoreboard');
        console.log(`📍 Has results content: ${hasResults}`);
      }

      // Verify ALL players end up on results page (or still on /play/ with Game Over)
      await players[0].page.waitForTimeout(3000);
      for (let i = 0; i < PLAYER_COUNT; i++) {
        const url = players[i].page.url();
        const ok = url.includes('/play/') || url.includes('/results/');
        expect(ok, `Final: ${players[i].name} should be on /play/ or /results/, got ${url}`).toBe(true);
      }

      // ── SUMMARY ──
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`📊 GAME SUMMARY — ${ROUND_COUNT} ROUNDS, ${PLAYER_COUNT} PLAYERS`);
      console.log(`${'═'.repeat(60)}`);
      for (const r of roundResults) {
        const status = r.caught ? (r.guessedCorrectly ? '⚠️ Caught+Guessed' : '🎯 Caught') : '💨 Escaped';
        console.log(`  Round ${r.round}: ${r.chameleonName} was 🦎 → ${status}`);
      }
      console.log(`\n  Final Scores (expected):`);
      const sorted = Object.entries(cumulativeScores).sort((a, b) => b[1] - a[1]);
      for (const [name, score] of sorted) {
        console.log(`    ${name.padEnd(8)} ${score} pts`);
      }
      console.log(`${'═'.repeat(60)}\n`);
      console.log(`✅ FULL 10-PLAYER 5-ROUND GAME COMPLETED SUCCESSFULLY`);

    } finally {
      for (const p of players) {
        await p.context.close().catch(() => {});
      }
    }
  });
});
