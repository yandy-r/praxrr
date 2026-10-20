import { expect, type Page, test } from '@playwright/test';

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
 * Wizard state observed through read-only HTTP (no DB file access):
 * - `running`: `GET /api/v1/setup/state` answers 200 (wizard open at `step`).
 * - `skipped`: the setup API is closed (403) and the "Finish setup" checklist
 *   renders — skipped, not completed, checklist not dismissed.
 * - `closed`: the setup API is closed and no checklist renders — completed,
 *   checklist dismissed, or every prerequisite met. The HTTP surface cannot
 *   tell these apart; restoring to "completed" keeps the only property later
 *   specs depend on (no redirect into `/setup`).
 */
type ObservedSetupState =
  { kind: 'running'; step: string; hasArrInstance: boolean } | { kind: 'skipped' } | { kind: 'closed' };

/** Subset of `GET /api/v1/setup/state` read by this spec. */
interface SetupStateBody {
  wizard: { currentStep: string };
  prerequisites: { hasArrInstance: boolean };
}

async function hasArrInstance(page: Page): Promise<boolean> {
  await page.goto('/arr');
  await page.waitForLoadState('networkidle');
  return (await page.getByRole('heading', { name: 'No Arr Instances' }).count()) === 0;
}

async function observeSetupState(page: Page): Promise<ObservedSetupState> {
  const response = await page.request.get('/api/v1/setup/state');
  if (response.status() === 200) {
    const body: SetupStateBody = await response.json();
    return { kind: 'running', step: body.wizard.currentStep, hasArrInstance: body.prerequisites.hasArrInstance };
  }
  expect(response.status(), 'GET /api/v1/setup/state must be 200 (running) or 403 (closed)').toBe(403);

  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const checklistVisible = (await page.getByRole('complementary', { name: /Finish setup/ }).count()) > 0;
  return checklistVisible ? { kind: 'skipped' } : { kind: 'closed' };
}

/** Restore the observed state through the public setup API. */
async function restoreSetupState(page: Page, original: ObservedSetupState): Promise<void> {
  const post = async (path: string) => {
    const response = await page.request.post(path);
    expect(response.ok(), `${path} failed during setup_state restore`).toBe(true);
  };

  await post('/api/v1/setup/resume');
  if (original.kind === 'running') {
    const response = await page.request.patch('/api/v1/setup/state', { data: { currentStep: original.step } });
    expect(response.ok(), 'PATCH /api/v1/setup/state failed during setup_state restore').toBe(true);
  } else if (original.kind === 'skipped') {
    await post('/api/v1/setup/skip');
  } else {
    await post('/api/v1/setup/complete');
  }
}

/**
 * 5.2 Resumable "Skip setup".
 *
 * Skip → "Finish setup (k/3)" checklist visible → "Resume guided setup" lands
 * on the first incomplete wizard step → finishing the wizard hides the
 * checklist for good.
 *
 * This test never assumes a fresh data dir and never reads the app DB file: it
 * checks preconditions over read-only HTTP (no Arr instance connected, so
 * Resume lands on `/setup/connect-arr`, the create-mode InstanceForm), skips
 * before mutating anything when they do not hold, and restores the observed
 * wizard state in `finally` so later specs are not redirected into `/setup`.
 */
test.describe('5.2 Setup wizard resume', () => {
  test.describe.configure({ timeout: 120_000 });

  test('skip → checklist → resume → complete hides the checklist', async ({ page }) => {
    await signIn(page);

    const original = await observeSetupState(page);
    // While the wizard runs, the forward gate redirects `/arr` into `/setup`, so
    // only probe the instance list once the setup API reports it closed.
    const instanceConnected = original.kind === 'running' ? original.hasArrInstance : await hasArrInstance(page);
    test.skip(
      instanceConnected,
      'An Arr instance is already connected on this server; Resume would not land on connect-arr.'
    );

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
      await expect(page.getByRole('heading', { name: 'Connect', exact: true })).toBeVisible();
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
