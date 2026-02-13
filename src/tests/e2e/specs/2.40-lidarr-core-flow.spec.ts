/**
 * 2.40 Lidarr core flow — add/test/configure/inspect with capability gates
 *
 * Scenario:
 * 1) Add Lidarr instance via /arr/new
 * 2) Test connection via UI
 * 3) Configure sync section on instance page
 * 4) Inspect library rendering for Lidarr
 * 5) Verify explicit unsupported messaging for rename/upgrades (v1)
 *
 * Mixed-arr assertion: also add a Radarr instance and verify both instance types
 * render correctly in the Arr list.
 */
import { test, expect } from '@playwright/test';

const LIDARR_UNSUPPORTED_WORKFLOW_MESSAGE = 'Lidarr does not support Rename and Upgrades in Profilarr yet.';
const LIDARR_SUPPORTED_WORKFLOW_MESSAGE = 'You can still use Library and Releases.';

const CONNECTION_SUCCESS_MESSAGE = 'Connection successful!';
const DELAY_PROFILES_SAVE_SUCCESS = 'Delay profile sync config saved';

const LIDARR_RENAME_UNSUPPORTED_ERROR = 'Rename is not supported for Lidarr instances';
const LIDARR_UPGRADES_UNSUPPORTED_ERROR = 'Upgrades are not supported for Lidarr instances';

const LIDARR_LIBRARY_TITLE = 'E2E Lidarr Album';
const LIDARR_LIBRARY_ARTIST = 'E2E Lidarr Artist';
const LIDARR_LIBRARY_PROFILE = 'E2E Lidarr Profile';

function getToastByMessage(page: import('@playwright/test').Page, message: string) {
  return page.locator('div[role="button"]').filter({ hasText: message }).last();
}

async function expectToast(page: import('@playwright/test').Page, message: string): Promise<void> {
  const toast = getToastByMessage(page, message);
  await expect(toast).toBeVisible();
  await toast.click();
}

function parseArrInstanceId(url: string): number {
  const match = url.match(/\/arr\/(\d+)\/settings$/);
  if (!match) {
    throw new Error(`Unexpected Arr settings URL: ${url}`);
  }

  const id = Number.parseInt(match[1], 10);
  if (Number.isNaN(id)) {
    throw new Error(`Failed to parse Arr instance ID from URL: ${url}`);
  }

  return id;
}

async function createArrInstance(
  page: import('@playwright/test').Page,
  options: {
    typeLabel: 'Lidarr' | 'Radarr';
    name: string;
    url: string;
    apiKey: string;
    testConnection: boolean;
    expectUnsupportedWorkflowStatus: boolean;
  }
): Promise<number> {
  await page.goto('/arr/new');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: 'Select type...' }).first().click();
  await page.getByRole('button', { name: options.typeLabel, exact: true }).click();

  const unsupportedWorkflowStatus = page.getByRole('status').filter({ hasText: LIDARR_UNSUPPORTED_WORKFLOW_MESSAGE });

  if (options.expectUnsupportedWorkflowStatus) {
    await expect(unsupportedWorkflowStatus).toBeVisible();
    await expect(unsupportedWorkflowStatus).toContainText(LIDARR_SUPPORTED_WORKFLOW_MESSAGE);
  } else {
    await expect(unsupportedWorkflowStatus).toHaveCount(0);
  }

  await page.getByLabel('Name').fill(options.name);
  await page.getByLabel('URL').fill(options.url);
  await page.getByLabel('API Key').fill(options.apiKey);

  if (options.testConnection) {
    await page.getByRole('button', { name: 'Test Connection' }).click();
    await expectToast(page, CONNECTION_SUCCESS_MESSAGE);
  }

  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(/\/arr\/\d+\/settings$/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle');

  return parseArrInstanceId(page.url());
}

async function deleteArrInstanceById(
  page: import('@playwright/test').Page,
  instanceId: number | undefined
): Promise<void> {
  if (!instanceId) {
    return;
  }

  try {
    await page.goto(`/arr/${instanceId}/settings`);
    await page.waitForLoadState('networkidle');

    const deleteButton = page.getByRole('button', { name: 'Delete' }).first();
    if ((await deleteButton.count()) === 0) {
      return;
    }

    await deleteButton.click();

    const deleteModal = page.getByRole('dialog');
    if ((await deleteModal.count()) === 0) {
      return;
    }

    await deleteModal.getByRole('button', { name: 'Delete' }).click();
    await page.waitForURL('**/arr', { timeout: 15_000 });
  } catch {
    // Best-effort cleanup
  }
}

test.describe('2.40 Lidarr core flow', () => {
  test.describe.configure({ timeout: 120_000 });

  let createdInstanceIds: number[];

  test.beforeEach(() => {
    createdInstanceIds = [];
  });

  test.afterEach(async ({ page }) => {
    for (const instanceId of [...createdInstanceIds].reverse()) {
      await deleteArrInstanceById(page, instanceId);
    }
  });

  test('add/test/configure/inspect flow with explicit Lidarr unsupported messaging', async ({ page }) => {
    const arrTestPayloads: Array<{ type?: string }> = [];

    await page.route('**/arr/test', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }

      const postData = route.request().postData();
      if (postData) {
        try {
          const payload = JSON.parse(postData) as { type?: string };
          arrTestPayloads.push(payload);
        } catch {
          arrTestPayloads.push({});
        }
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    const runId = Date.now();
    const lidarrName = `E2E Lidarr ${runId}`;
    const radarrName = `E2E Radarr ${runId}`;

    const lidarrId = await createArrInstance(page, {
      typeLabel: 'Lidarr',
      name: lidarrName,
      url: 'http://lidarr.local',
      apiKey: 'lidarr-e2e-api-key',
      testConnection: true,
      expectUnsupportedWorkflowStatus: true,
    });
    createdInstanceIds.push(lidarrId);

    expect(arrTestPayloads.some((payload) => payload.type === 'lidarr')).toBe(true);

    const radarrId = await createArrInstance(page, {
      typeLabel: 'Radarr',
      name: radarrName,
      url: 'http://radarr.local',
      apiKey: 'radarr-e2e-api-key',
      testConnection: false,
      expectUnsupportedWorkflowStatus: false,
    });
    createdInstanceIds.push(radarrId);

    expect(arrTestPayloads.some((payload) => payload.type === 'radarr')).toBe(true);

    // Mixed-arr assertion: both app types are visible and typed correctly on the Arr list.
    await page.goto('/arr');
    await page.waitForLoadState('networkidle');

    const searchInput = page.getByPlaceholder('Search instances...');
    await searchInput.fill(lidarrName);
    const lidarrNameMatch = page.getByText(lidarrName, { exact: true });
    await expect(lidarrNameMatch).toHaveCount(1);
    await expect(lidarrNameMatch.first()).toBeVisible();

    await searchInput.fill(radarrName);
    const radarrNameMatch = page.getByText(radarrName, { exact: true });
    await expect(radarrNameMatch).toHaveCount(1);
    await expect(radarrNameMatch.first()).toBeVisible();
    await searchInput.fill('');

    // Configure flow: update and save a Lidarr sync section trigger.
    await page.goto(`/arr/${lidarrId}/sync`);
    await page.waitForLoadState('networkidle');

    const delayProfilesSection = page
      .locator('div.rounded-lg', {
        has: page.getByRole('heading', { name: 'Delay Profiles' }),
      })
      .first();

    await delayProfilesSection.getByRole('switch', { name: 'On Pull' }).click();
    await delayProfilesSection.getByRole('button', { name: 'Save' }).click();
    await expectToast(page, DELAY_PROFILES_SAVE_SUCCESS);

    // Inspect flow: load Lidarr library page with deterministic payload and verify rendering.
    await page.route('**/api/v1/arr/library?*', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }

      const url = new URL(route.request().url());
      if (url.searchParams.get('instanceId') !== String(lidarrId)) {
        await route.continue();
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'lidarr',
          items: [
            {
              id: 9001,
              artistId: 501,
              artistName: LIDARR_LIBRARY_ARTIST,
              title: LIDARR_LIBRARY_TITLE,
              year: 2025,
              albumType: 'Album',
              releaseDate: '2025-01-01T00:00:00.000Z',
              status: 'released',
              monitored: true,
              trackFileCount: 8,
              trackCount: 10,
              totalTrackCount: 10,
              sizeOnDisk: 123456789,
              percentOfTracks: 80,
              dateAdded: '2025-01-05T00:00:00.000Z',
              qualityProfileId: 77,
              qualityProfileName: LIDARR_LIBRARY_PROFILE,
              isProfilarrProfile: true,
            },
          ],
          profilesByDatabase: [],
        }),
      });
    });

    await page.goto(`/arr/${lidarrId}/library`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(LIDARR_LIBRARY_TITLE)).toBeVisible();
    await expect(page.getByText(LIDARR_LIBRARY_ARTIST)).toBeVisible();
    await expect(page.getByText(LIDARR_LIBRARY_PROFILE)).toBeVisible();

    // Explicit unsupported messaging checks (v1 capability-gated actions).
    await page.goto(`/arr/${lidarrId}/rename`);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      const form = document.getElementById('save-form');
      if (form instanceof HTMLFormElement) {
        form.requestSubmit();
      }
    });
    await expectToast(page, LIDARR_RENAME_UNSUPPORTED_ERROR);

    await page.goto(`/arr/${lidarrId}/upgrades`);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      const form = document.getElementById('save-form');
      if (form instanceof HTMLFormElement) {
        form.requestSubmit();
      }
    });
    await expectToast(page, LIDARR_UPGRADES_UNSUPPORTED_ERROR);
  });
});
