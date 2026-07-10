import { assert, assertMatch, assertStringIncludes } from '@std/assert';

const DETAIL_PAGE_PATH = '../../routes/canary/[id]/+page.svelte';

async function readDetailPage(): Promise<string> {
  return await Deno.readTextFile(new URL(DETAIL_PAGE_PATH, import.meta.url));
}

function normalizeWhitespace(source: string): string {
  return source.replace(/\s+/g, ' ');
}

function findButton(page: string, marker: string): string {
  const button = (page.match(/<button[\s\S]*?<\/button>/g) ?? []).find((block) => block.includes(marker));
  assert(button, `expected a button containing ${marker}`);
  return button;
}

Deno.test(
  'canary detail renders all remaining-preview evidence branches separately from confirmed results',
  async () => {
    const page = await readDetailPage();
    const prose = normalizeWhitespace(page);

    assertStringIncludes(page, "remainingPreview.availability === 'available'");
    assertStringIncludes(page, "hasPlannedChanges ? 'Available · Changes planned' : 'Available · No changes'");
    assertStringIncludes(page, 'Remaining preview unavailable');
    assertStringIncludes(prose, 'No changes are currently planned.');

    assertStringIncludes(prose, 'Confirmed canary sections');
    assertStringIncludes(prose, 'Actual results recorded when the canary sync ran.');
    assertStringIncludes(prose, 'These are separate from the planned remaining-target preview.');
    assertStringIncludes(prose, 'These are planned changes, not confirmed outcomes.');
  }
);

Deno.test(
  'canary unavailable evidence renders only safe reason and recovery fields with incomplete labeling',
  async () => {
    const page = await readDetailPage();
    const prose = normalizeWhitespace(page);

    assertStringIncludes(page, '{remainingPreview.failure.message}');
    assertStringIncludes(prose, '<strong>Recovery:</strong> {remainingPreview.failure.recoveryAction}');
    assertStringIncludes(prose, 'Incomplete preview details');
    assertStringIncludes(prose, 'These diagnostic pieces are incomplete and cannot authorize rollout.');
    assertStringIncludes(prose, 'No remaining-target changes can be authorized from incomplete evidence.');
  }
);

Deno.test('canary verification gate disables Proceed accessibly while unavailable but keeps Abort usable', async () => {
  const page = await readDetailPage();
  const prose = normalizeWhitespace(page);
  const proceedButton = findButton(page, 'proceedOpen = true');
  const abortButton = findButton(page, 'abortOpen = true');

  assertStringIncludes(proceedButton, 'disabled={submitting || !previewAvailable}');
  assertStringIncludes(proceedButton, "aria-describedby={!previewAvailable ? 'proceed-disabled-reason' : undefined}");
  assertStringIncludes(proceedButton, 'onclick={() => (proceedOpen = true)}');
  assert(!proceedButton.includes('on:click'), 'Proceed must use the Svelte 5 onclick handler');
  assertStringIncludes(page, 'id="proceed-disabled-reason"');
  assertStringIncludes(prose, 'Proceed is disabled until a complete remaining-target preview is available.');

  assertStringIncludes(abortButton, 'disabled={submitting}');
  assertStringIncludes(abortButton, 'onclick={() => (abortOpen = true)}');
  assert(!abortButton.includes('on:click'), 'Abort must use the Svelte 5 onclick handler');
  assert(!abortButton.includes('!previewAvailable'), 'Abort must not depend on preview availability');
  assertMatch(abortButton, /Aborting…[\s\S]*Abort rollout/);

  assertStringIncludes(prose, 'aborting only spares the remaining instances, it does not revert');
  assertStringIncludes(prose, 'The confirmed canary changes are already applied and are not rolled back.');
  assertStringIncludes(prose, 'Remaining instances will not be touched.');
});
