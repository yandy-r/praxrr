import { expect, test, type Page } from '@playwright/test';
import { goToQualityProfileScoring } from '../helpers/entity';

const E2E_USERNAME = process.env.E2E_USERNAME;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

interface ProfileContext {
  databaseId: number;
  profileName: string;
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

async function findQualityProfileContext(page: Page, requireSpaceInName: boolean): Promise<ProfileContext | null> {
  await page.goto('/quality-profiles');
  await page.waitForLoadState('networkidle');

  const dbMatch = page.url().match(/\/quality-profiles\/(\d+)/);
  if (!dbMatch) {
    return null;
  }

  const rows = page.locator('table tbody tr');
  const rowCount = await rows.count();
  if (rowCount === 0) {
    return null;
  }

  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);
    const profileName = (await row.locator('td').first().innerText()).trim();
    if (!profileName) {
      continue;
    }
    if (requireSpaceInName && !profileName.includes(' ')) {
      continue;
    }

    return {
      databaseId: Number.parseInt(dbMatch[1], 10),
      profileName,
    };
  }

  return null;
}

test.describe('4.1 Score Simulator deep-link', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    await ensureAuthenticated(page);
  });

  test('scoring page Simulate button deep-links with encoded profile and prefilled simulator state', async ({
    page,
  }) => {
    const context = await findQualityProfileContext(page, true);
    if (!context) {
      test.skip('No quality profile with spaces in name found for deep-link encoding validation.');
    }

    await goToQualityProfileScoring(page, context!.databaseId, context!.profileName);

    const simulateButton = page.getByRole('button', { name: 'Simulate' });
    await expect(simulateButton).toBeVisible();

    await Promise.all([
      page.waitForURL(new RegExp(`/score-simulator/${context!.databaseId}\\?.*`), { timeout: 15_000 }),
      simulateButton.click(),
    ]);

    const currentUrl = new URL(page.url());
    const expectedProfileParam = `pcd:${context!.profileName}`;
    const expectedEncodedProfile = encodeURIComponent(expectedProfileParam);

    expect(currentUrl.pathname).toBe(`/score-simulator/${context!.databaseId}`);
    expect(currentUrl.searchParams.get('profile')).toBe(expectedProfileParam);
    expect(currentUrl.searchParams.get('arrType')).toBe('radarr');
    expect(currentUrl.search).toContain(`profile=${expectedEncodedProfile}`);

    const releaseInputCard = page
      .locator('div.rounded-lg')
      .filter({ has: page.getByRole('heading', { name: 'Single Release Score Simulation' }) })
      .first();
    await expect(releaseInputCard.getByRole('button', { name: context!.profileName })).toBeVisible();

    const movieButton = releaseInputCard.getByRole('button', { name: 'Movie' });
    await expect(movieButton).toHaveClass(/border-accent/);
  });
});
