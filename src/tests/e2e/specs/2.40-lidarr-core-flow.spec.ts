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
 * Mixed-arr assertion: also add a Radarr instance and verify both app types
 * render correctly in the Arr list.
 */
import { expect, test } from '@playwright/test';

const LIDARR_UNSUPPORTED_WORKFLOW_MESSAGE = 'Lidarr does not support Rename and Upgrades in Praxrr yet.';
const LIDARR_SUPPORTED_WORKFLOW_MESSAGE = 'You can still use Library and Releases.';

const CONNECTION_SUCCESS_MESSAGE = 'Connection successful!';
const DELAY_PROFILES_SAVE_SUCCESS = 'Delay profile sync config saved';

const LIDARR_RENAME_UNSUPPORTED_ERROR = 'Rename is not supported for Lidarr instances';
const LIDARR_UPGRADES_UNSUPPORTED_ERROR = 'Upgrades are not supported for Lidarr instances';

const LIDARR_LIBRARY_TITLE = 'E2E Lidarr Album';
const LIDARR_LIBRARY_ARTIST = 'E2E Lidarr Artist';
const LIDARR_LIBRARY_FOREIGN_ARTIST_ID = 'e2e-mbid-artist-1';
const LIDARR_LIBRARY_PROFILE = 'E2E Lidarr Profile';
const LIDARR_LIBRARY_ALT_PROFILE = 'E2E Lidarr Secondary Profile';
const LIDARR_URL = 'http://lidarr.local';
const LIDARR_EXTERNAL_URL = 'https://lidarr-external.example';
const LIDARR_EXTERNAL_URL_UPDATED = 'https://lidarr-external-updated.example';
const LIDARR_API_KEY = 'lidarr-e2e-api-key';

interface LibraryRequestInfo {
  page: number;
  pageSize: number;
  query: string | null;
  totalRecords: number;
  totalPages: number;
  itemTitles: string[];
  hasNext: boolean;
}

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

async function clearWindowOpenCaptures(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const windowState = globalThis as {
      __praxrrOpenUrls?: string[];
    };
    windowState.__praxrrOpenUrls = [];
  });
}

async function setupWindowOpenCapture(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const windowState = globalThis as {
      __praxrrOpenUrls?: string[];
    };

    windowState.__praxrrOpenUrls = [];
    window.open = ((url: string | URL | null) => {
      if (url === null) {
        return null;
      }

      const resolvedUrl = typeof url === 'string' ? url : url.toString();
      windowState.__praxrrOpenUrls = windowState.__praxrrOpenUrls ?? [];
      windowState.__praxrrOpenUrls.push(resolvedUrl);
      return null;
    }) as typeof window.open;
  });
}

async function getLatestWindowOpenUrl(page: import('@playwright/test').Page): Promise<string | null> {
  return page.evaluate(() => {
    const windowState = globalThis as {
      __praxrrOpenUrls?: string[];
    };

    if (!windowState.__praxrrOpenUrls || windowState.__praxrrOpenUrls.length === 0) {
      return null;
    }

    return windowState.__praxrrOpenUrls.at(-1) ?? null;
  });
}

function expectLibraryOpenRowLink(pageUrl: string, expectedBrowserUrl: string): void {
  const expectedUrl = `${expectedBrowserUrl}/artist/${LIDARR_LIBRARY_FOREIGN_ARTIST_ID}`;
  if (pageUrl !== expectedUrl) {
    throw new Error(`Expected Lidarr row open link to be ${expectedUrl}, got ${pageUrl}`);
  }
}

async function expectLibraryActionOpenUses(
  page: import('@playwright/test').Page,
  expectedOpenBase: string
): Promise<void> {
  await clearWindowOpenCaptures(page);

  const openButton = page.locator('button[title="Open in Lidarr"]').first();
  await openButton.click();

  await expect.poll(() => getLatestWindowOpenUrl(page)).toBe(expectedOpenBase);
}

async function expectLibraryOpenRowUses(
  page: import('@playwright/test').Page,
  expectedOpenBase: string
): Promise<void> {
  const rowOpenLink = page.locator('a[title="Open in Lidarr"]').first();
  await expect(rowOpenLink).toBeVisible();

  const href = await rowOpenLink.getAttribute('href');
  if (!href) {
    throw new Error(`Expected row open link href for Lidarr row, got ${href}`);
  }

  expectLibraryOpenRowLink(href, expectedOpenBase);
}

async function setLidarrExternalUrl(
  page: import('@playwright/test').Page,
  instanceId: number,
  externalUrl: string
): Promise<void> {
  await page.goto(`/arr/${instanceId}/settings`);
  await page.waitForLoadState('networkidle');

  const externalUrlInput = page.getByLabel('External URL (optional)');
  await externalUrlInput.fill(externalUrl);
  await page.getByLabel('API Key').fill(LIDARR_API_KEY);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForLoadState('networkidle');
  await expect(externalUrlInput).toHaveValue(externalUrl);

  await expectToast(page, CONNECTION_SUCCESS_MESSAGE);
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

  const unsupportedWorkflowStatus = page.getByRole('status').filter({
    hasText: LIDARR_UNSUPPORTED_WORKFLOW_MESSAGE,
  });

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

function parseLibraryNumericParam(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return fallback;
  }

  return parsed;
}

function buildLidarrLibraryItems(query: string | null) {
  const allItems = Array.from({ length: 120 }, (_, index) => {
    const albumIndex = index + 1;
    const isPrimaryProfile = albumIndex % 2 === 0;
    const foreignArtistId = albumIndex === 1 ? LIDARR_LIBRARY_FOREIGN_ARTIST_ID : `e2e-mbid-artist-${albumIndex}`;

    return {
      id: 9000 + albumIndex,
      artistId: 501 + (albumIndex % 3),
      foreignArtistId,
      artistName: `${LIDARR_LIBRARY_ARTIST} ${albumIndex % 4}`,
      title: `${LIDARR_LIBRARY_TITLE} ${albumIndex}`,
      year: 2020 + (albumIndex % 5),
      albumType: 'Album',
      releaseDate: `2025-${String((albumIndex % 12) + 1).padStart(2, '0')}-01T00:00:00.000Z`,
      status: 'released',
      monitored: true,
      trackFileCount: Math.max(0, (albumIndex % 10) - 1),
      trackCount: 10,
      totalTrackCount: 10,
      sizeOnDisk: 1000 * albumIndex,
      percentOfTracks: albumIndex % 10 === 0 ? 100 : 50 + (albumIndex % 5),
      dateAdded: `2025-01-${String((albumIndex % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
      qualityProfileId: isPrimaryProfile ? 77 : 78,
      qualityProfileName: isPrimaryProfile ? LIDARR_LIBRARY_PROFILE : LIDARR_LIBRARY_ALT_PROFILE,
      isPraxrrProfile: isPrimaryProfile,
    };
  });

  const normalizedQuery = query?.trim().toLowerCase();
  if (!normalizedQuery) {
    return allItems;
  }

  return allItems.filter(
    (item) =>
      item.title.toLowerCase().includes(normalizedQuery) ||
      item.artistName.toLowerCase().includes(normalizedQuery) ||
      item.qualityProfileName.toLowerCase().includes(normalizedQuery)
  );
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
    const libraryRequests: LibraryRequestInfo[] = [];

    let trackedLidarrInstanceId = 0;

    const getLatestLibraryRequest = (): LibraryRequestInfo => {
      const latest = libraryRequests[libraryRequests.length - 1];
      if (!latest) {
        throw new Error('Expected at least one library request, but none were captured.');
      }

      return latest;
    };

    const expectLibraryRequestCount = async (expected: number) => {
      await expect.poll(() => libraryRequests.length).toBe(expected);
    };

    await setupWindowOpenCapture(page);

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

    await page.route('**/api/v1/arr/library?*', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }

      const url = new URL(route.request().url());
      if (url.searchParams.get('instanceId') !== String(trackedLidarrInstanceId)) {
        await route.continue();
        return;
      }

      const pageParam = parseLibraryNumericParam(url.searchParams.get('page'), 1);
      const pageSizeParam = parseLibraryNumericParam(url.searchParams.get('pageSize'), 100);
      const queryParam = url.searchParams.get('query');
      const filteredItems = buildLidarrLibraryItems(queryParam);
      const totalRecords = filteredItems.length;
      const start = (pageParam - 1) * pageSizeParam;
      const end = start + pageSizeParam;
      const hasNext = pageParam * pageSizeParam < totalRecords;
      const totalPages = totalRecords > 0 ? Math.ceil(totalRecords / pageSizeParam) : 0;
      const pagedItems = filteredItems.slice(start, end);

      libraryRequests.push({
        page: pageParam,
        pageSize: pageSizeParam,
        query: queryParam,
        totalRecords,
        totalPages,
        itemTitles: pagedItems.map((item) => item.title),
        hasNext,
      });

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'lidarr',
          items: pagedItems,
          profilesByDatabase: [],
          page: pageParam,
          pageSize: pageSizeParam,
          totalRecords,
          totalPages,
          hasNext,
        }),
      });
    });

    const runId = Date.now();
    const lidarrName = `E2E Lidarr ${runId}`;
    const radarrName = `E2E Radarr ${runId}`;

    const lidarrId = await createArrInstance(page, {
      typeLabel: 'Lidarr',
      name: lidarrName,
      url: LIDARR_URL,
      apiKey: LIDARR_API_KEY,
      testConnection: true,
      expectUnsupportedWorkflowStatus: true,
    });
    createdInstanceIds.push(lidarrId);
    trackedLidarrInstanceId = lidarrId;

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

    // Inspect flow: load Lidarr library page with paginated payload and verify pagination controls.
    await page.goto(`/arr/${lidarrId}/library?page=1&pageSize=10`);
    await page.waitForLoadState('networkidle');

    await expectLibraryRequestCount(1);
    const initialRequest = getLatestLibraryRequest();
    expect(initialRequest).toMatchObject({
      page: 1,
      pageSize: 10,
      query: null,
      totalRecords: 120,
      totalPages: 12,
    });

    await expect(page.locator('p[role="status"]')).toHaveText('Showing 1-10 of 120 records');
    await expect(page.getByText(`${LIDARR_LIBRARY_TITLE} 1`)).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Tracks' })).toBeVisible();

    await expectLibraryActionOpenUses(page, LIDARR_URL);
    await expectLibraryOpenRowUses(page, LIDARR_URL);

    const pagination = page.getByRole('navigation', {
      name: 'Library pagination',
    });
    const previousPageButton = pagination.getByRole('button', {
      name: 'Previous page',
    });
    const nextPageButton = pagination.getByRole('button', {
      name: 'Next page',
    });

    await expect(previousPageButton).toBeDisabled();
    await expect(nextPageButton).toBeEnabled();
    await expect(pagination).toContainText('Page 1 of 12');

    await nextPageButton.click();
    await expectLibraryRequestCount(2);
    const secondPageRequest = getLatestLibraryRequest();
    expect(secondPageRequest).toMatchObject({
      page: 2,
      pageSize: 10,
      query: null,
      totalRecords: 120,
      totalPages: 12,
    });

    await expect(previousPageButton).toBeEnabled();
    await expect(nextPageButton).toBeEnabled();
    await expect(pagination).toContainText('Page 2 of 12');
    await expect(page.locator('p[role="status"]')).toContainText('Showing 11-20 of 120 records');
    await expect(page.getByText(`${LIDARR_LIBRARY_TITLE} 11`)).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Tracks' })).toBeVisible();

    const librarySearch = page.getByPlaceholder('Search albums...');
    await librarySearch.fill('1');
    await expect.poll(() => getLatestLibraryRequest().query).toBe('1');
    await expect.poll(() => getLatestLibraryRequest().page).toBe(1);
    await expect(librarySearch).toHaveValue('1');
    await expect(page.locator('p[role="status"]')).toContainText('Showing 1-10 of 31 records');

    await nextPageButton.click();
    await expect.poll(() => getLatestLibraryRequest().page).toBe(2);
    await expect.poll(() => getLatestLibraryRequest().query).toBe('1');
    await expect(pagination).toContainText('Page 2 of 4');
    await expect(page.locator('p[role="status"]')).toContainText('Showing 11-20 of 31 records');

    await librarySearch.fill('zzzz');
    await expect.poll(() => getLatestLibraryRequest().query).toBe('zzzz');
    await expect.poll(() => getLatestLibraryRequest().page).toBe(1);
    await expect(page.locator('p[role="status"]')).toContainText('Showing 0-0 of 0 records');
    await expect(page.getByText('No albums found')).toBeVisible();
    await expect(previousPageButton).toBeDisabled();
    await expect(nextPageButton).toBeDisabled();
    await expect(pagination).toContainText('Page 1 of 1');

    await page.getByPlaceholder('Search albums...').fill('');
    await expect.poll(() => getLatestLibraryRequest().query).toBe(null);
    await page.waitForLoadState('networkidle');

    await expectLibraryActionOpenUses(page, LIDARR_URL);
    await expectLibraryOpenRowUses(page, LIDARR_URL);

    await setLidarrExternalUrl(page, lidarrId, LIDARR_EXTERNAL_URL);
    await page.goto(`/arr/${lidarrId}/library?page=1&pageSize=10`);
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('Search albums...').fill('');
    await expect.poll(() => getLatestLibraryRequest().query).toBe(null);
    await expectLibraryActionOpenUses(page, LIDARR_EXTERNAL_URL);
    await expectLibraryOpenRowUses(page, LIDARR_EXTERNAL_URL);

    await setLidarrExternalUrl(page, lidarrId, LIDARR_EXTERNAL_URL_UPDATED);
    await page.goto(`/arr/${lidarrId}/library?page=1&pageSize=10`);
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('Search albums...').fill('');
    await expect.poll(() => getLatestLibraryRequest().query).toBe(null);
    await expectLibraryActionOpenUses(page, LIDARR_EXTERNAL_URL_UPDATED);
    await expectLibraryOpenRowUses(page, LIDARR_EXTERNAL_URL_UPDATED);

    await setLidarrExternalUrl(page, lidarrId, '');
    await page.goto(`/arr/${lidarrId}/library?page=1&pageSize=10`);
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('Search albums...').fill('');
    await expect.poll(() => getLatestLibraryRequest().query).toBe(null);
    await expectLibraryActionOpenUses(page, LIDARR_URL);
    await expectLibraryOpenRowUses(page, LIDARR_URL);

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
