# Technical Specifications: radarr-pull-resources (Second Pass)

## Executive Summary

The architecture remains preview -> execute, but execute must support optional `selections` and generate a server-side default import-all plan when selections are absent. This preserves existing dedup/conflict behavior while adding optional user control before write-back. The highest-impact technical risks are preview/execute drift, dependency ordering (CF before QP), and correct handling of Radarr-specific fields in a shared Arr pull pipeline.

## Architecture Approach

- Add/maintain pull orchestration module (`$pull/`) parallel to `$sync/`.
- Keep two endpoints:
  - `POST /api/v1/arr/pull/preview`
  - `POST /api/v1/arr/pull/execute`
- Execute behavior:
  - with `selections` present and non-empty: honor explicit choices
  - with `selections` present but empty array: execute as an explicit "import none" (no changes applied)
  - with `selections` omitted: import-all from preview snapshot (server-side default plan)
- Reuse existing Arr client factory and PCD writer pipeline.

## Data Model Implications

### Core

- No required schema additions for MVP; existing `pcd_ops` pipeline is sufficient.
- Existing Radarr targets are reused:
  - `radarr_quality_definitions`
  - `radarr_naming`
  - `radarr_media_settings`
- Quality profile language data must be preserved in the quality-profile target representation.

### Migration Considerations

- If adding provenance source (`'pull'`) to `pcd_ops.source`, include migration.
- If deferring provenance type, store pull metadata in operation metadata only.
- Optional/deferred: add `arr_pull_history` table for audit/history after core pull behavior lands.

## API Design Considerations

### Preview

Request:

```json
{
  "instanceId": 1,
  "databaseId": 1,
  "resourceTypes": [
    "customFormats",
    "qualityProfiles",
    "delayProfiles",
    "qualityDefinitions"
  ]
}
```

Response includes categorized items with status and dependency warnings.

### Execute (updated contract)

Request (explicit mode):

```json
{
  "instanceId": 1,
  "databaseId": 1,
  "previewId": "pvw_123",
  "selections": {
    "customFormats": [{ "name": "x265 (HD)", "action": "import" }],
    "qualityProfiles": [{ "name": "HD-1080p", "action": "import" }],
    "delayProfiles": [
      { "arrId": 1, "pcdName": "Imported - Prefer Usenet", "action": "import" }
    ],
    "qualityDefinitions": [
      { "pcdConfigName": "Imported QD", "action": "import" }
    ]
  }
}
```

Request (implicit import-all mode): `selections` is **omitted** (property absent):

```json
{
  "instanceId": 1,
  "databaseId": 1,
  "previewId": "pvw_123"
}
```

**Empty vs omitted (client contract):** To avoid ambiguity for clients that send `selections: {}` or per-category empty arrays (e.g. `customFormats: []`), the server MUST treat **empty** the same as **omitted**:

- **Omitted:** `selections` property absent → import-all (implicit mode).
- **Empty:** `selections` present but `{}`, or all category arrays empty → **same as omitted** → import-all (implicit mode).
- **Import-none** is not a valid outcome for empty payloads; if a client wants to commit without importing any resource, it must either not call execute or use explicit mode with all items set to a skip/no-import action (if supported).

This gives a single rule: “no explicit non-empty choices” ⇒ import-all.

Behavior in implicit mode:

- all previewed resources are treated as selected
- existing dedup/conflict detection still applies
- conflicts follow default policy (`skip` recommended for v1)

## System Constraints

- Performance: batch writes and minimize cache recompiles during execute.
- Consistency: require preview snapshot identifier/hash on execute.
- Dependency order: ensure CF writes complete before QP scoring writes.
- Compatibility: prioritize Radarr v6 behavior via `/api/v3` paths.
- Radarr-specific correctness:
  - preserve quality-profile language field
  - preserve `quality_modifier` conditions with `arr_type='radarr'`
  - map naming/media settings to Radarr-specific PCD entity targets

## File-Level Impact Preview

### Likely Create

- `packages/praxrr-app/src/lib/server/pull/processor.ts`
- `packages/praxrr-app/src/lib/server/pull/types.ts`
- `packages/praxrr-app/src/lib/server/pull/conflicts.ts`
- `packages/praxrr-app/src/routes/api/v1/arr/pull/preview/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/arr/pull/execute/+server.ts`
- `packages/praxrr-app/src/routes/arr/[id]/pull/+page.server.ts`
- `packages/praxrr-app/src/routes/arr/[id]/pull/+page.svelte`

### Likely Modify

- `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts` (batch/deferred compile path)
- `packages/praxrr-app/src/lib/server/sync/mappings.ts` (reverse lookup exports as needed)
- `packages/praxrr-app/src/routes/arr/[id]/+layout.svelte` (Import/Pull tab)

## Second-pass Corrections

1. Updated execute contract to make `selections` optional.
2. Removed contradiction between "no new tables required" and mandatory history-table wording by making history optional/deferred.
3. Aligned technical flow with requirement: no-selection path imports all and still runs normal dedup/conflict checks.
4. Normalized payload identifier guidance to shared `arrId` for delay profiles.
