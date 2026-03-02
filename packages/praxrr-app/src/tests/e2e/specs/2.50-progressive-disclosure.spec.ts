import { expect, type BrowserContext, type Locator, type Page, test } from '@playwright/test';

const E2E_USERNAME = process.env.E2E_USERNAME;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

const CUSTOM_CONDITIONS_KEY = 'custom-formats:general:conditions';
const MEDIA_NAMING_KEY = 'media-management:media-settings:naming';

function getAdvancedToggle(page: Page, sectionKey: string): Locator {
  return page.locator(`button[aria-controls="${sectionKey}-panel"]`);
}

function getAdvancedPanel(page: Page, sectionKey: string): Locator {
  return page.locator(`[id="${sectionKey}-panel"]`);
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

  if (page.url().includes('/auth/login') || page.url().includes('/auth/setup')) {
    test.fail('Authentication flow did not complete for e2e tests.');
  }
}

async function getDatabaseIdFromRoot(
  page: Page,
  section: 'custom-formats' | 'media-management'
): Promise<number | null> {
  await page.goto(`/${section}`);
  await page.waitForLoadState('networkidle');

  const match = page.url().match(new RegExp(`/${section}/(\\d+)`));
  if (!match) {
    return null;
  }

  return Number(match[1]);
}

async function setUiPreference(page: Page, sectionKey: string, mode: 'basic' | 'advanced'): Promise<void> {
  const response = await page.request.fetch('/api/v1/ui-preferences', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
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

async function buildFreshContextWithAuthCookies(sourceContext: BrowserContext): Promise<BrowserContext> {
  const sourceBrowser = sourceContext.browser();
  if (!sourceBrowser) {
    throw new Error('Browser instance is not available for context recreation in this test environment.');
  }

  const state = await sourceContext.storageState();
  const freshState = {
    cookies: state.cookies,
    origins: state.origins.map((entry) => ({
      ...entry,
      localStorage: [],
    })),
  };

  return sourceBrowser.newContext({
    storageState: freshState,
  });
}

test.describe('Progressive disclosure persistence and UX', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    await ensureAuthenticated(page);
  });

  test('Show/Hide advanced labels reflect aria-expanded state on first visit defaults', async ({ page }) => {
    await setUiPreference(page, CUSTOM_CONDITIONS_KEY, 'basic');

    const databaseId = await getDatabaseIdFromRoot(page, 'custom-formats');
    if (!databaseId) {
      test.skip('No linked custom format database found for UI persistence checks.');
    }

    await page.goto(`/custom-formats/${databaseId}/new`);
    await page.waitForLoadState('networkidle');

    const toggle = getAdvancedToggle(page, CUSTOM_CONDITIONS_KEY);
    const panel = getAdvancedPanel(page, CUSTOM_CONDITIONS_KEY);

    await expect(toggle).toHaveText('Show Advanced');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();

    await toggle.click();

    await expect(toggle).toHaveText('Hide Advanced');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();

    await toggle.click();

    await expect(toggle).toHaveText('Show Advanced');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
  });

  test('Advanced disclosure persists after refresh and a new session', async ({ page }) => {
    await setUiPreference(page, CUSTOM_CONDITIONS_KEY, 'basic');

    const databaseId = await getDatabaseIdFromRoot(page, 'custom-formats');
    if (!databaseId) {
      test.skip('No linked custom format database found for UI persistence checks.');
    }

    await page.goto(`/custom-formats/${databaseId}/new`);
    await page.waitForLoadState('networkidle');

    const toggle = getAdvancedToggle(page, CUSTOM_CONDITIONS_KEY);
    const panel = getAdvancedPanel(page, CUSTOM_CONDITIONS_KEY);

    const writeResponse = page.waitForResponse((response) => {
      if (!response.url().endsWith('/api/v1/ui-preferences')) {
        return false;
      }
      if (response.request().method() !== 'PATCH') {
        return false;
      }

      const requestBody = response.request().postDataJSON();
      return requestBody.section_key === CUSTOM_CONDITIONS_KEY;
    });
    await toggle.click();
    await writeResponse;

    await expect(toggle).toHaveText('Hide Advanced');
    await expect(panel).toBeVisible();

    await page.reload();
    await page.waitForLoadState('networkidle');

    const refreshedToggle = getAdvancedToggle(page, CUSTOM_CONDITIONS_KEY);
    const refreshedPanel = getAdvancedPanel(page, CUSTOM_CONDITIONS_KEY);
    await expect(refreshedToggle).toHaveText('Hide Advanced');
    await expect(refreshedPanel).toBeVisible();

    const freshContext = await buildFreshContextWithAuthCookies(page.context());
    const freshPage = await freshContext.newPage();
    await freshPage.goto(`/custom-formats/${databaseId}/new`);
    await freshPage.waitForLoadState('networkidle');

    const freshToggle = getAdvancedToggle(freshPage, CUSTOM_CONDITIONS_KEY);
    const freshPanel = getAdvancedPanel(freshPage, CUSTOM_CONDITIONS_KEY);
    await expect(freshToggle).toHaveText('Hide Advanced');
    await expect(freshPanel).toBeVisible();
    await freshContext.close();
  });

  test('media-management preferences do not affect custom-format advanced sections', async ({ page }) => {
    await setUiPreference(page, MEDIA_NAMING_KEY, 'advanced');
    await setUiPreference(page, CUSTOM_CONDITIONS_KEY, 'basic');

    const databaseId = await getDatabaseIdFromRoot(page, 'custom-formats');
    if (!databaseId) {
      test.skip('No linked custom format database found for UI persistence checks.');
    }

    await page.goto(`/custom-formats/${databaseId}/new`);
    await page.waitForLoadState('networkidle');

    const toggle = getAdvancedToggle(page, CUSTOM_CONDITIONS_KEY);
    const panel = getAdvancedPanel(page, CUSTOM_CONDITIONS_KEY);

    await expect(toggle).toHaveText('Show Advanced');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
  });
});
