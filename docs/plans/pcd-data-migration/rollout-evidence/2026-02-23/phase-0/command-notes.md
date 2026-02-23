# Command Notes

Runtime gate captured with:

- `PRAXRR_DEFAULT_DB_BRANCH=feat/pcd-data-migration-2 PRAXRR_PCD_MIGRATION_MODE=hybrid PRAXRR_PCD_MIGRATION_ALLOW_LEGACY_FALLBACK=false deno task dev:noauth-with-arr`
- Manual sync action POSTs to `/arr/{id}/sync?/{action}` with `Content-Type: application/x-www-form-urlencoded`.
- Database evidence read from `dist/dev/data/praxrr.db` using `sqlite3 -readonly`.
