export const LOCALLY_MODIFIED_LABEL = 'Locally modified';

export const LOCALLY_MODIFIED_TITLE = 'Differs from the upstream (base) layer; see the Local overrides tab';

// Same classes as Badge (variant="warning", size="sm") plus the lucide "pencil" icon at 10px.
const LOCALLY_MODIFIED_BADGE_HTML =
  `<span title="${LOCALLY_MODIFIED_TITLE}" class="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">` +
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>' +
  `${LOCALLY_MODIFIED_LABEL}</span>`;

/** Static pill markup for Table `{html}` cells. Contains no interpolated user input. */
export function locallyModifiedBadgeHtml(): string {
  return LOCALLY_MODIFIED_BADGE_HTML;
}
