import { expect, test } from '@playwright/test';

const E2E_USERNAME = process.env.E2E_USERNAME;
const E2E_PASSWORD = process.env.E2E_PASSWORD;
const CUSTOM_CONDITIONS_KEY = 'custom-formats:general:conditions';

async function ensureAuthenticated(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/settings/general');
  await page.waitForLoadState('networkidle');

  if (page.url().includes('/settings/general') || page.url().includes('/settings/security')) {
    return;
  }

  if (!E2E_USERNAME || !E2E_PASSWORD) {
    test.skip('AUTH is required. Set E2E_USERNAME and E2E_PASSWORD to run auth-gated UI e2e tests.');
  }
}

async function getDatabaseIdFromRoot(page: import('@playwright/test').Page): Promise<number | null> {
  await page.goto('/custom-formats');
  await page.waitForLoadState('networkidle');

  const match = page.url().match(/\/custom-formats\/(\d+)/);
  if (!match) {
    return null;
  }

  return Number(match[1]);
}

test.describe('Progressive complexity reference integration', () => {
  test('advanced tier pre-expands the custom-format conditions section', async ({ page }) => {
    await ensureAuthenticated(page);

    const databaseId = await getDatabaseIdFromRoot(page);
    if (!databaseId) {
      test.skip('No linked custom format database found for progressive complexity checks.');
    }

    const seedResponse = await page.request.fetch('/api/v1/complexity-tiers', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({
        section_key: CUSTOM_CONDITIONS_KEY,
        tier: 'advanced',
      }),
    });
    if (seedResponse.status() === 401) {
      test.skip(
        'Complexity tier APIs require authenticated user context. Set E2E_USERNAME and E2E_PASSWORD and run with AUTH=on.'
      );
    }
    if (!seedResponse.ok()) {
      const payload = await seedResponse.text();
      throw new Error(`Failed to seed complexity tier: ${seedResponse.status()} ${payload}`);
    }

    await page.goto(`/custom-formats/${databaseId}/new`);
    await expect(page.locator(`[id="${CUSTOM_CONDITIONS_KEY}-panel"]`)).toBeVisible();
  });
});
