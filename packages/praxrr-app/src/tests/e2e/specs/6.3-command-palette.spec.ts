import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';

const E2E_USERNAME = process.env.E2E_USERNAME;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

async function signInIfNeeded(page: Page, path: string): Promise<void> {
  await page.goto(path);
  if (page.url().includes('/auth/login')) {
    if (!E2E_USERNAME || !E2E_PASSWORD) {
      test.skip(true, 'AUTH is required. Set E2E_USERNAME and E2E_PASSWORD to run auth-gated UI e2e tests.');
    }
    await page.getByRole('textbox', { name: 'Username' }).fill(E2E_USERNAME!);
    await page.getByLabel('Password').fill(E2E_PASSWORD!);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/auth/'));
    await page.goto(path);
  }
  // A fresh deployment forces every page into the setup wizard, where the palette is not mounted.
  // Dismiss it through the same endpoint as the wizard's "Skip wizard" button (no hydration race).
  if (new URL(page.url()).pathname.startsWith('/setup')) {
    const response = await page.request.post('/api/v1/setup/skip');
    expect(response.ok()).toBe(true);
    await page.goto(path);
  }
}

function paletteDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Command palette' });
}

function paletteTrigger(page: Page): Locator {
  return page.getByRole('button', { name: 'Open command palette' });
}

// The SSR markup is visible before client handlers attach, and keys pressed before hydration are
// lost. Retry the shortcut until the palette opens, then close it so each test starts clean.
async function waitForHydratedPalette(page: Page): Promise<void> {
  await page.locator('main#main').waitFor();
  const trigger = paletteTrigger(page);
  await trigger.waitFor({ state: 'visible' });
  const dialog = paletteDialog(page);
  await expect(async () => {
    await trigger.focus();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(dialog).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
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

/** `href` is the exact route the palette option carries (`data-href`) and navigates to. */
type SearchTarget = { name: string; href: string; pathPattern: RegExp };

/**
 * Picks a known entity from the first linked database's custom format table: its row link's
 * accessible name is the entity name and its href is the edit route. Falls back to a nav page.
 */
async function resolveSearchTarget(page: Page): Promise<SearchTarget> {
  const databaseId = await firstDatabaseId(page);
  if (databaseId) {
    await page.addInitScript(() => localStorage.setItem('customFormatsView', 'table'));
    await page.goto(`/custom-formats/${databaseId}`);
    const rowLink = page.locator(`main a[href^="/custom-formats/${databaseId}/"][aria-label]`).first();
    if (await rowLink.isVisible({ timeout: 10_000 }).catch(() => false)) {
      const name = (await rowLink.getAttribute('aria-label')) ?? '';
      const href = (await rowLink.getAttribute('href')) ?? '';
      const match = /^\/custom-formats\/(\d+)\/(\d+)/.exec(href);
      if (name.trim() && match) {
        return {
          name,
          href: `/custom-formats/${match[1]}/${match[2]}`,
          pathPattern: new RegExp(`^/custom-formats/${match[1]}/${match[2]}(?:/|$)`),
        };
      }
    }
  }
  return { name: 'Sync History', href: '/sync-history', pathPattern: /^\/sync-history(?:\/|$)/ };
}

async function criticalViolations(page: Page, selector: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).include(selector).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'critical')
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
}

test.describe('command palette', () => {
  test('opens with Ctrl/Cmd+K, searches, navigates with the keyboard and closes', async ({ page }) => {
    const target = await resolveSearchTarget(page);
    await signInIfNeeded(page, '/databases');
    await waitForHydratedPalette(page);

    const trigger = paletteTrigger(page);
    const dialog = paletteDialog(page);
    const input = dialog.getByRole('combobox');

    // Open: focus moves into the dialog and Tab stays trapped.
    await trigger.focus();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(dialog).toBeVisible();
    await expect(input).toBeFocused();
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await input.focus();

    // Search: the target appears as an option and the combobox tracks the active option.
    await input.fill(target.name);
    const listbox = dialog.getByRole('listbox');
    // Select by exact route, not name: several options (e.g. a page and an entity) can share a name.
    const option = listbox.locator(`[role="option"][data-href="${target.href}"]`);
    await expect(option).toBeVisible();
    await expect(input).toHaveAttribute('aria-expanded', 'true');

    const firstActive = await input.getAttribute('aria-activedescendant');
    expect(firstActive).toBeTruthy();
    await expect(page.locator(`[id="${firstActive}"]`)).toHaveAttribute('aria-selected', 'true');

    const optionCount = await listbox.getByRole('option').count();
    if (optionCount > 1) {
      await page.keyboard.press('ArrowDown');
      await expect(input).not.toHaveAttribute('aria-activedescendant', firstActive!);
      await page.keyboard.press('ArrowUp');
      await expect(input).toHaveAttribute('aria-activedescendant', firstActive!);
    }

    expect(await criticalViolations(page, '[data-command-palette]')).toEqual([]);

    // Move the highlight to the target option, then Enter navigates to its edit route.
    const targetId = await option.getAttribute('id');
    for (let i = 0; i < optionCount && (await input.getAttribute('aria-activedescendant')) !== targetId; i += 1) {
      await page.keyboard.press('ArrowDown');
    }
    await expect(input).toHaveAttribute('aria-activedescendant', targetId!);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await page.waitForURL((url) => target.pathPattern.test(url.pathname));

    // Reopen from the trigger; Escape closes and returns focus to it.
    await page.locator('main#main').waitFor();
    await trigger.focus();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(dialog).toBeVisible();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('opens with "/" outside editable fields and toggles closed with Ctrl/Cmd+K', async ({ page }) => {
    await signInIfNeeded(page, '/databases');
    await waitForHydratedPalette(page);

    const trigger = paletteTrigger(page);
    const dialog = paletteDialog(page);

    await trigger.focus();
    await page.keyboard.press('/');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox')).toBeFocused();
    // Typing "/" inside the palette input types normally instead of reopening.
    await page.keyboard.press('/');
    await expect(dialog.getByRole('combobox')).toHaveValue('/');

    await page.keyboard.press('ControlOrMeta+k');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('backdrop click closes the palette', async ({ page }) => {
    await signInIfNeeded(page, '/databases');
    await waitForHydratedPalette(page);

    const dialog = paletteDialog(page);
    await paletteTrigger(page).click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(dialog).toBeHidden();
  });
});
