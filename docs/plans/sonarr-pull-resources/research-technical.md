# Technical Specifications: sonarr-pull-resources (Second Pass)

## Executive Summary

The architecture remains preview -> execute, but `execute` must support optional `selections` and generate a server-side default import-all plan when selections are absent. This preserves existing dedup/conflict behavior while adding optional user control before write-back. The highest-impact technical risks are preview/execute drift, dependency ordering (CF before QP), and write performance during large imports.

## Architecture Approach

- Add/maintain pull orchestration module (`$pull/`) parallel to `$sync/`.
- Keep two endpoints:
  - `POST /api/v1/arr/pull/preview`
  - `POST /api/v1/arr/pull/execute`
- Execute behavior:
  - with `selections`: honor explicit choices
  - without `selections`: import-all from preview snapshot
- Reuse existing Arr client and PCD writer pipeline.

## Data Model Implications

### Core

- No required schema additions for MVP; existing `pcd_ops` pipeline is sufficient.
- Optional/deferred: add `arr_pull_history` table for audit/history after core pull behavior lands.

### Migration Considerations

- If adding provenance source (`'pull'`) to `pcd_ops.source`, include migration.
- If deferring provenance type, store pull metadata in op metadata only.

## API Design Considerations

### Preview

Request:

```json
{
  "instanceId": 1,
  "databaseId": 1,
  "resourceTypes": ["customFormats", "qualityProfiles", "delayProfiles", "qualityDefinitions"]
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
    "delayProfiles": [{ "sonarrId": 1, "pcdName": "Imported - Prefer Usenet", "action": "import" }],
    "qualityDefinitions": [{ "pcdConfigName": "Imported QD", "action": "import" }]
  }
}
```

Request (implicit import-all mode):

```json
{
  "instanceId": 1,
  "databaseId": 1,
  "previewId": "pvw_123"
}
```

Behavior in implicit mode:

- all previewed resources are treated as selected
- existing dedup/conflict detection still applies
- conflicts follow default policy (`skip` recommended for v1)

## System Constraints

- Performance: batch writes and minimize cache recompiles during execute.
- Consistency: require preview snapshot identifier/hash on execute.
- Dependency order: ensure CF writes complete before QP scoring writes.
- Compatibility: prioritize Sonarr v4 behavior via `/api/v3` paths.

## File-Level Impact Preview

### Likely Create

- `src/lib/server/pull/processor.ts`
- `src/lib/server/pull/types.ts`
- `src/lib/server/pull/conflicts.ts`
- `src/routes/api/v1/arr/pull/preview/+server.ts`
- `src/routes/api/v1/arr/pull/execute/+server.ts`
- `src/routes/arr/[id]/pull/+page.server.ts`
- `src/routes/arr/[id]/pull/+page.svelte`

### Likely Modify

- `src/lib/server/pcd/ops/writer.ts` (batch/deferred compile path)
- `src/lib/server/sync/mappings.ts` (reverse lookup exports as needed)
- `src/routes/arr/[id]/+layout.svelte` (Import/Pull tab)

## Second-pass Corrections

1. Updated execute contract to make `selections` optional.
2. Removed contradiction between “no new tables required” and mandatory history table by making history explicitly deferred/optional.
3. Aligned technical flow with user requirement: no-selection path imports all and still runs normal dedup/conflict checks.
