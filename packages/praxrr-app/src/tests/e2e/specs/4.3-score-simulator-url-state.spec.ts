import { expect, test, type Page, type Route } from '@playwright/test';

const E2E_USERNAME = process.env.E2E_USERNAME;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

const SINGLE_RELEASE_TITLE = 'E2E.URLSTATE.ALPHA.2024.1080p.WEB';
const BATCH_ALPHA_TITLE = 'E2E.URLSTATE.ALPHA.BATCH.2024.1080p.WEB';
const BATCH_BETA_TITLE = 'E2E.URLSTATE.BETA.BATCH.2024.1080p.WEB';

interface ProfileContext {
  databaseId: number;
  profileName: string;
}

interface SimulateRequestBody {
  releases?: Array<{ id: string; title: string; type: 'movie' | 'series' }>;
  profileNames?: string[];
}

function buildContributions(title: string): Array<{ cfName: string; score: number }> {
  const upper = title.toUpperCase();
  if (upper.includes('BETA')) {
    return [{ cfName: 'CF Beta', score: 110 }];
  }

  if (upper.includes('ALPHA')) {
    return [
      { cfName: 'CF Alpha', score: 120 },
      { cfName: 'CF Shared', score: 30 },
    ];
  }

  return [{ cfName: 'CF Alpha', score: 100 }];
}

function buildSimulateResponse(body: SimulateRequestBody) {
  const releases = body.releases ?? [];
  const profileNames = body.profileNames && body.profileNames.length > 0 ? body.profileNames : ['pcd:E2E Profile'];

  return {
    parserAvailable: false,
    results: releases.map((release) => {
      const contributions = buildContributions(release.title);
      const totalScore = contributions.reduce((sum, contribution) => sum + contribution.score, 0);

      return {
        id: release.id,
        title: release.title,
        parsed: null,
        cfMatches: contributions.map((contribution) => ({
          name: contribution.cfName,
          matches: true,
          conditions: [],
        })),
        profileScores: profileNames.map((profileName) => ({
          profileName,
          totalScore,
          minimumScore: 100,
          upgradeUntilScore: 150,
          contributions,
        })),
      };
    }),
  };
}

async function handleSimulateRoute(route: Route): Promise<void> {
  const requestBody = (route.request().postDataJSON() ?? {}) as SimulateRequestBody;
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(buildSimulateResponse(requestBody)),
  });
}

async function installSimulationMocks(page: Page): Promise<void> {
  await page.route('**/api/v1/parser/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ parserAvailable: false }),
    });
  });

  await page.route('**/api/v1/simulate/score', handleSimulateRoute);
}

async function setupClipboardMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const writes: string[] = [];
    (window as { __praxrrClipboardWrites?: string[] }).__praxrrClipboardWrites = writes;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(value: string) {
          writes.push(value);
          return Promise.resolve();
        },
      },
    });
  });
}

async function getClipboardWrites(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    return (window as { __praxrrClipboardWrites?: string[] }).__praxrrClipboardWrites ?? [];
  });
}

async function ensureAuthenticated(page: Page): Promise<void> {
  await page.goto('/settings/general');
  await page.waitForLoadState('networkidle');

  if (page.url().includes('/settings/general') || page.url().includes('/settings/security')) {
    return;
  }

  if (page.url().includes('/auth/setup')) {
    if (!E2E_USERNAME || !E2E_PASSWORD) {
      test.skip('AUTH is required. Set E2E_USERNAME and E2E_PASSWORD to run auth-gated UI e2e tests.');
    }

    await page.getByRole('textbox', { name: 'Username' }).fill(E2E_USERNAME!);
    await page.getByLabel('Password').fill(E2E_PASSWORD!);
    await page.getByLabel('Confirm Password').fill(E2E_PASSWORD!);
    await page.getByRole('button', { name: 'Create Account' }).click();
    await page.waitForLoadState('networkidle');
  }

  if (page.url().includes('/auth/login')) {
    if (!E2E_USERNAME || !E2E_PASSWORD) {
      test.skip('AUTH is required. Set E2E_USERNAME and E2E_PASSWORD to run auth-gated UI e2e tests.');
    }

    await page.getByRole('textbox', { name: 'Username' }).fill(E2E_USERNAME!);
    await page.getByLabel('Password').fill(E2E_PASSWORD!);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForLoadState('networkidle');
  }
}

async function findQualityProfileContext(page: Page): Promise<ProfileContext | null> {
  await page.goto('/quality-profiles');
  await page.waitForLoadState('networkidle');

  const dbMatch = page.url().match(/\/quality-profiles\/(\d+)/);
  if (!dbMatch) {
    return null;
  }

  const firstRow = page.locator('table tbody tr').first();
  if ((await firstRow.count()) === 0) {
    return null;
  }

  const profileName = (await firstRow.locator('td').first().innerText()).trim();
  if (!profileName) {
    return null;
  }

  return {
    databaseId: Number.parseInt(dbMatch[1], 10),
    profileName,
  };
}

test.describe('4.3 Score Simulator URL state sharing', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    await setupClipboardMock(page);
    await installSimulationMocks(page);
    await ensureAuthenticated(page);
  });

  test('Copy Full Link restores title/profile/overrides/batch state in a fresh browser context', async ({ page }) => {
    const context = await findQualityProfileContext(page);
    if (!context) {
      test.skip('No quality profile context found for URL state restoration checks.');
    }

    const simulatorUrl = `/score-simulator/${context!.databaseId}?profile=${encodeURIComponent(`pcd:${context!.profileName}`)}&arrType=radarr`;
    await page.goto(simulatorUrl);
    await page.waitForLoadState('networkidle');

    await page.locator('#score-simulator-title').fill(SINGLE_RELEASE_TITLE);
    await page.getByRole('button', { name: 'Simulate' }).last().click();

    const scoreBreakdown = page
      .locator('div.rounded-lg')
      .filter({ has: page.getByText('Total Score') })
      .first();
    const alphaRow = scoreBreakdown.locator('li', { hasText: 'CF Alpha' }).first();
    await expect(alphaRow).toBeVisible();

    await alphaRow.locator('button').first().click();
    await alphaRow.locator('input[type="number"]').fill('40');
    await alphaRow.locator('input[type="number"]').blur();
    await expect(scoreBreakdown.getByText(/Current:\s*70/)).toBeVisible();

    await page.getByRole('button', { name: 'Show Advanced' }).click();
    await page.locator('#batch-input-textarea').fill(`${BATCH_ALPHA_TITLE}\n${BATCH_BETA_TITLE}`);

    await page.getByRole('button', { name: 'Copy Full Link' }).click();
    await expect(
      page.locator('div[role="button"]').filter({ hasText: 'Full link copied to clipboard.' }).last()
    ).toBeVisible();

    const clipboardWrites = await getClipboardWrites(page);
    expect(clipboardWrites.length).toBeGreaterThan(0);
    const copiedUrl = clipboardWrites.at(-1);
    expect(copiedUrl).toBeTruthy();
    expect(copiedUrl!).toContain('batch=');
    expect(copiedUrl!).toContain('overrides=');

    const sourceContext = page.context();
    const browser = sourceContext.browser();
    if (!browser) {
      throw new Error('Browser instance unavailable for fresh-context URL restoration test.');
    }

    const freshContext = await browser.newContext({ storageState: await sourceContext.storageState() });
    const freshPage = await freshContext.newPage();
    await installSimulationMocks(freshPage);

    await freshPage.goto(copiedUrl!);
    await freshPage.waitForLoadState('networkidle');

    await expect(freshPage.locator('#score-simulator-title')).toHaveValue(SINGLE_RELEASE_TITLE);

    const freshReleaseInputCard = freshPage
      .locator('div.rounded-lg')
      .filter({ has: freshPage.getByRole('heading', { name: 'Single Release Score Simulation' }) })
      .first();
    await expect(freshReleaseInputCard.getByRole('button', { name: context!.profileName })).toBeVisible();

    const freshScoreBreakdown = freshPage
      .locator('div.rounded-lg')
      .filter({ has: freshPage.getByText('Total Score') })
      .first();
    const freshAlphaRow = freshScoreBreakdown.locator('li', { hasText: 'CF Alpha' }).first();
    await expect(freshAlphaRow).toHaveClass(/bg-amber-50/);
    await expect(freshAlphaRow.locator('span.line-through')).toContainText('120');
    await expect(freshScoreBreakdown.getByText(/Current:\s*70/)).toBeVisible();

    await freshPage.getByRole('button', { name: 'Show Advanced' }).click();
    await expect(freshPage.locator('#batch-input-textarea')).toHaveValue(`${BATCH_ALPHA_TITLE}\n${BATCH_BETA_TITLE}`);

    await freshContext.close();
  });

  test('non-existent profile in URL shows warning and leaves profile selector unselected', async ({ page }) => {
    const context = await findQualityProfileContext(page);
    if (!context) {
      test.skip('No quality profile context found for invalid URL profile checks.');
    }

    const invalidProfile = 'pcd:Profile Does Not Exist';
    const url = `/score-simulator/${context!.databaseId}?title=${encodeURIComponent(SINGLE_RELEASE_TITLE)}&profile=${encodeURIComponent(invalidProfile)}&arrType=radarr`;
    await page.goto(url);
    await page.waitForLoadState('networkidle');

    await expect(
      page.locator('div[role="button"]').filter({ hasText: 'Profile from URL not found in this database.' }).last()
    ).toBeVisible();

    const releaseInputCard = page
      .locator('div.rounded-lg')
      .filter({ has: page.getByRole('heading', { name: 'Single Release Score Simulation' }) })
      .first();
    await expect(releaseInputCard.getByRole('button', { name: 'Select quality profile...' })).toBeVisible();
  });
});
