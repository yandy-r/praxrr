import { expect, type Page, test } from '@playwright/test';

const E2E_USERNAME = process.env.E2E_USERNAME;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

type PreviewSection = 'qualityProfiles' | 'delayProfiles' | 'mediaManagement' | 'metadataProfiles';
type InvalidationCode = 'pcd_drift' | 'arr_drift' | 'pcd_and_arr_drift' | 'scope_drift' | 'unverifiable_review';

const INVALIDATIONS: Array<{ code: InvalidationCode; heading: string; evidence: Array<'pcd' | 'arr'> }> = [
  { code: 'pcd_drift', heading: 'Review invalidated: PCD changed', evidence: ['pcd'] },
  { code: 'arr_drift', heading: 'Review invalidated: live Radarr data changed', evidence: ['arr'] },
  {
    code: 'pcd_and_arr_drift',
    heading: 'Review invalidated: PCD and live Radarr data changed',
    evidence: ['pcd', 'arr'],
  },
  { code: 'scope_drift', heading: 'Review invalidated: target or scope changed', evidence: [] },
  { code: 'unverifiable_review', heading: 'Could not verify the reviewed preview', evidence: [] },
];

async function ensureAuthenticated(page: Page): Promise<void> {
  await page.goto('/arr');
  await page.waitForLoadState('networkidle');

  if (page.url().includes('/auth/setup')) {
    if (!E2E_USERNAME || !E2E_PASSWORD) {
      test.skip(true, 'Set E2E_USERNAME and E2E_PASSWORD to run auth-gated UI e2e tests.');
      return;
    }
    await page.getByRole('textbox', { name: 'Username' }).fill(E2E_USERNAME);
    await page.getByLabel('Password').fill(E2E_PASSWORD);
    await page.getByLabel('Confirm Password').fill(E2E_PASSWORD);
    await page.getByRole('button', { name: 'Create Account' }).click();
    await page.goto('/arr', { waitUntil: 'networkidle' });
  }

  if (page.url().includes('/auth/login')) {
    if (!E2E_USERNAME || !E2E_PASSWORD) {
      test.skip(true, 'Set E2E_USERNAME and E2E_PASSWORD to run auth-gated UI e2e tests.');
      return;
    }
    await page.getByRole('textbox', { name: 'Username' }).fill(E2E_USERNAME);
    await page.getByLabel('Password').fill(E2E_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.goto('/arr', { waitUntil: 'networkidle' });
  }
}

function buildPreview(id: string, instanceId: number, section: PreviewSection, entityName: string) {
  const entity = {
    entityType: 'qualityProfile',
    name: entityName,
    action: 'update',
    remoteId: 42,
    fields: [{ field: 'name', type: 'changed', current: 'Old value', desired: 'Reviewed value' }],
  };

  return {
    id,
    instanceId,
    instanceName: 'Reviewed Target',
    arrType: 'radarr',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    status: 'ready',
    failure: null,
    sections: [section],
    sectionOutcomes: [{ section, skipped: false, failure: null }],
    qualityProfiles:
      section === 'qualityProfiles'
        ? { section: 'qualityProfiles', customFormats: [], qualityProfiles: [entity] }
        : null,
    delayProfiles: section === 'delayProfiles' ? { section: 'delayProfiles', profile: entity } : null,
    mediaManagement:
      section === 'mediaManagement'
        ? { section: 'mediaManagement', naming: entity, qualityDefinitions: [], mediaSettings: null }
        : null,
    metadataProfiles: section === 'metadataProfiles' ? { section: 'metadataProfiles', profile: entity } : null,
    summary: { totalCreates: 0, totalUpdates: 1, totalDeletes: 0, totalUnchanged: 0 },
  };
}

test('review invalidation remains safe, focused, single-submit, and regenerates the exact request', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await ensureAuthenticated(page);

  const instanceHref = await page
    .locator('tr')
    .filter({ hasText: 'Radarr' })
    .locator('a[href^="/arr/"]')
    .first()
    .getAttribute('href');
  if (!instanceHref) {
    test.skip(true, 'No Arr instance is available for the sync-preview UI fixture.');
    return;
  }

  const instanceId = Number(instanceHref.split('/').pop());
  const snapshots = new Map<string, ReturnType<typeof buildPreview>>();
  const createBodies: string[] = [];
  const applyBodies: unknown[] = [];
  let createCount = 0;
  let applyCount = 0;

  await page.route('**/api/v1/sync/preview/*/apply', async (route) => {
    const invalidation = INVALIDATIONS[applyCount++];
    applyBodies.push(route.request().postDataJSON());
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        error: '<img src=x onerror="window.__unsafe = true">',
        code: invalidation.code,
        changedEvidence: invalidation.evidence,
        changedSections: [(route.request().postDataJSON() as { sections: PreviewSection[] }).sections[0]],
        regenerateRequired: true,
        staleWarning: null,
      }),
    });
  });

  await page.route('**/api/v1/sync/preview/*', async (route) => {
    const id = route.request().url().split('/').pop()!;
    const snapshot = snapshots.get(id);
    await route.fulfill({
      status: snapshot ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(snapshot ?? { error: 'Preview not found' }),
    });
  });

  await page.route('**/api/v1/sync/preview', async (route) => {
    const rawBody = route.request().postData() ?? '';
    const body = route.request().postDataJSON() as {
      instanceId: number;
      sections: PreviewSection[];
      sectionConfigs?: Record<string, unknown>;
    };
    createBodies.push(rawBody);
    const id = `reviewed-preview-${++createCount}`;
    const snapshot = buildPreview(id, body.instanceId, body.sections[0], `Retained reviewed diff ${createCount}`);
    snapshots.set(id, snapshot);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshot) });
  });

  await page.goto(`${instanceHref}/sync`, { waitUntil: 'networkidle' });
  const previewButton = page.locator('button').filter({ hasText: 'Preview Sync' }).first();
  await expect(previewButton).toBeAttached();
  await previewButton.evaluate((button) => button.removeAttribute('disabled'));
  await previewButton.click();

  await expect(page.getByRole('heading', { name: 'Planned changes' })).toBeVisible();
  expect(createBodies).toHaveLength(1);
  const originalRequest = JSON.parse(createBodies[0]) as {
    instanceId: number;
    sections: PreviewSection[];
    sectionConfigs: Record<string, unknown>;
  };
  expect(originalRequest.instanceId).toBe(instanceId);
  expect(originalRequest.sections).toHaveLength(1);
  expect(originalRequest.sectionConfigs).toEqual({
    [originalRequest.sections[0]]: expect.anything(),
  });

  await page.setViewportSize({ width: 360, height: 740 });
  const previewDialog = page.getByRole('dialog').first();
  const box = await previewDialog.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(360);

  for (const [index, invalidation] of INVALIDATIONS.entries()) {
    await page.getByRole('button', { name: 'Apply Preview' }).click();
    const confirmationDialog = page.getByRole('dialog').last();
    await expect(confirmationDialog.getByText('Target:', { exact: true })).toBeVisible();
    await expect(confirmationDialog.getByText('Reviewed sections:', { exact: true })).toBeVisible();

    const confirm = confirmationDialog.getByRole('button', { name: 'Apply Changes' });
    await confirm.evaluate((button) => {
      button.click();
      button.click();
    });
    await expect(page.getByRole('status').filter({ hasText: 'Validating reviewed preview…' })).toBeVisible();

    const alert = page.locator('[role="alert"]').filter({ hasText: invalidation.heading });
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
    await expect(alert).toContainText(invalidation.heading);
    await expect(alert).toContainText('Nothing was applied.');
    await expect(page.getByText(`Retained reviewed diff ${index + 1}`, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apply Preview' })).toBeDisabled();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    await expect(page.getByText(/window\.__unsafe/)).toHaveCount(0);
    expect(applyBodies).toHaveLength(index + 1);
    expect(applyBodies[index]).toEqual({ sections: originalRequest.sections });

    const regenerate = page.getByRole('button', { name: 'Generate a new preview', exact: true });
    await regenerate.focus();
    await expect(regenerate).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.getByText(`Retained reviewed diff ${index + 2}`, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sync Preview' }).last()).toBeFocused();
    expect(createBodies[index + 1]).toBe(createBodies[0]);
  }

  expect(applyCount).toBe(INVALIDATIONS.length);
});
