# UX Researcher — pcd-export-import-atomicity

## UX Design

Internal change — no UX transformation. No routes, components, modals, or alert copy change. Scope is server-only: `export_batch` flag, orphan exclusion on import, atomic import rollback.

One behavioral change users notice: exported ops stop silently reappearing as drafts (or vanishing) after the next sync/restart. What "Exported and pushed N ops" said is now true. Failed syncs also stop leaving stale/partial config in the app — the pull result stays the same error (`Base op import failed: <reason>`), but the pre-sync state is now actually what the user sees afterward.

| Flow                  | Before                                                                                                   | After                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Export (YAN-463)      | Success toast "Exported and pushed N ops", then published ops revert to drafts after next import/restart | Same toast; ops stay `published`; `export_batch` flag prevents import from resurrecting them           |
| Import fail (YAN-466) | `Base op import failed` in logs; DB left hybrid (orphaned ops visible in UI, wrong config served)        | Same error string; transaction rolls back — UI shows exactly the pre-sync state                        |
| Interaction changes   | —                                                                                                        | None. No new buttons, alerts, modals, or routes. Changes page, preview modal, and StatusCard untouched |
