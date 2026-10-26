import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

const E2E_USERNAME = process.env.E2E_USERNAME;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

// Rules from the YAN-592 acceptance criteria: every control has an accessible name and every page
// offers a way to bypass the repeated navigation.
const NAME_AND_BYPASS_RULES = ['button-name', 'link-name', 'bypass'];

const STATIC_PAGES = [
  '/databases',
  '/arr',
  '/sync-history',
  '/settings',
  '/settings/general',
  '/settings/notifications',
  '/settings/backups',
  '/settings/logs',
];

// List pages that default to card view; force their table view so each row exposes one row link.
const TABLE_VIEW_STORAGE_KEYS = ['customFormatsView', 'qualityProfilesView', 'regularExpressionsView'];

// Per-database list pages; `{db}` is replaced with the first linked database id.
const DATABASE_LIST_PAGES = [
  '/custom-formats/{db}',
  '/quality-profiles/{db}',
  '/regular-expressions/{db}',
  '/delay-profiles/{db}',
  '/media-management/{db}/naming',
  '/media-management/{db}/media-settings',
  '/media-management/{db}/quality-definitions',
];

async function signInIfNeeded(page: Page, path: string): Promise<void> {
  await page.goto(path);
  if (!page.url().includes('/auth/login')) return;
  if (!E2E_USERNAME || !E2E_PASSWORD) {
    test.skip(true, 'AUTH is required. Set E2E_USERNAME and E2E_PASSWORD to run auth-gated UI e2e tests.');
  }
  await page.getByRole('textbox', { name: 'Username' }).fill(E2E_USERNAME!);
  await page.getByLabel('Password').fill(E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/auth/'));
  await page.goto(path);
}

async function nameAndBypassViolations(page: Page): Promise<string[]> {
  // Not `networkidle`: the live-events SSE stream keeps a request open on every app page.
  await page.waitForLoadState('load');
  await page.locator('main#main').waitFor();
  const results = await new AxeBuilder({ page }).withRules(NAME_AND_BYPASS_RULES).analyze();
  return results.violations.map(
    (violation) => `${page.url()} ${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`
  );
}

async function firstDatabaseId(page: Page): Promise<string | null> {
  await signInIfNeeded(page, '/databases');
  const hrefs = await page
    .locator('a[href^="/databases/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  for (const href of hrefs) {
    const match = /^\/databases\/(\d+)(?:\/|$)/.exec(href);
    if (match) return match[1];
  }
  return null;
}

test.describe('accessible names and landmarks', () => {
  test('skip link moves focus to the main landmark', async ({ page }) => {
    await signInIfNeeded(page, '/databases');
    await page.waitForLoadState('networkidle');
    const skipLink = page.getByRole('link', { name: 'Skip to main content' });

    // Keys pressed before hydration are lost, so reload until the first Tab lands on the skip link.
    await expect(async () => {
      await page.reload();
      await page.waitForLoadState('networkidle');
      await page.keyboard.press('Tab');
      await expect(skipLink).toBeFocused({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await expect(skipLink).toBeInViewport();

    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
  });

  test('main list pages have named controls and a bypass mechanism', async ({ page }) => {
    // Eight pages with an axe scan each.
    test.setTimeout(180_000);
    await signInIfNeeded(page, STATIC_PAGES[0]);
    const violations: string[] = [];
    for (const path of STATIC_PAGES) {
      await page.goto(path);
      violations.push(...(await nameAndBypassViolations(page)));
    }
    expect(violations).toEqual([]);
  });

  test('database list and edit pages have named controls and unique titles', async ({ page }) => {
    // Visits up to 14 pages (7 lists plus their first editor) with an axe scan on each.
    test.setTimeout(180_000);
    await page.addInitScript((keys) => {
      for (const key of keys) localStorage.setItem(key, 'table');
    }, TABLE_VIEW_STORAGE_KEYS);
    const databaseId = await firstDatabaseId(page);
    test.skip(!databaseId, 'No linked PCD database; link one (default Praxrr-DB auto-link) to run this test.');

    const violations: string[] = [];
    const titles = new Map<string, string>();

    for (const template of DATABASE_LIST_PAGES) {
      const listPath = template.replace('{db}', databaseId!);
      await page.goto(listPath);
      violations.push(...(await nameAndBypassViolations(page)));
      titles.set(listPath, await page.title());

      // Open the first entity's editor through its row link; a list with rows must expose one.
      const rowCount = await page.locator('tbody tr:has(td a.cell-link)').count();
      if (rowCount === 0) continue;
      const rowLinks = page.locator('tbody a.cell-link:not([aria-hidden="true"])');
      expect(await rowLinks.count(), `${listPath} has linked rows but no focusable row link`).toBeGreaterThan(0);
      const editPath = await rowLinks.first().getAttribute('href');
      expect(editPath, `${listPath} row link has no href`).toBeTruthy();
      await page.goto(editPath!);
      violations.push(...(await nameAndBypassViolations(page)));
      titles.set(editPath!, await page.title());
    }

    expect(violations).toEqual([]);

    const seen = new Map<string, string>();
    for (const [path, title] of titles) {
      expect(title, `${path} has no specific title`).toMatch(/^.+ - Praxrr$/);
      expect(seen.get(title), `${path} shares its title "${title}"`).toBeUndefined();
      seen.set(title, path);
    }
  });
});
