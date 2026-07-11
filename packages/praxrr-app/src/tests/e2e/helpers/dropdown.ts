/**
 * Helper for interacting with DropdownSelect components.
 * These render a Button showing the current value; clicking opens a list of options.
 */
import type { Page, Locator } from '@playwright/test';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Select a value from a DropdownSelect component.
 * @param scope - A locator scoped to the dropdown's container (e.g., a section with label text)
 * @param optionLabel - The visible label of the option to select
 */
export async function selectDropdownOption(scope: Locator, optionLabel: string): Promise<void> {
  const trigger = scope.locator('div.relative').first().getByRole('button').first();
  await trigger.waitFor({ state: 'visible', timeout: 10_000 });
  await trigger.click();

  const exactOption = scope.getByRole('button', { name: optionLabel, exact: true });
  if ((await exactOption.count()) > 0) {
    await exactOption.first().waitFor({ state: 'visible', timeout: 10_000 });
    await exactOption.first().click();
    return;
  }

  const escaped = escapeRegExp(optionLabel);
  const fuzzyOption = scope.getByRole('button', { name: new RegExp(`^\\s*${escaped}\\s*$`) });
  await fuzzyOption.first().waitFor({ state: 'visible', timeout: 10_000 });
  await fuzzyOption.first().click();
}

/**
 * Select a dropdown by its section label text.
 * Finds the nearest .space-y-2 container that has the label, then picks the option.
 */
export async function selectDropdownByLabel(page: Page, sectionLabel: string, optionLabel: string): Promise<void> {
  const sectionPattern = new RegExp(`\\b${escapeRegExp(sectionLabel)}\\b`, 'i');
  const section = page.locator('div.space-y-2').filter({ hasText: sectionPattern }).first();
  await section.waitFor({ state: 'visible', timeout: 10_000 });

  await selectDropdownOption(section, optionLabel);
}

/**
 * Select a value from a SearchDropdown component.
 */
export async function selectSearchDropdownOption(
  scope: Locator,
  placeholder: string,
  optionLabel: string
): Promise<void> {
  const input = scope.getByPlaceholder(placeholder);
  await input.click();
  await input.fill('');
  await input.fill(optionLabel);

  const optionButtons = scope.locator('div.absolute').getByRole('button');
  await optionButtons.first().waitFor({ state: 'visible', timeout: 10_000 });

  const escaped = escapeRegExp(optionLabel);
  const prefixMatch = optionButtons.filter({
    hasText: new RegExp(`^${escaped}`),
  });

  if ((await prefixMatch.count()) > 0) {
    await prefixMatch.first().click();
    return;
  }

  await optionButtons.first().click();
}
