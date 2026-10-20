import { expect, type Page, test } from '@playwright/test';
import { countArrInstances, getSetupState, type SetupStateRow } from '../helpers/db';

const E2E_USERNAME = process.env.E2E_USERNAME;
const E2E_PASSWORD = process.env.E2E_PASSWORD;
const AUTH_REQUIRED = 'AUTH is required. Set E2E_USERNAME and E2E_PASSWORD to run auth-gated UI e2e tests.';

/**
 * Log in (or create the first account) the same way spec 5.1 does. Leaves the
 * page wherever the setup gate sends it.
 */
async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  if (page.url().includes('/auth/setup')) {
    test.skip(!E2E_USERNAME || !E2E_PASSWORD, AUTH_REQUIRED);

    await page.getByRole('textbox', { name: 'Username' }).fill(E2E_USERNAME!);
    await page.getByLabel('Password').fill(E2E_PASSWORD!);
    await page.getByLabel('Confirm Password').fill(E2E_PASSWORD!);
    await page.getByRole('button', { name: 'Create Account' }).click();
    await page.waitForLoadState('networkidle');
  }

  if (page.url().includes('/auth/login')) {
    test.skip(!E2E_USERNAME || !E2E_PASSWORD, AUTH_REQUIRED);

    await page.getByRole('textbox', { name: 'Username' }).fill(E2E_USERNAME!);
    await page.getByLabel('Password').fill(E2E_PASSWORD!);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForLoadState('networkidle');
  }
}

/**
 * Put `setup_state` back to the flags recorded before the test, through the
 * public setup API: reopen (clears everything), restore the step while the
 * wizard is still running, then re-apply each terminal flag that was set
 * (skip and completion are independent) plus checklist dismissal.
 * Timestamps are re-stamped, not preserved.
 */
async function restoreSetupState(page: Page, original: SetupStateRow): Promise<void> {
  const post = async (path: string) => {
    const response = await page.request.post(path);
    expect(response.ok(), `${path} failed during setup_state restore`).toBe(true);
  };

  await post('/api/v1/setup/resume');
  if (original.wizard_completed === 0 && original.wizard_dismissed_at === null) {
    const response = await page.request.patch('/api/v1/setup/state', {
      data: { currentStep: original.wizard_current_step },
    });
    expect(response.ok(), 'PATCH /api/v1/setup/state failed during setup_state restore').toBe(true);
  }
  if (original.wizard_dismissed_at !== null) {
    await post('/api/v1/setup/skip');
  }
  if (original.wizard_completed === 1) {
    await post('/api/v1/setup/complete');
  }
  if (original.setup_checklist_dismissed_at !== null) {
    await post('/api/v1/setup/checklist/dismiss');
  }
}

/**
 * 5.2 Resumable "Skip setup".
 *
 * Skip → "Finish setup (k/3)" checklist visible → "Resume guided setup" lands
 * on the first incomplete wizard step → finishing the wizard hides the
 * checklist for good.
 *
 * This test never assumes a fresh data dir: it
 * checks preconditions read-only (no Arr instance connected, so Resume lands on
 * `/setup/connect-arr`, the create-mode InstanceForm), skips before mutating
 * anything when they do not hold, and restores the original `setup_state`
 * flags in `finally` so later specs are not redirected into `/setup`.
 */
test.describe('5.2 Setup wizard resume', () => {
  test.describe.configure({ timeout: 120_000 });

  test('skip → checklist → resume → complete hides the checklist', async ({ page }) => {
    await signIn(page);

    test.skip(
      countArrInstances() > 0,
      'An Arr instance is already connected on this server; Resume would not land on connect-arr.'
    );
    const original = getSetupState();

    try {
      // Normalise: reopen the wizard (clears any prior skip/completion/dismissal).
      const reopened = await page.request.post('/api/v1/setup/resume');
      expect(reopened.ok()).toBe(true);
      const { wizard, progress } = (await reopened.json()) as {
        wizard: { currentStep: string };
        progress: { hasArrInstance: boolean; hasDatabase: boolean; hasProfileSelections: boolean };
      };
      const completed = [progress.hasArrInstance, progress.hasDatabase, progress.hasProfileSelections].filter(
        Boolean
      ).length;
      expect(wizard.currentStep).toBe('connect-arr');

      // `/setup` resumes at connect-arr; it must render, then skip from there.
      const wizardResponse = await page.goto('/setup');
      await page.waitForLoadState('networkidle');
      expect(wizardResponse?.status()).toBe(200);
      await expect(page).toHaveURL(/\/setup\/connect-arr$/);
      await expect(page.getByRole('heading', { name: 'Add Instance' })).toBeVisible();
      await page.getByRole('button', { name: 'Skip wizard' }).click();
      await page.waitForLoadState('networkidle');
      await expect(page).not.toHaveURL(/\/setup/);

      // Checklist is visible with k/3 progress and rows that link onward.
      const checklist = page.getByRole('complementary', { name: /Finish setup/ });
      await expect(checklist).toBeVisible();
      await expect(checklist.getByRole('heading', { name: `Finish setup (${completed}/3)` })).toBeVisible();
      await expect(checklist.getByRole('link', { name: 'Open: Connect an Arr instance' })).toHaveAttribute(
        'href',
        '/arr/new'
      );
      if (!progress.hasDatabase) {
        await expect(checklist.getByRole('link', { name: 'Open: Link a configuration database' })).toHaveAttribute(
          'href',
          '/databases/new'
        );
      }

      // The checklist's connect row target renders the same create-mode form.
      const arrNewResponse = await page.goto('/arr/new');
      await page.waitForLoadState('networkidle');
      expect(arrNewResponse?.status()).toBe(200);
      await expect(page.getByRole('heading', { name: 'Add Instance' })).toBeVisible();
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Resume lands on the first incomplete wizard step, which renders.
      await page
        .getByRole('complementary', { name: /Finish setup/ })
        .getByRole('button', { name: 'Resume guided setup' })
        .click();
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(/\/setup\/connect-arr$/);
      await expect(page.getByRole('heading', { name: 'Connect' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Add Instance' })).toBeVisible();

      // Complete the wizard via the same endpoint the preview step's "Finish" calls,
      // then confirm the checklist is gone outside the wizard.
      const done = await page.request.post('/api/v1/setup/complete');
      expect(done.ok()).toBe(true);
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await expect(page).not.toHaveURL(/\/setup/);
      await expect(page.getByRole('complementary', { name: /Finish setup/ })).toHaveCount(0);
    } finally {
      await restoreSetupState(page, original);
    }
  });
});
