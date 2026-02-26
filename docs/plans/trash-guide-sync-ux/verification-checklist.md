# TRaSH Guide Sync UX Verification Checklist

## Scope
This checklist verifies Task 3.4 coverage for source-aware listing UX and Arr sync integration guardrails
defined in `docs/plans/trash-guide-sync-ux/feature-spec.md`.

## Command Gates
- [ ] `deno task check`
- [ ] `deno task test`
- [ ] `deno task test packages/praxrr-app/src/tests/routes/trashGuideSources.test.ts`
- [ ] `deno task test packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts`
- [ ] `deno task test packages/praxrr-app/src/tests/base/trashGuideSyncUxFlows.test.ts`

## Feature-Spec Criteria Mapping
| Feature-Spec Criterion | Required Verification |
| --- | --- |
| "All Sources" tab and source-filter visibility rules | Assert `sourceContext.showAllSourcesTab` toggles only when `availableSources.length >= 2` for custom formats and quality profiles loaders. |
| Source filter behavior and persistence | Assert page contracts keep stable localStorage keys and persistence write paths for both listing pages. |
| Source badge provenance indicators | Assert badge visibility is wired to `sourceContext.showAllSourcesTab` and passed to table/card views on both listing pages. |
| Empty and zero-result UX states | Assert source-filtered zero-result copy and clear-action affordances remain present, including TRaSH sync filtered-empty and no-sources states. |
| No regression in existing navigation/scope behavior | Assert Arr navigation remains visible across scopes while feature-gated items (for example metadata profiles) stay scope-filtered. |

## Manual UI Verification
### Source Filter Persistence
- [ ] Open `/custom-formats/<databaseId>`, select a subset of sources in the source filter, refresh, and confirm the same subset remains selected.
- [ ] Open `/quality-profiles/<databaseId>`, select a subset of sources, navigate away and back, and confirm selection persists.
- [ ] Confirm single-source scenarios disable source filtering with the expected disabled reason text.

### All Sources and Empty States
- [ ] With 2+ available sources, confirm source badges render in both table and card views.
- [ ] With only one available source, confirm source badges are hidden and "all sources" affordance is not shown.
- [ ] Apply source filters that exclude all results and confirm empty-state copy appears with the clear-filter affordance.
- [ ] On `/arr/<id>/sync`, apply a source filter with no matches in the TRaSH section and confirm the filtered-empty message and clear button.

### Dedupe Conflict Messaging
- [ ] Trigger `syncTrashGuideSource` twice for the same source while the first run is active.
- [ ] Confirm the second action surfaces the 409 conflict message: `TRaSH sync is already running for this source`.
- [ ] Confirm the first run metadata remains visible and no duplicate job is created.
