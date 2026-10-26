import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

const E2E_USERNAME = process.env.E2E_USERNAME;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

async function openShowcase(page: Page): Promise<void> {
  await page.goto('/dev/components', { waitUntil: 'networkidle' });

  if (page.url().includes('/auth/login')) {
    if (!E2E_USERNAME || !E2E_PASSWORD) {
      test.skip(true, 'AUTH is required. Set E2E_USERNAME and E2E_PASSWORD to run auth-gated UI e2e tests.');
    }
    await page.getByRole('textbox', { name: 'Username' }).fill(E2E_USERNAME!);
    await page.getByLabel('Password').fill(E2E_PASSWORD!);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/auth/'));
    await page.goto('/dev/components', { waitUntil: 'networkidle' });
  }

  if (!page.url().includes('/dev/components')) {
    test.skip(true, '/dev/components is only available on the dev channel (VITE_CHANNEL=dev).');
  }
}

async function criticalViolations(page: Page, selector: string) {
  const results = await new AxeBuilder({ page }).include(selector).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'critical')
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
}

test.describe('keyboard-accessible overlays', () => {
  test('dropdown opens, navigates and closes with the keyboard', async ({ page }) => {
    await openShowcase(page);
    const card = page.locator('[data-component="Dropdown"]');
    const trigger = card.getByRole('button', { name: 'Dropdown examples' });

    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.focus();
    await page.keyboard.press('Enter');

    const menu = card.getByRole('menu', { name: 'Dropdown examples' });
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('menuitem', { name: 'Normal item' })).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Selected item' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitem', { name: 'Danger item' })).toBeFocused();

    expect(await criticalViolations(page, '[data-component="Dropdown"]')).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('modal traps focus and restores it to the trigger', async ({ page }) => {
    await openShowcase(page);
    const card = page.locator('[data-component="Modal"]');
    const trigger = card.getByRole('button', { name: 'Open Modal', exact: true });

    await trigger.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Confirm Action' });
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);

    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }

    expect(await criticalViolations(page, '[role="dialog"]')).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('info modal traps focus and restores it to the trigger', async ({ page }) => {
    await openShowcase(page);
    const card = page.locator('[data-component="Modal"]');
    const trigger = card.getByRole('button', { name: 'Open Info Modal' });

    await trigger.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'About Profiles' });
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);

    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('Modal and Dropdown showcase cards have no critical axe violations', async ({ page }) => {
    await openShowcase(page);
    expect(await criticalViolations(page, '[data-component="Modal"]')).toEqual([]);
    expect(await criticalViolations(page, '[data-component="Dropdown"]')).toEqual([]);
  });

  test('choosing a menu item with the keyboard closes the menu and returns focus', async ({ page }) => {
    await openShowcase(page);
    const card = page.locator('[data-component="Dropdown"]');
    const trigger = card.getByRole('button', { name: 'Dropdown examples' });

    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = card.getByRole('menu', { name: 'Dropdown examples' });
    await expect(menu.getByRole('menuitem', { name: 'Normal item' })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('a form inside a dialog popup stays open while it is used with the mouse', async ({ page }) => {
    await openShowcase(page);
    const card = page.locator('[data-component="Dropdown"]');
    const trigger = card.getByRole('button', { name: 'Dialog popup example' });
    await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');

    await trigger.click();
    const popup = card.getByRole('dialog', { name: 'Dialog popup example' });
    await expect(popup).toBeVisible();

    await popup.getByLabel('Profile name').fill('Keyboard first');
    await popup.getByRole('button', { name: 'Save' }).click();

    await expect(popup).toBeVisible();
    await expect(popup.getByText('Saved: Keyboard first')).toBeVisible();
    expect(await criticalViolations(page, '[data-component="Dropdown"]')).toEqual([]);
  });

  test('a dropdown select listbox is keyboard operable with no critical violations', async ({ page }) => {
    await openShowcase(page);
    const card = page.locator('[data-component="Dropdown"]');
    const trigger = card.locator('button[aria-haspopup="listbox"]').first();

    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(card.getByRole('listbox')).toBeVisible();
    expect(await criticalViolations(page, '[data-component="Dropdown"]')).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
