import { expect, type Locator, type Page, type Route, test } from '@playwright/test';
import type { components } from '$api/v1.d.ts';

const E2E_USERNAME = process.env.E2E_USERNAME;
const E2E_PASSWORD = process.env.E2E_PASSWORD;
const NOW = '2026-07-12T00:00:00.000Z';
const HOSTILE_NAME = 'Hostile <svg data-e2e-injected="name"></svg> plugin';
const HOSTILE_DESCRIPTION =
  '<img data-e2e-injected="description" src=x onerror="window.__pluginE2eInjected=true"> exact description';
const HOSTILE_ERROR = '<script data-e2e-injected="error">window.__pluginE2eInjected=true</script> lifecycle only';

type PluginManifest = components['schemas']['PluginManifestMetadata'];
type PluginRecord = components['schemas']['PluginRecord'];
type PluginListResponse = components['schemas']['PluginListResponse'];
type PluginMutationResponse = components['schemas']['PluginMutationResponse'];
type PluginReloadResponse = components['schemas']['PluginReloadResponse'];
type PluginErrorResponse = components['schemas']['PluginErrorResponse'];

type PluginHandler = (route: Route, requestUrl: URL) => Promise<void>;

const BASE_MANIFEST = {
  apiVersion: '1',
  id: 'example.plugin',
  name: 'Example Plugin',
  version: '1.2.3',
  runtime: 'wasm',
  entry: 'plugin.wasm',
  extensionPoints: ['config.profileCompiled.observe', 'config.validation.observe'],
  capabilities: ['read:resolved-profile'],
  description: 'A deterministic plugin fixture.',
  author: 'Praxrr E2E',
  engines: { praxrr: '>=2' },
} satisfies PluginManifest;

function pluginRecord(
  overrides: Partial<Omit<PluginRecord, 'manifest'>> = {},
  manifestOverrides: Partial<PluginManifest> = {}
): PluginRecord {
  return {
    manifest: { ...BASE_MANIFEST, ...manifestOverrides },
    enabled: false,
    discovered: true,
    state: 'registered',
    registeredAt: NOW,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const DISCOVERED = pluginRecord();
const RETAINED = pluginRecord(
  { enabled: true, discovered: false, state: 'unloaded' },
  { id: 'missing.plugin', name: 'Missing Plugin', version: '0.9.0' }
);
const HOSTILE = pluginRecord(
  { lastError: HOSTILE_ERROR },
  { id: 'hostile.plugin', name: HOSTILE_NAME, description: HOSTILE_DESCRIPTION }
);

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installPluginMocks(page: Page, handler: PluginHandler): Promise<void> {
  await page.route('**/api/v1/plugins**', async (route) => {
    await handler(route, new URL(route.request().url()));
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

  if (page.url().includes('/setup')) {
    await page.getByRole('button', { name: 'Skip wizard' }).click();
    await page.waitForLoadState('networkidle');
  }
}

async function openPlugins(page: Page): Promise<void> {
  await page.goto('/settings/plugins');
  await expect(page.getByRole('heading', { name: 'Plugin Management' })).toBeVisible();
}

async function expectTouchTarget(control: Locator, name: string): Promise<void> {
  const box = await control.boundingBox();
  expect(box, `${name} is missing`).not.toBeNull();
  expect(box!.height, `${name} touch height`).toBeGreaterThanOrEqual(44);
}

function list(items: PluginRecord[], pluginsEnabled = true): PluginListResponse {
  return { pluginsEnabled, items };
}

function mutation(plugin: PluginRecord): PluginMutationResponse {
  return { pluginsEnabled: true, plugin };
}

function reload(overrides: Partial<PluginReloadResponse> = {}): PluginReloadResponse {
  return {
    pluginsEnabled: true,
    reloaded: true,
    discovered: 1,
    registered: 1,
    rejected: 0,
    missing: 0,
    ...overrides,
  };
}

function pluginError(error: string, code: PluginErrorResponse['code'] = 'internal_error'): PluginErrorResponse {
  return { code, error };
}

test.describe('Plugin management', () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ page }) => {
    await ensureAuthenticated(page);
  });

  test('feature-off is a normal configuration state with an enable control and no registry mutations', async ({
    page,
  }) => {
    let requests = 0;
    await installPluginMocks(page, async (route, url) => {
      requests += 1;
      expect(url.pathname).toBe('/api/v1/plugins');
      expect(route.request().method()).toBe('GET');
      await fulfillJson(route, list([], false));
    });

    await openPlugins(page);
    await expect(page.getByRole('heading', { name: 'Plugin ecosystem is off' })).toBeVisible();
    await expect(page.getByText('Enable plugins', { exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Enable plugins' })).toBeVisible();
    await expect(page.getByText('PLUGINS_ENABLED')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reload plugins' })).toHaveCount(0);
    expect(requests).toBe(1);
  });

  test('feature-off enable checkbox persists via settings API then loads the registry', async ({ page }) => {
    let settingsCalls = 0;
    let listCalls = 0;
    await installPluginMocks(page, async (route, url) => {
      if (url.pathname === '/api/v1/plugins/settings' && route.request().method() === 'PATCH') {
        settingsCalls += 1;
        expect(route.request().postDataJSON()).toEqual({ pluginsEnabled: true });
        await fulfillJson(route, { pluginsEnabled: true });
        return;
      }
      listCalls += 1;
      await fulfillJson(route, listCalls === 1 ? list([], false) : list([DISCOVERED]));
    });

    await openPlugins(page);
    await page.getByRole('checkbox', { name: 'Enable plugins' }).click();
    await expect(page.getByText('Example Plugin', { exact: true }).first()).toBeVisible();
    expect(settingsCalls).toBe(1);
    expect(listCalls).toBe(2);
  });

  test('feature-off reload response transitions to disabled without claiming a successful scan', async ({ page }) => {
    let reloadCalls = 0;
    await installPluginMocks(page, async (route, url) => {
      if (url.pathname === '/api/v1/plugins/reload') {
        reloadCalls += 1;
        await fulfillJson(
          route,
          reload({ pluginsEnabled: false, reloaded: false, discovered: 0, registered: 0, rejected: 0, missing: 0 })
        );
        return;
      }
      await fulfillJson(route, list([DISCOVERED]));
    });

    await openPlugins(page);
    await expect(page.getByText('Example Plugin', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Reload plugins' }).click();

    await expect(page.getByRole('heading', { name: 'Plugin ecosystem is off' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Latest reload summary' })).toHaveCount(0);
    await expect(page.getByText(/Reload committed/)).toHaveCount(0);
    expect(reloadCalls).toBe(1);
  });

  test('enabled-empty reload reports aggregate counters, keeps rejected identities private, then loads records', async ({
    page,
  }) => {
    let listCalls = 0;
    const requestOrder: string[] = [];
    await installPluginMocks(page, async (route, url) => {
      if (url.pathname === '/api/v1/plugins/reload') {
        requestOrder.push('reload');
        await fulfillJson(route, reload({ discovered: 3, registered: 1, rejected: 2, missing: 1 }));
        return;
      }
      listCalls += 1;
      requestOrder.push(`list-${listCalls}`);
      await fulfillJson(route, list(listCalls === 1 ? [] : [DISCOVERED]));
    });

    await openPlugins(page);
    const empty = page.getByRole('heading', { name: 'No plugins discovered' }).locator('..');
    await expect(empty).toBeVisible();
    await empty.getByRole('button', { name: 'Reload plugins' }).click();

    const summary = page.getByRole('region', { name: 'Latest reload summary' });
    for (const [label, count] of [
      ['Discovered', '3'],
      ['Registered', '1'],
      ['Rejected', '2'],
      ['Missing', '1'],
    ] as const) {
      await expect(summary.getByText(label, { exact: true }).locator('..')).toContainText(count);
    }
    await expect(summary).toContainText('Rejected entries are reported only as an aggregate');
    await expect(summary).toContainText('server logs');
    await expect(page.getByText('Example Plugin', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/rejected plugin id|secret rejected|manifest path/i)).toHaveCount(0);
    expect(requestOrder).toEqual(['list-1', 'reload', 'list-2']);
  });

  test('discovered and retained records remain truthful, escaped, keyboard inspectable, and pessimistic on success', async ({
    page,
  }) => {
    let mutationCalls = 0;
    let releaseMutation: () => void = () => undefined;
    const mutationGate = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    const updated = { ...HOSTILE, enabled: true, updatedAt: '2026-07-12T01:00:00.000Z' } satisfies PluginRecord;

    await installPluginMocks(page, async (route, url) => {
      if (url.pathname.endsWith('/enable')) {
        mutationCalls += 1;
        await mutationGate;
        await fulfillJson(route, mutation(updated));
        return;
      }
      await fulfillJson(route, list([RETAINED, HOSTILE]));
    });

    await openPlugins(page);
    const cards = page.locator('article');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText(HOSTILE_NAME);
    await expect(cards.nth(1)).toContainText('Missing Plugin');
    await expect(cards.nth(1)).toContainText('Enabled when rediscovered');
    await expect(cards.nth(1)).toContainText('Missing from latest scan');

    const hostileCard = cards.nth(0);
    const disclosure = hostileCard.locator('summary');
    await disclosure.focus();
    await disclosure.press('Enter');
    await expect(disclosure).toBeFocused();
    await expect(hostileCard.getByRole('heading', { name: 'Identity' })).toBeVisible();
    await expect(hostileCard.getByText(HOSTILE_DESCRIPTION, { exact: true })).toBeVisible();
    await expect(hostileCard.getByText(HOSTILE_ERROR, { exact: true })).toBeVisible();
    await expect(hostileCard.getByText('Execution telemetry unavailable in this build', { exact: true })).toBeVisible();
    await expect(hostileCard.getByText('Wired', { exact: true })).toBeVisible();
    await expect(hostileCard.getByText('Declared, not wired', { exact: true })).toBeVisible();
    await expect(hostileCard.getByText('Read resolved profile', { exact: true })).toBeVisible();
    expect(await page.locator('[data-e2e-injected]').count()).toBe(0);
    expect(await page.evaluate(() => Boolean((window as { __pluginE2eInjected?: boolean }).__pluginE2eInjected))).toBe(
      false
    );

    const enable = hostileCard.getByRole('button', { name: `Enable plugin: ${HOSTILE_NAME}` });
    await enable.focus();
    await enable.press('Enter');
    await expect.poll(() => mutationCalls).toBe(1);
    await expect(enable).toBeFocused();
    await expect(enable).toHaveAccessibleName(`Enable plugin: ${HOSTILE_NAME}`);
    await expect(hostileCard).toHaveAttribute('aria-busy', 'true');
    await expect(hostileCard).toContainText('Disabled');
    await expect(
      page.getByRole('status').filter({ hasText: `Saving enablement intent for ${HOSTILE_NAME}` })
    ).toBeAttached();

    releaseMutation();
    const disable = hostileCard.getByRole('button', { name: `Disable plugin: ${HOSTILE_NAME}` });
    await expect(disable).toBeVisible();
    await expect(disable).toBeFocused();
    await expect(hostileCard).toHaveAttribute('aria-busy', 'false');
    await expect(hostileCard).toContainText('Enabled for future dispatch');
    await expect(hostileCard).not.toContainText(/currently active|currently running|last run succeeded/i);
  });

  test('mutation failure preserves confirmed intent and escaped inline recovery retries successfully', async ({
    page,
  }) => {
    let mutationCalls = 0;
    const updated = { ...DISCOVERED, enabled: true } satisfies PluginRecord;
    await installPluginMocks(page, async (route, url) => {
      if (url.pathname.endsWith('/enable')) {
        mutationCalls += 1;
        await fulfillJson(
          route,
          mutationCalls === 1
            ? pluginError('<img data-e2e-injected="mutation"> Safe redacted failure')
            : mutation(updated),
          mutationCalls === 1 ? 500 : 200
        );
        return;
      }
      await fulfillJson(route, list([DISCOVERED]));
    });

    await openPlugins(page);
    const card = page.locator('article');
    await card.getByRole('button', { name: 'Enable plugin: Example Plugin' }).click();
    await expect(card).toContainText('<img data-e2e-injected="mutation"> Safe redacted failure');
    await expect(card.getByRole('button', { name: 'Enable plugin: Example Plugin' })).toBeVisible();
    expect(await page.locator('[data-e2e-injected]').count()).toBe(0);

    await card.getByRole('button', { name: 'Retry intent change: Example Plugin' }).click();
    await expect(card.getByRole('button', { name: 'Disable plugin: Example Plugin' })).toBeVisible();
    await expect(card.getByRole('alert')).toHaveCount(0);
    expect(mutationCalls).toBe(2);
  });

  for (const outcome of [404, 409] as const) {
    test(`${outcome} mutation response refetches authoritative ${outcome === 404 ? 'empty' : 'feature-off'} state`, async ({
      page,
    }) => {
      let listCalls = 0;
      let mutationCalls = 0;
      await installPluginMocks(page, async (route, url) => {
        if (url.pathname.endsWith('/enable')) {
          mutationCalls += 1;
          await fulfillJson(
            route,
            outcome === 404
              ? pluginError('Plugin not found.', 'plugin_not_found')
              : pluginError('Plugin management is disabled.', 'plugins_disabled'),
            outcome
          );
          return;
        }
        listCalls += 1;
        await fulfillJson(
          route,
          list(mutationCalls === 0 ? [DISCOVERED] : [], mutationCalls === 0 ? true : outcome !== 409)
        );
      });

      await openPlugins(page);
      await page.getByRole('button', { name: 'Enable plugin: Example Plugin' }).click();
      if (outcome === 404) {
        await expect(page.getByRole('heading', { name: 'No plugins discovered' })).toBeVisible();
      } else {
        await expect(page.getByRole('heading', { name: 'Plugin ecosystem is off' })).toBeVisible();
      }
      expect(mutationCalls).toBe(1);
      expect(listCalls).toBeGreaterThanOrEqual(2);
    });
  }

  test('committed reload plus failed refresh retains stale rows and retry restores the authoritative view', async ({
    page,
  }) => {
    let listCalls = 0;
    const refreshed = pluginRecord({}, { name: 'Refreshed Plugin' });
    await installPluginMocks(page, async (route, url) => {
      if (url.pathname === '/api/v1/plugins/reload') {
        await fulfillJson(route, reload({ discovered: 2, registered: 1, rejected: 1, missing: 1 }));
        return;
      }
      listCalls += 1;
      if (listCalls === 2) {
        await fulfillJson(route, pluginError('Safe refresh failure'), 500);
        return;
      }
      await fulfillJson(route, list(listCalls === 1 ? [DISCOVERED] : [refreshed]));
    });

    await openPlugins(page);
    await page.getByRole('button', { name: 'Reload plugins' }).click();

    await expect(page.getByRole('heading', { name: 'Latest reload summary' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Showing the last confirmed registry view' })).toBeVisible();
    const stale = page.getByRole('region', { name: 'Showing the last confirmed registry view' });
    await expect(stale).toContainText('Reload committed, but the refreshed registry could not be loaded.');
    await expect(page.getByText('Example Plugin', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Plugin reload failed' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Retry refresh' }).click();
    await expect(page.getByText('Refreshed Plugin', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Showing the last confirmed registry view' })).toHaveCount(0);
    expect(listCalls).toBe(3);
  });

  test('duplicate reload activation is single-flight', async ({ page }) => {
    let reloadCalls = 0;
    let listCalls = 0;
    let releaseReload: () => void = () => undefined;
    const reloadGate = new Promise<void>((resolve) => {
      releaseReload = resolve;
    });

    await installPluginMocks(page, async (route, url) => {
      if (url.pathname === '/api/v1/plugins/reload') {
        reloadCalls += 1;
        await reloadGate;
        await fulfillJson(route, reload());
        return;
      }
      listCalls += 1;
      await fulfillJson(route, list([listCalls === 1 ? DISCOVERED : pluginRecord({}, { name: 'Newest Mount' })]));
    });

    await openPlugins(page);
    const reloadButton = page.getByRole('button', { name: 'Reload plugins' });
    await reloadButton.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect.poll(() => reloadCalls).toBe(1);
    await expect(reloadButton).toHaveAccessibleName('Reload plugins');
    await expect(reloadButton).toBeDisabled();
    releaseReload();
    await expect(page.getByText('Newest Mount', { exact: true }).first()).toBeVisible();
    expect(reloadCalls).toBe(1);
  });

  test('a response from an abandoned mount cannot overwrite the current page', async ({ page }) => {
    let listCalls = 0;
    let releaseAbandoned: () => void = () => undefined;
    const abandonedGate = new Promise<void>((resolve) => {
      releaseAbandoned = resolve;
    });

    await installPluginMocks(page, async (route, url) => {
      expect(url.pathname).toBe('/api/v1/plugins');
      listCalls += 1;
      if (listCalls === 1) {
        await abandonedGate;
        await fulfillJson(route, list([pluginRecord({}, { name: 'Abandoned Response' })])).catch(() => undefined);
        return;
      }
      await fulfillJson(route, list([pluginRecord({}, { name: 'Current Response' })]));
    });

    await page.goto('/settings/plugins', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => listCalls).toBe(1);
    await page.goto('/settings/general');
    await openPlugins(page);
    await expect(page.getByText('Current Response', { exact: true }).first()).toBeVisible();

    releaseAbandoned();
    await page.waitForTimeout(100);
    await expect(page.getByText('Current Response', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Abandoned Response', { exact: true })).toHaveCount(0);
  });

  test('320px action and recovery controls all provide 44px touch targets', async ({ page }) => {
    type Scenario = 'records' | 'initial-error' | 'feature-off' | 'empty';

    let scenario: Scenario = 'records';
    await page.setViewportSize({ width: 320, height: 900 });
    await installPluginMocks(page, async (route, url) => {
      if (url.pathname.endsWith('/enable')) return fulfillJson(route, pluginError('Safe mutation failure'), 500);
      if (url.pathname === '/api/v1/plugins/reload') return fulfillJson(route, pluginError('Safe reload failure'), 500);
      if (scenario === 'initial-error') return fulfillJson(route, pluginError('Safe list failure'), 500);
      await fulfillJson(route, list(scenario === 'records' ? [DISCOVERED] : [], scenario !== 'feature-off'));
    });

    await openPlugins(page);
    await expectTouchTarget(page.getByRole('button', { name: 'Refresh registry' }), 'Header refresh');
    await expectTouchTarget(page.getByRole('button', { name: 'Reload plugins' }).first(), 'Header reload');

    const card = page.locator('article');
    const rowAction = card.getByRole('button', { name: 'Enable plugin: Example Plugin' });
    await expectTouchTarget(rowAction, 'Plugin enablement action');
    await rowAction.click();
    await expectTouchTarget(
      card.getByRole('button', { name: 'Retry intent change: Example Plugin' }),
      'Plugin row retry'
    );

    await page.getByRole('button', { name: 'Reload plugins' }).first().click();
    await expectTouchTarget(page.getByRole('button', { name: 'Retry reload' }), 'Reload retry');

    scenario = 'initial-error';
    await page.getByRole('button', { name: 'Refresh registry' }).click();
    await expectTouchTarget(page.getByRole('button', { name: 'Retry refresh' }), 'Stale refresh retry');

    await page.reload();
    await expectTouchTarget(page.getByRole('button', { name: 'Retry load' }), 'Initial load retry');

    scenario = 'feature-off';
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Plugin ecosystem is off' })).toBeVisible();
    await expectTouchTarget(page.getByRole('checkbox', { name: 'Enable plugins' }), 'Feature-off enable checkbox');

    scenario = 'empty';
    await page.reload();
    const empty = page.getByRole('heading', { name: 'No plugins discovered' }).locator('..');
    await expect(empty).toBeVisible();
    await expectTouchTarget(empty.getByRole('button', { name: 'Reload plugins' }), 'Empty-state reload');
  });

  test('320px dark reflow has no document overflow, readable contrast, keyboard disclosure, and touch targets', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await installPluginMocks(page, async (route) => {
      await fulfillJson(route, list([HOSTILE, RETAINED]));
    });

    await openPlugins(page);
    await page.evaluate(() => document.documentElement.classList.add('dark'));

    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewport);

    const card = page.locator('article').first();
    const disclosure = card.locator('summary');
    const action = card.getByRole('button', { name: `Enable plugin: ${HOSTILE_NAME}` });
    for (const [name, control] of [
      ['Header refresh', page.getByRole('button', { name: 'Refresh registry' })],
      ['Header reload', page.getByRole('button', { name: 'Reload plugins' })],
      ['Plugin disclosure', disclosure],
      ['Plugin enablement action', action],
    ] as const) {
      await expectTouchTarget(control, name);
    }

    await disclosure.focus();
    await disclosure.press('Enter');
    await expect(disclosure).toBeFocused();
    await expect(card.getByText('Execution telemetry unavailable in this build', { exact: true })).toBeVisible();

    const contrast = await card.evaluate((element) => {
      const parse = (value: string): [number, number, number] => {
        const values = value
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number) ?? [0, 0, 0];
        return [values[0], values[1], values[2]];
      };
      const luminance = ([red, green, blue]: [number, number, number]): number => {
        const channels = [red, green, blue].map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      };
      const heading = element.querySelector('h2');
      if (!heading) return 0;
      const foreground = luminance(parse(getComputedStyle(heading).color));
      const background = luminance(parse(getComputedStyle(element).backgroundColor));
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  });
});
