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

async function setUiPreference(
  page: import('@playwright/test').Page,
  sectionKey: string,
  mode: 'basic' | 'advanced'
): Promise<void> {
  const response = await page.request.fetch('/api/v1/ui-preferences', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    data: JSON.stringify({
      section_key: sectionKey,
      mode,
    }),
  });
  if (!response.ok()) {
    const payload = await response.text();
    throw new Error(`Failed to set preference ${sectionKey}: ${response.status()} ${payload}`);
  }
}

async function getFirstCustomFormatGeneralUrl(
  page: import('@playwright/test').Page,
  databaseId: number
): Promise<string | null> {
  await page.goto(`/custom-formats/${databaseId}`);
  await page.waitForLoadState('networkidle');

  const firstRow = page.locator('table tbody tr').first();
  if ((await firstRow.count()) === 0) {
    return null;
  }

  await expect(firstRow).toBeVisible();
  await firstRow.click();
  await page.waitForURL(/\/custom-formats\/\d+\/\d+/, { timeout: 15_000 });

  const match = page.url().match(/\/custom-formats\/(\d+)\/(\d+)/);
  if (!match) {
    return null;
  }

  return `/custom-formats/${match[1]}/${match[2]}/general`;
}

test.describe('Progressive complexity reference integration', () => {
  test('advanced tier pre-expands the custom-format conditions section', async ({ page }) => {
    await ensureAuthenticated(page);

    const databaseId = await getDatabaseIdFromRoot(page);
    if (!databaseId) {
      test.skip('No linked custom format database found for progressive complexity checks.');
    }

    await setUiPreference(page, CUSTOM_CONDITIONS_KEY, 'basic');

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

    const generalUrl = await getFirstCustomFormatGeneralUrl(page, databaseId);
    if (!generalUrl) {
      test.skip('No custom formats found for progressive complexity checks.');
    }

    await page.goto(generalUrl);
    await page.waitForLoadState('networkidle');

    const panel = page.locator(`[id="${CUSTOM_CONDITIONS_KEY}-panel"]`);
    await expect(panel).toBeVisible({ timeout: 15_000 });
  });
});
