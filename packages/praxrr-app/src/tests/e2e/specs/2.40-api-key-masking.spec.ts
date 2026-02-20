import { expect, test, type Locator, type Page } from '@playwright/test';

const TMDB_REGRESSION_KEY = 'tmdb-regression-key-3-2';
const E2E_USERNAME = process.env.E2E_USERNAME;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

function getTmdbCard(page: Page): Locator {
  return page.locator('div.rounded-lg').filter({ has: page.getByRole('heading', { name: 'TMDB Configuration' }) });
}

function getSecurityApiCard(page: Page): Locator {
  return page.locator('div.rounded-lg').filter({ has: page.getByRole('heading', { name: 'API Key' }) });
}

function getMaskedDisplay(card: Locator): Locator {
  return card.locator('div.rounded-xl').first();
}

function getStatusText(card: Locator): Locator {
  return card.locator('p[role="status"]').first();
}

function getToast(page: Page, message: string | RegExp): Locator {
  return page.locator('div[role="button"]').filter({ hasText: message }).last();
}

function parseRequestBody(postData: string | null): URLSearchParams {
  return new URLSearchParams(postData ?? '');
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
    test.fail('Authentication flow did not complete for settings UI tests.');
  }
}

async function setupClipboardMock(page: Page, mode: 'success' | 'failure'): Promise<void> {
  if (mode === 'success') {
    await page.addInitScript(`
			(() => {
				const writes = [];
				window.__praxrrClipboardWrites = writes;
				Object.defineProperty(navigator, 'clipboard', {
					configurable: true,
					value: {
						writeText(value) {
							writes.push(value);
							return Promise.resolve();
						}
					}
				});
			})();
		`);
    return;
  }

  await page.addInitScript(`
		(() => {
			window.__praxrrClipboardWrites = [];
			Object.defineProperty(navigator, 'clipboard', {
				configurable: true,
				value: {
					writeText() {
						return Promise.reject(new Error('Clipboard blocked'));
					}
				}
			});
		})();
	`);
}

async function getClipboardWrites(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const state = window as { __praxrrClipboardWrites?: string[] };
    return state.__praxrrClipboardWrites ?? [];
  });
}

async function setTmdbApiKey(page: Page, key: string): Promise<void> {
  const card = getTmdbCard(page);
  const updateInput = card.locator('#tmdb_api_key');
  const saveButton = card.getByRole('button', { name: 'Save Settings' });
  const request = page.waitForRequest((req) => {
    return req.url().includes('/settings/general') && req.url().includes('updateTMDB') && req.method() === 'POST';
  });

  await updateInput.fill(key);
  await saveButton.click();
  const requestToSubmit = await request;
  const posted = parseRequestBody(requestToSubmit.postData());

  expect(posted.get('api_key')).toBe(key);
  await page.waitForLoadState('networkidle');
}

test.describe('3.2 API key masking UI regression coverage', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    await ensureAuthenticated(page);
  });

  test('Reveal action shows full key only after explicit user action', async ({ page }) => {
    await page.goto('/settings/general');
    await page.waitForLoadState('networkidle');
    await setTmdbApiKey(page, TMDB_REGRESSION_KEY);

    const card = getTmdbCard(page);
    const valueDisplay = getMaskedDisplay(card);
    const revealButton = card.getByRole('button', { name: 'Show API Read Access Token' });
    const hideButton = card.getByRole('button', { name: 'Hide API Read Access Token' });

    const initialPayload = await page.content();
    expect(initialPayload).not.toContain(TMDB_REGRESSION_KEY);
    await expect(valueDisplay).not.toContainText(TMDB_REGRESSION_KEY);

    const revealRequest = page.waitForResponse((response) => {
      return (
        response.url().includes('/settings/general') &&
        response.url().includes('revealTMDB') &&
        response.request().method() === 'POST'
      );
    });
    await revealButton.click();
    await revealRequest;
    await expect(valueDisplay).toContainText(TMDB_REGRESSION_KEY);

    await hideButton.click();
    await expect(valueDisplay).not.toContainText(TMDB_REGRESSION_KEY);

    const finalPayload = await page.content();
    expect(finalPayload).not.toContain(TMDB_REGRESSION_KEY);
  });

  test('Regenerated auth key takes precedence over masked load data until remasked', async ({ page }) => {
    await page.goto('/settings/security');
    await page.waitForLoadState('networkidle');

    const card = getSecurityApiCard(page);
    const generateButton = card.getByRole('button', { name: 'Generate Key' });
    const regenerateButton = card.getByRole('button', { name: 'Regenerate Key' });
    const hideButton = card.getByRole('button', { name: 'Hide Auth API key' });
    const showButton = card.getByRole('button', { name: 'Show Auth API key' });

    if (await generateButton.count()) {
      await generateButton.click();
    }

    await expect(regenerateButton).toBeVisible();
    await expect(showButton.or(hideButton)).toBeVisible();

    if (await hideButton.count()) {
      await hideButton.click();
    }

    const keyDisplay = getMaskedDisplay(card);
    const maskedData = await keyDisplay.textContent();
    expect(maskedData).toBeTruthy();
    if (maskedData) {
      expect(maskedData).not.toContain(TMDB_REGRESSION_KEY);
    }

    const regenerateRequest = page.waitForResponse((response) => {
      return (
        response.url().includes('/settings/security') &&
        response.url().includes('regenerateApiKey') &&
        response.request().method() === 'POST'
      );
    });
    await regenerateButton.click();
    const regenerateResponse = await regenerateRequest;
    const regeneratePayload = (await regenerateResponse.json()) as { apiKey?: string };
    const regeneratedKey = regeneratePayload.apiKey;
    expect(regeneratedKey).toBeTruthy();

    await expect(keyDisplay).toContainText(regeneratedKey!);
    await expect(hideButton).toBeVisible();

    await hideButton.click();
    await expect(showButton).toBeVisible();
    await expect(keyDisplay).not.toContainText(regeneratedKey!);
  });

  test('Copy success and failure paths never expose plaintext in status/toast output', async ({ page }) => {
    await setupClipboardMock(page, 'success');
    await page.goto('/settings/general');
    await page.waitForLoadState('networkidle');
    await setTmdbApiKey(page, TMDB_REGRESSION_KEY);

    const successCard = getTmdbCard(page);
    const valueDisplay = getMaskedDisplay(successCard);
    const copyButton = successCard.getByRole('button', { name: 'Copy API Read Access Token' });
    const status = getStatusText(successCard);
    const hideButton = successCard.getByRole('button', { name: 'Hide API Read Access Token' });

    await copyButton.click();
    await expect(getToast(page, 'API key copied to clipboard')).toBeVisible();
    await expect(status).toContainText('API key copied');
    await expect(status).not.toContainText(TMDB_REGRESSION_KEY);
    expect((await getToast(page, 'API key copied to clipboard').textContent()) ?? '').not.toContain(
      TMDB_REGRESSION_KEY
    );
    expect((await getClipboardWrites(page)).join('\n')).toContain(TMDB_REGRESSION_KEY);

    await hideButton.click();
    await expect(valueDisplay).not.toContainText(TMDB_REGRESSION_KEY);

    await setupClipboardMock(page, 'failure');
    await page.reload();
    await page.waitForLoadState('networkidle');

    const failureCard = getTmdbCard(page);
    const failureCopy = failureCard.getByRole('button', { name: 'Copy API Read Access Token' });
    const failureStatus = getStatusText(failureCard);
    const failureHideButton = failureCard.getByRole('button', { name: 'Hide API Read Access Token' });

    await failureCopy.click();
    await expect(getToast(page, /Copy failed|Could not copy API key/)).toBeVisible();
    await expect(failureStatus).toContainText(/Copy failed|Could not copy/i);
    await expect(failureStatus).not.toContainText(TMDB_REGRESSION_KEY);
    expect((await getToast(page, /Copy failed|Could not copy API key/).textContent()) ?? '').not.toContain(
      TMDB_REGRESSION_KEY
    );
    expect(await getClipboardWrites(page).then((writes) => writes.join('|'))).toBe('');
    if (await failureHideButton.count()) {
      await failureHideButton.click();
      await expect(failureCard.getByRole('button', { name: 'Show API Read Access Token' })).toBeVisible();
    }
    await expect(getMaskedDisplay(failureCard)).not.toContainText(TMDB_REGRESSION_KEY);
  });

  test('Auto-remask and manual-remask restore masked state', async ({ page }) => {
    await page.goto('/settings/general');
    await page.waitForLoadState('networkidle');
    await setTmdbApiKey(page, TMDB_REGRESSION_KEY);

    const card = getTmdbCard(page);
    const valueDisplay = getMaskedDisplay(card);
    const showButton = card.getByRole('button', { name: 'Show API Read Access Token' });
    const hideButton = card.getByRole('button', { name: 'Hide API Read Access Token' });

    await showButton.click();
    await expect(valueDisplay).toContainText(TMDB_REGRESSION_KEY);
    await hideButton.click();
    await expect(valueDisplay).not.toContainText(TMDB_REGRESSION_KEY);

    await showButton.click();
    await expect(valueDisplay).toContainText(TMDB_REGRESSION_KEY);

    const clock = page.clock();
    clock.install();
    try {
      await clock.runFor(31_000);
    } finally {
      clock.uninstall();
    }

    await expect(valueDisplay).not.toContainText(TMDB_REGRESSION_KEY);
  });

  test('Update submission ignores masked placeholder text in credential value', async ({ page }) => {
    await page.goto('/settings/general');
    await page.waitForLoadState('networkidle');
    await setTmdbApiKey(page, TMDB_REGRESSION_KEY);

    const card = getTmdbCard(page);
    const maskedValue = (await getMaskedDisplay(card).textContent()) ?? '';
    const updateInput = card.locator('#tmdb_api_key');
    const saveButton = card.getByRole('button', { name: 'Save Settings' });

    await updateInput.fill('');
    const submitRequest = page.waitForRequest((request) => {
      return (
        request.url().includes('/settings/general') &&
        request.url().includes('updateTMDB') &&
        request.method() === 'POST'
      );
    });
    await saveButton.click();

    const request = await submitRequest;
    const body = parseRequestBody(request.postData());
    const submittedValue = body.get('api_key');

    expect(submittedValue).toBe('');
    expect(submittedValue).not.toBe(maskedValue);
  });
});
