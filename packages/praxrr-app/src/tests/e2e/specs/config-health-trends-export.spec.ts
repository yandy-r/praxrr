import { expect, type Page, type Route, test } from '@playwright/test';
import type { components } from '$api/v1.d.ts';

const E2E_USERNAME = process.env.E2E_USERNAME;
const E2E_PASSWORD = process.env.E2E_PASSWORD;
const INSTANCE_ID = 424_242;
const SECOND_INSTANCE_ID = 424_243;
const CAPTURED_TO = '2026-07-10T12:00:00.000Z';
const SECOND_CAPTURED_TO = '2026-07-10T13:00:00.000Z';
const CAPTURED_ALL_TO = '2026-07-10T12:34:56.789Z';
const MAX_SIZE_POINT_COUNT = 10_000;
const HOSTILE_INSTANCE = `Living Room <svg data-e2e-injected="instance"></svg> ${'very-long-instance-name-'.repeat(5)}`;
const HOSTILE_PROFILE = `Profile <img data-e2e-injected="profile" onerror="window.__e2eInjected=true"> & ${'exact-name-'.repeat(8)}`;
const HOSTILE_CRITERION = `Configuration parity <script>window.__e2eInjected=true</script> ${'long-label-'.repeat(7)}`;
const SECOND_INSTANCE_NAME = 'Kitchen Sonarr';

type DetailResponse = components['schemas']['ConfigHealthDetailResponse'];
type TrendResult = components['schemas']['ConfigHealthTrendsResponse'];
type TrendPoint = TrendResult['points'][number];

type TrendHandler = (route: Route, url: URL) => Promise<void>;

const DETAIL_RESPONSE = {
  instanceId: INSTANCE_ID,
  instanceName: HOSTILE_INSTANCE,
  arrType: 'sonarr',
  engineVersion: '2',
  generatedAt: CAPTURED_TO,
  overall: {
    score: 88,
    band: 'healthy',
    criteria: [
      {
        id: 'configuration-parity',
        label: HOSTILE_CRITERION,
        score: 90,
        weight: 40,
        contribution: 36,
        detail: [],
        suggestions: [],
      },
    ],
    suggestions: [],
  },
  profiles: [
    {
      name: HOSTILE_PROFILE,
      score: 70,
      band: 'attention',
      criteria: [],
      suggestions: [],
    },
  ],
} satisfies DetailResponse;

const COMPREHENSIVE_POINTS = [
  {
    snapshotId: 501,
    generatedAt: '2026-06-11T00:00:00.000Z',
    engineVersion: '1',
    state: 'measured',
    score: 58,
    band: 'needs-review',
    criteria: [
      {
        id: 'configuration-parity',
        label: HOSTILE_CRITERION,
        state: 'measured',
        score: 45,
        weight: 40,
        contribution: 18,
      },
      {
        id: 'upgrade-policy',
        label: 'Upgrade policy',
        state: 'measured',
        score: 80,
        weight: 25,
        contribution: 20,
      },
    ],
  },
  {
    snapshotId: 502,
    generatedAt: '2026-06-12T00:00:00.000Z',
    engineVersion: '1',
    state: 'measured',
    score: 61,
    band: 'attention',
    criteria: [
      {
        id: 'configuration-parity',
        label: HOSTILE_CRITERION,
        state: 'measured',
        score: 55,
        weight: 40,
        contribution: 22,
      },
      {
        id: 'upgrade-policy',
        label: 'Upgrade policy',
        state: 'not-evaluated',
        score: null,
        weight: 25,
        contribution: null,
      },
    ],
  },
  {
    snapshotId: 503,
    generatedAt: '2026-06-20T00:00:00.000Z',
    engineVersion: '1',
    state: 'unknown',
    score: null,
    band: 'unknown',
    criteria: [],
  },
  {
    snapshotId: 504,
    generatedAt: '2026-07-01T00:00:00.000Z',
    engineVersion: '2',
    state: 'measured',
    score: 88,
    band: 'healthy',
    criteria: [
      {
        id: 'configuration-parity',
        label: HOSTILE_CRITERION,
        state: 'measured',
        score: 90,
        weight: 40,
        contribution: 36,
      },
      {
        id: 'upgrade-policy',
        label: 'Upgrade policy',
        state: 'measured',
        score: 92,
        weight: 25,
        contribution: 23,
      },
    ],
  },
  {
    snapshotId: 505,
    generatedAt: '2026-07-09T00:00:00.000Z',
    engineVersion: '2',
    state: 'not-recorded',
    score: null,
    band: null,
    criteria: [],
  },
] satisfies TrendPoint[];

function resultFor(
  points: TrendPoint[],
  options: { from?: string | null; to?: string; profile?: string | null; availableProfiles?: string[] } = {}
): TrendResult {
  const measured = points.filter((point) => point.state === 'measured').length;
  const unknown = points.filter((point) => point.state === 'unknown').length;
  const missing = points.length - measured - unknown;
  const engineBoundaries = points.flatMap((point, pointIndex) => {
    if (pointIndex > 0 && points[pointIndex - 1].engineVersion === point.engineVersion) return [];
    return [{ engineVersion: point.engineVersion, startsAt: point.generatedAt, pointIndex }];
  });

  return {
    instance: { id: INSTANCE_ID, name: HOSTILE_INSTANCE, arrType: 'sonarr' },
    currentEngineVersion: '2',
    normalizedFilter: {
      from: options.from === undefined ? '2026-06-10T12:00:00.000Z' : options.from,
      to: options.to ?? CAPTURED_TO,
      profile: options.profile ?? null,
    },
    retention: {
      days: 90,
      maxEntries: 5000,
      ageCutoffAt: '2026-04-11T12:00:00.000Z',
      oldestAvailableAt: points[0]?.generatedAt ?? null,
      newestAvailableAt: points.at(-1)?.generatedAt ?? null,
    },
    availableProfiles: options.availableProfiles ?? [HOSTILE_PROFILE],
    counts: { points: points.length, measured, unknown, missing },
    engineBoundaries,
    points,
  };
}

const COMPREHENSIVE_RESULT = resultFor(COMPREHENSIVE_POINTS);
const MAX_SIZE_POINTS = Array.from({ length: MAX_SIZE_POINT_COUNT }, (_, index) => ({
  snapshotId: 700_000 + index,
  generatedAt: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
  engineVersion: '2',
  state: 'measured',
  score: index % 101,
  band: 'healthy',
  criteria: [
    {
      id: 'bounded-rendering',
      label: `Bounded rendering criterion ${index + 1}`,
      state: 'measured',
      score: index % 101,
      weight: 100,
      contribution: index % 101,
    },
  ],
})) satisfies TrendPoint[];
const MAX_SIZE_BASE_RESULT = resultFor(MAX_SIZE_POINTS);
const MAX_SIZE_RESULT = {
  ...MAX_SIZE_BASE_RESULT,
  retention: { ...MAX_SIZE_BASE_RESULT.retention, maxEntries: MAX_SIZE_POINT_COUNT },
} satisfies TrendResult;
const SECOND_RESULT = {
  ...resultFor([COMPREHENSIVE_POINTS[0]], { from: '2026-07-01T13:00:00.000Z', to: SECOND_CAPTURED_TO }),
  instance: { id: SECOND_INSTANCE_ID, name: SECOND_INSTANCE_NAME, arrType: 'sonarr' },
} satisfies TrendResult;
const SINGLETON_RESULT = resultFor([COMPREHENSIVE_POINTS[0]]);
const FILTERED_EMPTY_RESULT = resultFor([], { from: '2026-06-10T12:00:00.000Z' });
const NEVER_COLLECTED_RESULT = resultFor([], { from: null, to: CAPTURED_ALL_TO });
const PROFILE_RESULT = resultFor(
  [
    {
      snapshotId: 601,
      generatedAt: '2026-06-15T00:00:00.000Z',
      engineVersion: '1',
      state: 'measured',
      score: 70,
      band: 'attention',
      criteria: [],
    },
    {
      snapshotId: 602,
      generatedAt: '2026-06-25T00:00:00.000Z',
      engineVersion: '1',
      state: 'profile-missing',
      score: null,
      band: null,
      criteria: [],
    },
    {
      snapshotId: 603,
      generatedAt: '2026-07-05T00:00:00.000Z',
      engineVersion: '2',
      state: 'not-recorded',
      score: null,
      band: null,
      criteria: [],
    },
  ],
  { profile: HOSTILE_PROFILE }
);

const SECOND_DETAIL_RESPONSE = {
  ...DETAIL_RESPONSE,
  instanceId: SECOND_INSTANCE_ID,
  instanceName: SECOND_INSTANCE_NAME,
  generatedAt: SECOND_CAPTURED_TO,
} satisfies DetailResponse;

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installConfigHealthMocks(page: Page, trendHandler: TrendHandler): Promise<void> {
  await page.route(`**/api/v1/config-health/${INSTANCE_ID}/trends*`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/trends')) {
      await trendHandler(route, url);
      return;
    }
    await route.abort();
  });
  await page.route(`**/api/v1/config-health/${INSTANCE_ID}`, async (route) => {
    await fulfillJson(route, DETAIL_RESPONSE);
  });
}

async function ensureAuthenticated(page: Page): Promise<void> {
  await page.goto('/settings/general');
  await page.waitForLoadState('networkidle');
  if (page.url().includes('/settings/general') || page.url().includes('/settings/security')) return;

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

async function openConfigHealth(page: Page): Promise<void> {
  await page.goto(`/config-health/${INSTANCE_ID}`);
  await expect(page.getByRole('heading', { name: 'Applied historical evidence' })).toBeVisible();
}

async function selectRange(page: Page, value: '7' | '30' | '90' | 'all'): Promise<void> {
  await page.getByLabel('Time range').selectOption(value);
  await page.getByRole('button', { name: 'Apply filters' }).click();
}

function exportParams(href: string): URLSearchParams {
  return new URL(href, 'http://localhost').searchParams;
}

test.describe('Config Health trends and export', () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ page }) => {
    await ensureAuthenticated(page);
  });

  test('initial 30-day load renders actual-time gaps, criteria, engines, table parity, exports, and keyboard inspection', async ({
    page,
  }) => {
    const requests: URL[] = [];
    await installConfigHealthMocks(page, async (route, url) => {
      requests.push(url);
      await fulfillJson(route, COMPREHENSIVE_RESULT);
    });

    await openConfigHealth(page);
    expect(requests[0].searchParams.get('days')).toBe('30');
    await expect(page.getByText('Last 30 days', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('3 measured points and 2 explicit evidence gaps.')).toBeVisible();
    await expect(page.getByText('Engine changed here')).toBeVisible();
    await expect(page.getByText('Unknown — score not measured')).toBeVisible();
    await expect(page.getByText('Evidence not recorded').last()).toBeVisible();

    const overallChart = page.getByRole('img', { name: /^Persisted config health score history/ });
    await expect(overallChart).toBeVisible();
    const markerX = await overallChart
      .locator('circle')
      .evaluateAll((markers) => markers.slice(0, 3).map((marker) => Number(marker.getAttribute('cx'))));
    expect(markerX).toHaveLength(3);
    expect(markerX[1] - markerX[0]).toBeLessThan(markerX[2] - markerX[1]);

    const table = page.getByRole('region', { name: /Config Health history table/ });
    await expect(table).toContainText(HOSTILE_CRITERION);
    await expect(table).toContainText('Score');
    await expect(table).toContainText('45');
    await expect(table).toContainText('Contribution');
    await expect(table).toContainText('18');
    await expect(table).toContainText('Not evaluated');
    await expect(table.locator('tbody tr')).toHaveCount(COMPREHENSIVE_POINTS.length);

    const jsonHref = await page.getByRole('link', { name: 'Export JSON' }).getAttribute('href');
    const csvHref = await page.getByRole('link', { name: 'Export CSV' }).getAttribute('href');
    expect(jsonHref).not.toBeNull();
    expect(csvHref).not.toBeNull();
    expect(exportParams(jsonHref!).get('format')).toBe('json');
    expect(exportParams(csvHref!).get('format')).toBe('csv');
    expect(exportParams(jsonHref!).get('from')).toBe(COMPREHENSIVE_RESULT.normalizedFilter.from);
    expect(exportParams(jsonHref!).get('to')).toBe(CAPTURED_TO);
    expect(exportParams(jsonHref!).has('days')).toBe(false);

    const pointSelector = page.getByRole('slider', { name: 'Trend point' });
    await pointSelector.focus();
    await expect(pointSelector).toBeFocused();
    await expect.poll(() => pointSelector.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none');
    await pointSelector.press('End');
    await expect(pointSelector).toHaveAttribute('aria-valuenow', '5');
    await expect(page.getByText('Snapshot 505', { exact: false })).toBeVisible();
    await pointSelector.press('Home');
    await pointSelector.press('ArrowRight');
    await expect(pointSelector).toHaveAttribute('aria-valuenow', '2');
    await expect(page.getByText('Snapshot 502', { exact: false })).toBeVisible();
    await expect(pointSelector).toBeFocused();
  });

  test('max-size history mounts a bounded table page and preserves chronological access to all 10,000 points', async ({
    page,
  }) => {
    await installConfigHealthMocks(page, async (route) => {
      await fulfillJson(route, MAX_SIZE_RESULT);
    });

    await openConfigHealth(page);

    const table = page.getByRole('region', { name: /Config Health history table/ });
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(50);
    await expect(table.locator('tbody li')).toHaveCount(50);
    await expect(page.getByRole('status').filter({ hasText: 'of 10,000' })).toContainText(
      'Showing chronological snapshots 1–50 of 10,000. Page 1 of 200.'
    );
    await expect(table).toContainText('#700000');
    await expect(table).not.toContainText('#700050');

    const nextPage = page.getByRole('button', { name: 'Next evidence page' });
    const nextPageBox = await nextPage.boundingBox();
    expect(nextPageBox).not.toBeNull();
    expect(nextPageBox!.height).toBeGreaterThanOrEqual(44);
    await nextPage.focus();
    await nextPage.press('Enter');

    await expect(rows).toHaveCount(50);
    await expect(table.locator('tbody li')).toHaveCount(50);
    await expect(page.getByRole('status').filter({ hasText: 'of 10,000' })).toContainText(
      'Showing chronological snapshots 51–100 of 10,000. Page 2 of 200.'
    );
    await expect(table).toContainText('#700050');
    await expect(table).not.toContainText('#700000');

    await page.getByLabel('Historical evidence page').selectOption('200');
    await expect(rows).toHaveCount(50);
    await expect(table).toContainText('#709999');
    await expect(page.getByRole('status').filter({ hasText: 'of 10,000' })).toContainText(
      'Showing chronological snapshots 9,951–10,000 of 10,000. Page 200 of 200.'
    );

    for (const name of ['Export JSON', 'Export CSV']) {
      const href = await page.getByRole('link', { name }).getAttribute('href');
      expect(href).not.toBeNull();
      expect(exportParams(href!).has('page')).toBe(false);
    }
  });

  test('superseded applies cannot overwrite the latest result and a failed apply retries its exact filter', async ({
    page,
  }) => {
    let sevenCalls = 0;
    let releaseStaleSeven: () => void = () => undefined;
    const staleSevenGate = new Promise<void>((resolve) => {
      releaseStaleSeven = resolve;
    });

    await installConfigHealthMocks(page, async (route, url) => {
      const days = url.searchParams.get('days');
      if (days === '7') {
        sevenCalls += 1;
        if (sevenCalls === 1) {
          await staleSevenGate;
          await fulfillJson(
            route,
            resultFor(COMPREHENSIVE_POINTS.slice(0, 2), { from: '2026-07-03T12:00:00.000Z' })
          ).catch(() => undefined);
          return;
        }
        if (sevenCalls === 2) {
          await fulfillJson(route, { error: 'Temporary trend failure' }, 503);
          return;
        }
        await fulfillJson(route, resultFor(COMPREHENSIVE_POINTS.slice(-2), { from: '2026-07-03T12:00:00.000Z' }));
        return;
      }
      if (days === '90') {
        await fulfillJson(route, resultFor(COMPREHENSIVE_POINTS, { from: '2026-04-11T12:00:00.000Z' }));
        return;
      }
      await fulfillJson(route, COMPREHENSIVE_RESULT);
    });

    await openConfigHealth(page);
    await selectRange(page, '7');
    await expect.poll(() => sevenCalls).toBe(1);
    await selectRange(page, '90');
    await expect(page.getByText('Last 90 days', { exact: false }).first()).toBeVisible();
    releaseStaleSeven();
    await expect(page.getByText('Last 90 days', { exact: false }).first()).toBeVisible();

    await selectRange(page, '7');
    await expect(page.getByText('Temporary trend failure')).toBeVisible();
    await expect(page.getByText('The previous successful result remains below')).toBeVisible();
    await expect(page.getByText('Last 90 days', { exact: false }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Retry trend request' }).click();
    await expect.poll(() => sevenCalls).toBe(3);
    await expect(page.getByText('Last 7 days', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Temporary trend failure')).toHaveCount(0);
  });

  test('instance navigation clears stale state and cannot pair old results with the new export path', async ({
    page,
  }) => {
    let firstDetailCalls = 0;
    let firstNinetyDayCalls = 0;
    let secondDetailCalls = 0;
    let secondTrendCalls = 0;
    let releaseOldDetail: () => void = () => undefined;
    let releaseOldTrend: () => void = () => undefined;
    let releaseSecond: () => void = () => undefined;
    const oldDetailGate = new Promise<void>((resolve) => {
      releaseOldDetail = resolve;
    });
    const oldTrendGate = new Promise<void>((resolve) => {
      releaseOldTrend = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    await installConfigHealthMocks(page, async (route, url) => {
      if (url.searchParams.get('days') === '90') {
        firstNinetyDayCalls += 1;
        await oldTrendGate;
        await fulfillJson(route, resultFor(COMPREHENSIVE_POINTS, { to: '2026-07-10T14:00:00.000Z' })).catch(
          () => undefined
        );
        return;
      }
      await fulfillJson(route, COMPREHENSIVE_RESULT);
    });
    await page.unroute(`**/api/v1/config-health/${INSTANCE_ID}`);
    await page.route(`**/api/v1/config-health/${INSTANCE_ID}`, async (route) => {
      firstDetailCalls += 1;
      if (firstDetailCalls > 1) {
        await oldDetailGate;
        await fulfillJson(route, DETAIL_RESPONSE).catch(() => undefined);
        return;
      }
      await fulfillJson(route, DETAIL_RESPONSE);
    });
    await page.route(`**/api/v1/config-health/${SECOND_INSTANCE_ID}/trends*`, async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.endsWith('/trends')) {
        await route.abort();
        return;
      }
      secondTrendCalls += 1;
      await secondGate;
      await fulfillJson(route, SECOND_RESULT);
    });
    await page.route(`**/api/v1/config-health/${SECOND_INSTANCE_ID}`, async (route) => {
      secondDetailCalls += 1;
      await secondGate;
      await fulfillJson(route, SECOND_DETAIL_RESPONSE);
    });

    await openConfigHealth(page);
    await selectRange(page, '90');
    await expect.poll(() => firstNinetyDayCalls).toBe(1);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect.poll(() => firstDetailCalls).toBe(2);

    await page.getByLabel('Instance').evaluate((select, targetId) => {
      const option = document.createElement('option');
      option.value = String(targetId);
      option.textContent = 'Second test instance';
      select.append(option);
      select.value = String(targetId);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, SECOND_INSTANCE_ID);

    await expect(page).toHaveURL(`/config-health/${SECOND_INSTANCE_ID}`);
    await expect.poll(() => secondDetailCalls).toBe(1);
    await expect.poll(() => secondTrendCalls).toBe(1);
    await expect(page.getByText(HOSTILE_INSTANCE, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Applied historical evidence' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Export JSON' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Export CSV' })).toHaveCount(0);
    await expect(page.getByLabel('Time range')).toHaveValue('30');
    await expect(page.getByLabel('Profile scope')).toHaveValue('');

    releaseSecond();
    await expect(page.getByText(SECOND_INSTANCE_NAME, { exact: true })).toBeVisible();
    await expect(page.getByText('Last 30 days', { exact: false }).first()).toBeVisible();
    const secondJsonHref = await page.getByRole('link', { name: 'Export JSON' }).getAttribute('href');
    expect(secondJsonHref).not.toBeNull();
    expect(new URL(secondJsonHref!, 'http://localhost').pathname).toBe(
      `/api/v1/config-health/${SECOND_INSTANCE_ID}/trends/export`
    );
    expect(exportParams(secondJsonHref!).get('to')).toBe(SECOND_CAPTURED_TO);

    releaseOldDetail();
    releaseOldTrend();
    await expect(page.getByText(SECOND_INSTANCE_NAME, { exact: true })).toBeVisible();
    await expect(page.getByText(HOSTILE_INSTANCE, { exact: true })).toHaveCount(0);
    await expect(page.getByText('Last 30 days', { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Export JSON' })).toHaveAttribute(
      'href',
      new RegExp(`/api/v1/config-health/${SECOND_INSTANCE_ID}/trends/export`)
    );
  });

  test('filtered-empty can widen to never-collected All history and exports use the captured absolute upper bound', async ({
    page,
  }) => {
    const requests: URL[] = [];
    await installConfigHealthMocks(page, async (route, url) => {
      requests.push(url);
      await fulfillJson(route, url.searchParams.has('days') ? FILTERED_EMPTY_RESULT : NEVER_COLLECTED_RESULT);
    });

    await openConfigHealth(page);
    await expect(
      page.getByText('No snapshots match the applied range. Try a wider range or All retained.')
    ).toBeVisible();
    await expect(page.getByText('No chart axes are shown')).toBeVisible();
    await page.getByRole('button', { name: 'Show all retained history' }).click();
    await expect(
      page.getByText('No Config Health snapshots have been collected or remain retained for this instance.')
    ).toBeVisible();
    expect(requests.at(-1)?.searchParams.has('days')).toBe(false);

    const jsonHref = await page.getByRole('link', { name: 'Export JSON' }).getAttribute('href');
    expect(jsonHref).not.toBeNull();
    const params = exportParams(jsonHref!);
    expect(params.get('to')).toBe(CAPTURED_ALL_TO);
    expect(params.has('from')).toBe(false);
    expect(params.has('days')).toBe(false);
    await expect(page.getByText(`All retained history through ${CAPTURED_ALL_TO}`)).toBeVisible();
  });

  test('singleton semantics and exact hostile profile gaps remain explicit and safely escaped', async ({ page }) => {
    await installConfigHealthMocks(page, async (route, url) => {
      await fulfillJson(route, url.searchParams.get('profile') === HOSTILE_PROFILE ? PROFILE_RESULT : SINGLETON_RESULT);
    });

    await openConfigHealth(page);
    await expect(
      page.getByText('One persisted point is available; it does not establish a direction of change.')
    ).toBeVisible();
    const overallChart = page.getByRole('img', { name: /^Persisted config health score history/ });
    await expect(overallChart.locator('circle')).toHaveCount(1);
    await expect(overallChart.locator('path')).toHaveCount(0);
    await expect(page.getByText(HOSTILE_INSTANCE, { exact: true })).toBeVisible();
    await expect(page.getByText(HOSTILE_CRITERION, { exact: true }).first()).toBeVisible();
    expect(await page.locator('[data-e2e-injected]').count()).toBe(0);
    expect(await page.evaluate(() => Boolean((window as { __e2eInjected?: boolean }).__e2eInjected))).toBe(false);

    await page.getByLabel('Profile scope').selectOption({ label: HOSTILE_PROFILE });
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.getByText(`Exact profile: ${HOSTILE_PROFILE}`)).toBeVisible();
    await expect(page.getByText('Profile missing at this snapshot')).toBeVisible();
    await expect(page.getByText('Evidence not recorded').last()).toBeVisible();
    await expect(
      page.getByText('Historical criterion scores and contributions were not recorded for profiles.')
    ).toBeVisible();
    expect(await page.locator('[data-e2e-injected]').count()).toBe(0);

    const csvHref = await page.getByRole('link', { name: 'Export CSV' }).getAttribute('href');
    expect(csvHref).not.toBeNull();
    expect(exportParams(csvHref!).get('profile')).toBe(HOSTILE_PROFILE);
  });

  for (const width of [320, 375, 390, 768, 1280]) {
    test(`contains essential scrolling and touch controls without page overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await installConfigHealthMocks(page, async (route) => {
        await fulfillJson(route, COMPREHENSIVE_RESULT);
      });
      await openConfigHealth(page);

      const dimensions = await page.evaluate(() => ({
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
      }));
      expect(dimensions.documentWidth, `document overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
      expect(dimensions.bodyWidth, `body overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);

      const chartScroller = page.getByLabel('Scrollable overall score chart');
      await expect(chartScroller).toBeVisible();
      if (width <= 390) {
        const scrollMetrics = await chartScroller.evaluate((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }));
        expect(scrollMetrics.scrollWidth).toBeGreaterThan(scrollMetrics.clientWidth);
      }

      for (const name of ['Previous point', 'Next point']) {
        const box = await page.getByRole('button', { name }).boundingBox();
        expect(box, `${name} missing at ${width}px`).not.toBeNull();
        expect(box!.height, `${name} touch height at ${width}px`).toBeGreaterThanOrEqual(44);
      }
      await expect(page.getByRole('link', { name: 'Export JSON' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Export CSV' })).toBeVisible();
    });
  }
});
