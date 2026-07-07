import { expect, type Page, test } from '@playwright/test';

const E2E_USERNAME = process.env.E2E_USERNAME;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

/**
 * Log in (or create the first account) the same way the other e2e specs do,
 * then report whether the wizard's forward gate redirected us into `/setup`.
 * Unlike `/settings/general` et al, the wizard has no stable "already past
 * auth" landing page to check against, so callers branch on the final URL.
 */
async function signInAndLandWhereverTheGateSends(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

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

/**
 * 5.1 Setup wizard happy path.
 *
 * Exercises the first-run wizard end-to-end: a fresh deployment's forward
 * gate (`resolveWizardRedirect`) forces every page navigation into `/setup`,
 * the welcome step advances to `connect-arr`, and "Skip wizard" returns to
 * the app and disables the gate for good. Only meaningful against a server
 * whose `setup_state` hasn't been completed/dismissed yet (a clean
 * `dist/dev` data dir) — once dismissed on a shared dev database these tests
 * skip themselves rather than fail, since the gate they exercise no longer
 * fires.
 */
test.describe('5.1 Setup wizard happy path', () => {
  test.describe.configure({ timeout: 120_000 });

  test('fresh deployment is forced into /setup/welcome and "Get started" advances to connect-arr', async ({ page }) => {
    await signInAndLandWhereverTheGateSends(page);

    if (!page.url().includes('/setup')) {
      test.skip('Wizard already completed/dismissed on this server; forward gate no longer applies.');
    }

    await expect(page).toHaveURL(/\/setup\/welcome$/);
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();

    await page.getByRole('button', { name: 'Get started' }).click();
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/setup\/connect-arr$/);
    await expect(page.getByRole('heading', { name: 'Connect' })).toBeVisible();
  });

  test('Skip wizard returns to the app and the forward gate no longer fires', async ({ page }) => {
    await signInAndLandWhereverTheGateSends(page);

    if (!page.url().includes('/setup')) {
      test.skip('Wizard already completed/dismissed on this server; nothing to skip.');
    }

    await page.getByRole('button', { name: 'Skip wizard' }).click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL('/');

    // Re-navigate to confirm the forward gate is gone for good, not just for
    // this one response.
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/\/setup/);
  });
});
