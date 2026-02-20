# External API Research: sync-preview-dry-run

## Executive Summary

The sync-preview feature requires no new external API integrations -- all necessary endpoints are already wired in Praxrr's `BaseArrClient`. The critical path is: (1) fetch current state from each Arr instance via existing GET endpoints, (2) compute a structured diff against the PCD-compiled desired state using a lightweight diff library, and (3) present the result in a Terraform-plan-style format before optional execution. The recommended diff library is **microdiff** (already Deno-native, <1kb, zero deps) for core comparison, with **json-diff-ts** as a strong alternative if key-based array matching proves necessary for quality profile item arrays.

## Primary APIs

### Radarr API (v3)

- **Documentation**: https://radarr.video/docs/api/
- **OpenAPI Spec**: https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json
- **Authentication**: `X-Api-Key` header on all requests

**Confidence**: High -- verified against OpenAPI spec and Praxrr's existing `BaseArrClient` implementation.

#### Key Endpoints for State Comparison

| Endpoint | Method | Purpose | Response Shape |
|---|---|---|---|
| `/api/v3/customformat` | GET | List all custom formats | `ArrCustomFormat[]` -- `{ id, name, includeCustomFormatWhenRenaming, specifications: [{ name, implementation, negate, required, fields: [{ name, value }] }] }` |
| `/api/v3/qualityprofile` | GET | List all quality profiles | `RadarrQualityProfile[]` -- `{ id, name, upgradeAllowed, cutoff, cutoffFormatScore, minFormatScore, formatItems: [{ format, name, score }], items: [{ quality, items, allowed }] }` |
| `/api/v3/qualitydefinition` | GET | List all quality size limits | `ArrQualityDefinition[]` -- `{ id, quality: { id, name }, title, weight, minSize, maxSize, preferredSize }` |
| `/api/v3/delayprofile` | GET | List all delay profiles | `ArrDelayProfile[]` -- `{ id, enableUsenet, enableTorrent, preferredProtocol, usenetDelay, torrentDelay, bypassIfHighestQuality, bypassIfAboveCustomFormatScore, minimumCustomFormatScore, order, tags }` |
| `/api/v3/config/mediamanagement` | GET | Media management config | `ArrMediaManagementConfig` -- `{ id, downloadPropersAndRepacks, enableMediaInfo, ... }` |
| `/api/v3/config/naming` | GET | Naming convention config | `RadarrNamingConfig` -- `{ id, renameMovies, replaceIllegalCharacters, colonReplacementFormat, standardMovieFormat, movieFolderFormat }` |
| `/api/v3/tag` | GET | List all tags | `ArrTag[]` -- `{ id, label }` |

#### Write Endpoints (for apply phase)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/v3/customformat` | POST | Create custom format |
| `/api/v3/customformat/{id}` | PUT | Update custom format |
| `/api/v3/customformat/{id}` | DELETE | Delete custom format |
| `/api/v3/customformat/bulk` | PUT/DELETE | Bulk create/delete |
| `/api/v3/qualityprofile` | POST | Create quality profile |
| `/api/v3/qualityprofile/{id}` | PUT | Update quality profile |
| `/api/v3/qualityprofile/{id}` | DELETE | Delete quality profile |
| `/api/v3/delayprofile` | POST | Create delay profile |
| `/api/v3/delayprofile/{id}` | PUT | Update delay profile |
| `/api/v3/delayprofile/{id}` | DELETE | Delete delay profile |
| `/api/v3/config/mediamanagement/{id}` | PUT | Update media management |
| `/api/v3/config/naming/{id}` | PUT | Update naming config |

**Confidence**: High -- all endpoints are already implemented in `packages/praxrr-app/src/lib/server/utils/arr/base.ts`.

#### Rate Limits / Performance Considerations

- Arr applications do **not** implement explicit rate limiting on their local REST APIs. They are designed to be accessed from local network tools.
- However, fetching large custom format lists or quality profiles involves serializing significant nested data. The `/customformat` response can be large if an instance has 100+ custom formats with deeply nested specifications.
- Praxrr already uses a concurrency limit of 3 for parallel instance processing (see `CONCURRENCY_LIMIT` in `processor.ts`). For preview generation, fetching current state from multiple instances can be parallelized per-instance with `Promise.all` on the GET endpoints within a single instance.
- Estimated round-trip for full state fetch per instance: 4-6 GET requests, typically completing in <500ms on LAN.

**Confidence**: Medium -- based on community reports and practical usage. No official rate limit documentation exists for local Arr APIs.

---

### Sonarr API (v3)

- **Documentation**: https://sonarr.tv/docs/api/
- **OpenAPI Spec**: https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/Sonarr.Api.V3/openapi.json
- **Authentication**: `X-Api-Key` header
- **API Version Note**: Sonarr v4 uses the same v3 API prefix. A v5 branch exists in development but is not yet released.

**Confidence**: High -- verified against OpenAPI spec.

#### Key Endpoints for State Comparison

| Endpoint | Method | Purpose | Response Shape |
|---|---|---|---|
| `/api/v3/customformat` | GET | List all custom formats | Same schema as Radarr `ArrCustomFormat[]` |
| `/api/v3/qualityprofile` | GET | List all quality profiles | Same schema as Radarr `RadarrQualityProfile[]` (Praxrr already reuses the type) |
| `/api/v3/qualitydefinition` | GET | List all quality definitions | Same schema as Radarr `ArrQualityDefinition[]` |
| `/api/v3/releaseprofile` | GET | List release profiles (deprecated in v4) | `ReleaseProfileResource[]` -- `{ id, enabled, required, ignored, preferred, tags, indexerId }` |
| `/api/v3/delayprofile` | GET | List delay profiles | Same schema as Radarr `ArrDelayProfile[]` |
| `/api/v3/config/mediamanagement` | GET | Media management config | `ArrMediaManagementConfig` |
| `/api/v3/config/naming` | GET | Naming config | `SonarrNamingConfig` -- includes `multiEpisodeStyle`, `standardEpisodeFormat`, `dailyEpisodeFormat`, `animeEpisodeFormat`, `seriesFolderFormat`, `seasonFolderFormat` |

#### Sonarr-Specific Notes

- **Release profiles** are deprecated in Sonarr v4 in favor of custom formats. The API endpoint still exists but is marked deprecated in the OpenAPI spec. Praxrr should handle both for backward compatibility.
- Sonarr v4 replaced Preferred Words with Custom Formats during migration. The `colonReplacementFormat` field in naming config is an integer (not a string like Radarr).
- Sonarr's `qualityprofile` response shape is identical to Radarr's for diff purposes.

**Confidence**: High -- verified against OpenAPI spec and Praxrr type definitions.

---

### Lidarr API (v1)

- **Documentation**: https://lidarr.audio/docs/api/
- **OpenAPI Spec**: https://raw.githubusercontent.com/lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json
- **Authentication**: `X-Api-Key` header
- **API Version**: v1 (not v3 like Radarr/Sonarr) -- Praxrr's `LidarrClient` already overrides `apiVersion = 'v1'`

**Confidence**: High -- verified against OpenAPI spec and Praxrr's `LidarrClient`.

#### Key Endpoints for State Comparison

| Endpoint | Method | Purpose | Response Shape |
|---|---|---|---|
| `/api/v1/customformat` | GET | List all custom formats | `CustomFormatResource[]` -- same schema as Radarr/Sonarr |
| `/api/v1/qualityprofile` | GET | List quality profiles | `QualityProfileResource[]` -- `{ id, name, upgradeAllowed, cutoff, qualities: [{ id, name, source, resolution }] }` |
| `/api/v1/qualitydefinition` | GET | List quality definitions | `QualityDefinitionResource[]` |
| `/api/v1/metadataprofile` | GET | List metadata profiles | `LidarrMetadataProfile[]` -- `{ id, name, primaryAlbumTypes: [{ albumType: { id, name }, allowed }], secondaryAlbumTypes, releaseStatuses }` |
| `/api/v1/delayprofile` | GET | List delay profiles | Same schema as Radarr/Sonarr |
| `/api/v1/config/mediamanagement` | GET | Media management config | Same base schema |
| `/api/v1/config/naming` | GET | Naming config | `LidarrNamingConfig` -- `{ id, renameTracks, replaceIllegalCharacters, colonReplacementFormat, standardTrackFormat, multiDiscTrackFormat, artistFolderFormat }` |

#### Lidarr-Specific Notes

- **Metadata profiles** are unique to Lidarr (no equivalent in Radarr/Sonarr). They control which album types and release statuses are monitored. Praxrr already has full CRUD support via `LidarrClient`.
- Lidarr custom formats are a newer addition and follow the same schema as Radarr/Sonarr.
- Quality profile schema is structurally similar but may have fewer quality types (audio-focused rather than video).

**Confidence**: High -- verified against Praxrr's existing `LidarrClient` and type definitions.

---

### Cross-Arr State Fetch Summary

For preview generation, the following GET calls are needed per instance:

| Section | Radarr | Sonarr | Lidarr |
|---|---|---|---|
| Custom Formats | `/api/v3/customformat` | `/api/v3/customformat` | `/api/v1/customformat` |
| Quality Profiles | `/api/v3/qualityprofile` | `/api/v3/qualityprofile` | `/api/v1/qualityprofile` |
| Delay Profiles | `/api/v3/delayprofile` | `/api/v3/delayprofile` | `/api/v1/delayprofile` |
| Media Management | `/api/v3/config/mediamanagement` | `/api/v3/config/mediamanagement` | `/api/v1/config/mediamanagement` |
| Naming Config | `/api/v3/config/naming` | `/api/v3/config/naming` | `/api/v1/config/naming` |
| Metadata Profiles | N/A | N/A | `/api/v1/metadataprofile` |
| Tags | `/api/v3/tag` | `/api/v3/tag` | `/api/v1/tag` |

All of these are already implemented in `BaseArrClient` and `LidarrClient`. No new API integrations are required.

---

## Integration Patterns

### Diff / Comparison Libraries

### Recommended: microdiff

- **Repository**: https://github.com/AsyncBanana/microdiff
- **Deno Import**: `import diff from "https://deno.land/x/microdiff@v1.3.1/index.ts"`
- **npm**: `microdiff` (also usable via `npm:microdiff` in Deno)
- **Size**: <1kb minified, zero dependencies
- **TypeScript**: Full built-in type support
- **License**: MIT

**Confidence**: High -- library is actively maintained, has Deno-native distribution on deno.land/x, and has 3.4k+ GitHub stars.

#### API

```typescript
import diff from 'microdiff';

const changes = diff(oldObject, newObject, { cyclesFix: false });
// cyclesFix: false is safe for parsed JSON (no circular refs) and gives ~49% speedup
```

#### Output Format

```typescript
interface Difference {
  type: 'CREATE' | 'REMOVE' | 'CHANGE';
  path: (string | number)[];
  value?: unknown;      // present on CREATE, CHANGE
  oldValue?: unknown;   // present on CHANGE, REMOVE
}
```

**Example output:**
```typescript
// CREATE: new property added
{ type: 'CREATE', path: ['specifications', 2], value: { name: 'NewSpec', ... } }

// CHANGE: existing value modified
{ type: 'CHANGE', path: ['cutoffFormatScore'], value: 2000, oldValue: 1500 }

// REMOVE: property deleted
{ type: 'REMOVE', path: ['formatItems', 3], oldValue: { format: 5, name: 'OldFormat', score: 100 } }
```

#### Why microdiff for Praxrr

- Deno-native: first-class `deno.land/x` distribution, no npm shim needed
- Minimal footprint: <1kb is negligible in bundle size
- Output format maps directly to Terraform-style actions (`CREATE` -> `create`, `CHANGE` -> `update`, `REMOVE` -> `delete`)
- Path arrays naturally describe nested changes in quality profiles (`['items', 0, 'allowed']`)
- `cyclesFix: false` optimization is safe because all data comes from JSON API responses (guaranteed acyclic)

#### Limitation

microdiff does not support key-based array matching. Arrays are compared by index. For quality profile `items` and `formatItems` arrays, this means reordering would show as multiple changes rather than a move. This is acceptable because:
1. Praxrr controls the desired state ordering
2. Arr instances preserve insertion order
3. For the diff preview use case, showing exact positional changes is more accurate than inferring moves

---

### Alternative: json-diff-ts

- **Repository**: https://github.com/ltwlf/json-diff-ts
- **Deno Import**: `import { diff } from 'npm:json-diff-ts'`
- **Size**: ~15kb, zero dependencies
- **TypeScript**: Full support
- **License**: MIT

**Confidence**: High -- actively maintained, 95%+ test coverage, compatible with Deno via npm specifier.

#### API

```typescript
import { diff, applyChangeset, revertChangeset, atomizeChangeset } from 'json-diff-ts';

const changeset: IChange[] = diff(oldObject, newObject, {
  embeddedObjKeys: { formatItems: 'name', items: 'name' }
});
```

#### Output Format

```typescript
interface IChange {
  type: 'ADD' | 'UPDATE' | 'REMOVE';
  key: string;
  value?: unknown;
  oldValue?: unknown;
  changes?: IChange[];      // nested changes for objects
  embeddedKey?: string;      // array element identifier
}
```

#### Key Feature: embeddedObjKeys

The `embeddedObjKeys` option enables matching array elements by a named key field rather than index position. This is valuable for quality profile `formatItems` where items should be matched by `name` rather than array position:

```typescript
const changeset = diff(currentProfile, desiredProfile, {
  embeddedObjKeys: {
    formatItems: 'name',     // match format items by name
    items: 'name',           // match quality items by name
    specifications: 'name',  // match CF specifications by name
  }
});
```

#### Atomic Changeset Feature

```typescript
const atomic = atomizeChangeset(changeset);
// Each change gets a JSONPath: "$.formatItems[?(@.name=='HDR10+')].score"
// Useful for per-field confirmation UI
```

#### When to Prefer json-diff-ts Over microdiff

- If quality profile format items are frequently reordered between PCD and Arr state
- If per-field JSONPath descriptions are needed in the preview UI
- If the `applyChangeset` / `revertChangeset` functions are useful for implementing undo or partial apply

---

### Other Libraries Evaluated

| Library | Size | Deno | Key Differentiator | Verdict |
|---|---|---|---|---|
| **jsondiffpatch** | ~16kb gzipped | Via npm: specifier | Rich HTML/console formatters, RFC 6902 output | Over-engineered for this use case. Delta format is compact but hard to map to plan-style output. |
| **deep-object-diff** | ~2kb | Via npm: specifier | Returns plain diff objects | No type/action information (only shows new values, not what changed). Insufficient for preview. |
| **@opentf/obj-diff** | ~3kb | Via JSR | JSR-native, supports Map/Set | Good but less mature. Output uses numeric type codes (`t: 0/1/2`) which are less readable. |
| **deep-diff** (fry69 fork) | ~5kb | TypeScript port | Mature API, supports circular refs | Good option but microdiff is faster and smaller with equivalent functionality. |

**Confidence**: High -- all libraries were evaluated for API shape, Deno compatibility, and output format suitability.

---

## IaC Precedent: Plan/Preview Output Formats

### Terraform Plan Format

- **Documentation**: https://developer.hashicorp.com/terraform/internals/json-format
- **Source**: `terraform show -json <PLAN FILE>`

**Confidence**: High -- official HashiCorp documentation.

#### Top-Level Structure

```json
{
  "format_version": "1.0",
  "applyable": true,
  "complete": true,
  "errored": false,
  "resource_changes": [...],
  "output_changes": {...},
  "prior_state": {...},
  "planned_values": {...}
}
```

#### Resource Change Entry (key pattern for Praxrr)

```json
{
  "address": "radarr_quality_profile.hd-bluray",
  "type": "radarr_quality_profile",
  "name": "HD Bluray + WEB",
  "change": {
    "actions": ["update"],
    "before": { "cutoffFormatScore": 1500, "formatItems": [...] },
    "after": { "cutoffFormatScore": 2000, "formatItems": [...] },
    "after_unknown": {},
    "before_sensitive": {},
    "after_sensitive": {}
  }
}
```

#### Key Design Decisions to Adopt

1. **`actions` array**: Supports compound actions like `["delete", "create"]` for replace operations. Praxrr should use: `"create"`, `"update"`, `"delete"`, `"no-op"`.
2. **`before`/`after` full objects**: Include the complete resource state, not just changed fields. This allows UI to show full context.
3. **`address` as stable identifier**: Use `{instanceName}/{sectionType}/{entityName}` as the resource address (e.g., `"My Radarr/qualityProfiles/HD Bluray + WEB"`).
4. **Separation of plan and apply**: Plan is a read-only operation. Apply takes the plan as input. This prevents drift between preview and execution.

#### Praxrr Adaptation

```typescript
interface SyncPlanEntry {
  address: string;                           // "instance/section/entity"
  instanceId: number;
  instanceName: string;
  sectionType: SectionType;
  entityType: 'customFormat' | 'qualityProfile' | 'delayProfile' | 'mediaManagement' | 'metadataProfile' | 'namingConfig';
  entityName: string;
  action: 'create' | 'update' | 'delete' | 'no-op';
  before: Record<string, unknown> | null;    // null for creates
  after: Record<string, unknown> | null;     // null for deletes
  fieldChanges: FieldChange[];               // microdiff output for human-readable detail
}

interface FieldChange {
  path: string;                              // dot-notation path: "cutoffFormatScore"
  type: 'added' | 'changed' | 'removed';
  oldValue?: unknown;
  newValue?: unknown;
}

interface SyncPlan {
  version: 1;
  generatedAt: string;                       // ISO 8601
  instanceId: number;
  instanceName: string;
  summary: {
    creates: number;
    updates: number;
    deletes: number;
    noOps: number;
  };
  entries: SyncPlanEntry[];
  errors: SyncPlanError[];                   // errors during plan generation
}
```

---

### ArgoCD Sync Preview Patterns

- **Documentation**: https://argo-cd.readthedocs.io/en/stable/user-guide/diffing/
- **CLI**: `argocd app diff myapp`, `argocd app sync myapp --dry-run`

**Confidence**: Medium -- ArgoCD's patterns are Kubernetes-specific but the architectural concepts transfer.

#### Key Patterns for Praxrr

1. **Desired vs. Live state comparison**: ArgoCD continuously compares Git manifests (desired) against Kubernetes cluster (live). Praxrr's equivalent: PCD cache (desired) vs. Arr instance API (live).

2. **Ignorable field annotations**: ArgoCD supports `jsonPointers` and `jqPathExpressions` to ignore specific fields during diff. Praxrr should ignore:
   - `id` fields (Arr-assigned, not in PCD desired state)
   - Computed/derived fields that Arr adds to responses
   - Fields not managed by Praxrr (e.g., quality definition `weight` if not synced)

3. **Diff strategies**: ArgoCD offers "structured merge diff" (default) and "server-side diff". For Praxrr, the equivalent decision is whether to diff against the raw Arr API response or a normalized/transformed version.

4. **`OutOfSync` detection**: ArgoCD marks resources as `OutOfSync` when diff is non-empty. Praxrr should similarly flag entities that would change during sync, even outside of an explicit preview request.

5. **Known limitation**: ArgoCD's `--dry-run` does not detect issues with new resources that don't exist yet. Praxrr's preview should explicitly flag creates as untested against Arr validation.

---

### Ansible Check/Diff Mode Patterns

- **Documentation**: https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html

**Confidence**: High -- official Ansible documentation.

#### Key Patterns for Praxrr

1. **`check_mode` flag propagation**: Ansible passes a `check_mode` boolean through the execution pipeline. Each module inspects it and either executes or reports what would happen. Praxrr should thread a `dryRun: boolean` through the syncer pipeline.

2. **Same code path**: Modules use `if not module.check_mode:` guards around mutating operations. The comparison/planning logic runs regardless. This is the key insight for preventing preview/execute drift:

   ```typescript
   // Pseudo-code for Praxrr syncer
   async syncEntity(entity, existingMap, dryRun: boolean): Promise<SyncPlanEntry> {
     const existing = existingMap.get(entity.name);
     const action = existing ? 'update' : 'create';
     const fieldChanges = existing ? diff(existing, entity) : [];

     if (!dryRun) {
       if (action === 'create') await this.client.createCustomFormat(entity);
       else await this.client.updateCustomFormat(existing.id, entity);
     }

     return { action, before: existing ?? null, after: entity, fieldChanges };
   }
   ```

3. **`--diff` output format**: Ansible diff mode shows before/after for each task:
   ```
   --- before
   +++ after
   @@ -1,3 +1,3 @@
    name: HD Bluray
   -cutoffFormatScore: 1500
   +cutoffFormatScore: 2000
    upgradeAllowed: true
   ```
   Praxrr should provide a similar human-readable diff for each entity, either as unified-diff text or as structured field-level changes.

4. **Per-task opt-in/opt-out**: Ansible allows `check_mode: true` or `check_mode: false` overrides per task. Praxrr should allow per-section-type preview (e.g., preview only quality profiles, not custom formats).

---

### Pulumi Preview

- **Documentation**: https://www.pulumi.com/docs/iac/cli/commands/pulumi_preview/

**Confidence**: Medium -- Pulumi's patterns are similar to Terraform but add TypeScript-native concepts.

#### Key Patterns for Praxrr

1. **`--save-plan` for deferred execution**: `pulumi preview --save-plan=plan.json` generates a plan file that can later be applied with `pulumi up --plan=plan.json`. Praxrr should support generating a plan object that can be stored and later applied via a separate API call.

2. **Unknown values**: Pulumi tracks values that are "unknown until apply" (e.g., server-assigned IDs). For Praxrr creates, the Arr-assigned `id` is unknown until the entity is actually created. The plan should mark these as `afterUnknown: { id: true }`.

3. **JSON output mode**: `pulumi preview --json` outputs machine-readable plan data. Praxrr's API endpoint should return the plan as JSON for programmatic consumers, while the UI renders it visually.

---

## Streaming / Progress Patterns

### SSE for Long-Running Preview Operations

Preview generation for a single instance is fast (<1s for LAN Arr instances), but multi-instance previews or slow WAN connections could take longer. SSE provides a way to stream progress updates.

**Confidence**: Medium -- patterns are well-established but Praxrr's adapter (sveltekit-adapter-deno) may need verification.

#### SvelteKit + Deno SSE Pattern

```typescript
// +server.ts (API endpoint)
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const instanceId = Number(url.searchParams.get('instanceId'));

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        send('progress', { phase: 'fetching', section: 'customFormats' });
        const cfState = await client.getCustomFormats();

        send('progress', { phase: 'fetching', section: 'qualityProfiles' });
        const qpState = await client.getQualityProfiles();

        send('progress', { phase: 'diffing', section: 'customFormats' });
        const cfPlan = computeDiff(cfDesired, cfState);

        send('progress', { phase: 'diffing', section: 'qualityProfiles' });
        const qpPlan = computeDiff(qpDesired, qpState);

        send('plan', { entries: [...cfPlan, ...qpPlan] });
        send('complete', { summary: { creates: 2, updates: 5, deletes: 0 } });
      } catch (error) {
        send('error', { message: error.message });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
};
```

```typescript
// Client-side consumption
const eventSource = new EventSource(`/api/v1/sync/preview?instanceId=${instanceId}`);

eventSource.addEventListener('progress', (e) => {
  const { phase, section } = JSON.parse(e.data);
  updateProgressUI(phase, section);
});

eventSource.addEventListener('plan', (e) => {
  const plan = JSON.parse(e.data);
  renderPlanEntries(plan.entries);
});

eventSource.addEventListener('complete', (e) => {
  const { summary } = JSON.parse(e.data);
  showSummary(summary);
  eventSource.close();
});

eventSource.addEventListener('error', (e) => {
  showError(JSON.parse(e.data).message);
  eventSource.close();
});
```

#### Alternative: Simple Request/Response

For most use cases, preview generation completes in <2 seconds. A standard POST request returning the full plan JSON may be simpler and sufficient:

```typescript
// POST /api/v1/sync/preview
// Body: { instanceId: number, sections?: SectionType[] }
// Response: SyncPlan
```

**Recommendation**: Start with the simple request/response pattern. Add SSE only if preview generation for multi-instance or WAN scenarios proves to take >3 seconds. The SSE infrastructure adds complexity (connection management, reconnection logic, error handling) that is not justified until needed.

#### sveltekit-sse Library

- **Repository**: https://github.com/razshare/sveltekit-sse
- **npm**: `sveltekit-sse`
- Provides `produce()` server-side and `source()` client-side helpers
- Handles connection lifecycle (disconnect detection, cleanup)
- Useful if SSE is adopted, but raw `ReadableStream` is sufficient and avoids an extra dependency

**Confidence**: Medium -- the library is well-maintained but adding it as a dependency should only happen if SSE is confirmed necessary.

---

## Constraints and Gotchas

### 1. Namespace Suffix Complexity

- **Impact**: Quality profiles and custom formats are synced with invisible Unicode namespace suffixes (see `getNamespaceSuffix()` in `namespace.ts`). The diff comparison must account for these suffixes when matching entities between PCD desired state and Arr live state.
- **Workaround**: Strip suffixes from Arr-side entity names before comparison, or apply suffixes to PCD-side names before diffing. The latter approach (suffix before diff) is safer because it matches the actual sync behavior.

**Confidence**: High -- this is a known complexity in the existing sync pipeline.

### 2. ID Mismatch Between PCD and Arr

- **Impact**: PCD entities do not have Arr-assigned IDs. Custom format IDs, quality profile IDs, and delay profile IDs are assigned by the Arr instance. Diffing must match entities by **name** (post-suffix), not by ID.
- **Workaround**: Build a `name -> arrEntity` lookup map from the GET response, then match each PCD entity by its suffixed name. Entities present in PCD but absent in Arr are creates. Entities present in Arr (with a Praxrr namespace suffix) but absent in PCD are deletes.

**Confidence**: High -- this is the existing sync matching logic.

### 3. Arr-Added Fields in API Responses

- **Impact**: Arr API responses include fields that Praxrr does not manage (e.g., `id`, `quality.source`, `quality.resolution` within items). A naive diff of the full response object against the desired state would show many false-positive changes.
- **Workaround**: Before diffing, normalize both sides to a common "diffable" shape that includes only Praxrr-managed fields. This is essentially the same transformation logic already in the sync pipeline's `transformToArr()` methods, but applied to both the desired and current state.

**Confidence**: High -- this is the most critical design decision for accurate previews.

### 4. Quality Profile Items Ordering

- **Impact**: Quality profile `items` arrays represent quality groups and individual qualities. The order matters for priority in Arr. If PCD and Arr have the same qualities but in different order, the diff should show this as a meaningful change.
- **Workaround**: Compare items arrays positionally (microdiff default behavior). This is correct because ordering is semantically significant for quality profiles.

**Confidence**: High -- positional comparison is the correct behavior here.

### 5. Format Item Score Changes Detection

- **Impact**: A quality profile's `formatItems` array contains `{ format: id, name: string, score: number }` entries. The `format` field is the Arr-assigned custom format ID, which changes if a custom format is deleted and recreated. Diffing by array index would miss the semantic relationship.
- **Workaround**: Use name-based matching for formatItems when diffing quality profiles. Either use json-diff-ts with `embeddedObjKeys: { formatItems: 'name' }`, or pre-sort both arrays by name before diffing with microdiff.

**Confidence**: Medium -- this requires testing with actual Arr instance data to verify edge cases.

### 6. Media Management Config Passthrough Fields

- **Impact**: `ArrMediaManagementConfig` uses `[key: string]: unknown` to preserve fields Praxrr does not manage. The diff should only show changes to Praxrr-managed fields (`downloadPropersAndRepacks`, `enableMediaInfo`), not every field in the response.
- **Workaround**: Extract only managed fields before diffing. Apply the same principle as gotcha #3.

**Confidence**: High -- straightforward field filtering.

### 7. Concurrent Sync During Preview

- **Impact**: If a sync runs while a preview is being generated (or between preview and apply), the preview becomes stale.
- **Workaround**: Include a `generatedAt` timestamp in the plan. On apply, re-fetch current state and validate that no changes occurred since preview generation. If state has drifted, reject the apply and require a fresh preview. Alternatively, use optimistic locking with an ETag-like mechanism based on the hash of the fetched state.

**Confidence**: Medium -- the stale-plan problem is common in IaC tools. Terraform solves it with plan files; Praxrr should adopt a similar approach.

### 8. Partial Apply Complexity

- **Impact**: Issue #7 mentions partial syncs (some succeed, some fail). If a user applies a preview and some entities fail, the plan state becomes inconsistent.
- **Workaround**: Apply entries sequentially within a section type. Track per-entry apply status (`pending`, `applied`, `failed`, `skipped`). Return the updated plan with statuses so the UI can show which entries succeeded and which failed. Failed entries can be retried individually.

**Confidence**: Medium -- requires careful state tracking during the apply phase.

---

## Open Questions

1. **Should preview include entities Praxrr would delete?** Currently, the sync pipeline does not delete entities from Arr instances (it only creates and updates). If delete support is added, the preview must identify Praxrr-managed entities in Arr that are no longer in PCD.

2. **Should previews be persisted?** Terraform saves plans to files. Should Praxrr save preview results to the app database for audit logging, or treat them as ephemeral? Database storage enables diff history and undo capabilities.

3. **What is the preview scope for multi-database instances?** When multiple PCD databases target the same Arr instance (with different namespace suffixes), should the preview show all databases' changes together or per-database?

4. **How should "no-op" entries be handled in the UI?** Showing all entities (including unchanged ones) provides completeness but adds noise. Terraform defaults to showing only changes, with a `--detailed-exitcode` flag for no-op visibility.

5. **Should the API support scoped previews?** E.g., preview only custom formats for a specific instance, or preview across all instances simultaneously. The issue mentions per-instance and per-entity-type scoping.

6. **Should the preview validate against Arr API constraints?** The Arr API returns 422 for invalid payloads (e.g., duplicate quality names). Should the preview attempt validation by calling a schema endpoint, or defer validation to apply time?

---

## Search Queries Executed

1. `Radarr API v3 endpoints custom format quality profile documentation 2025`
2. `Sonarr API v3 endpoints custom format quality profile release profile documentation 2025`
3. `Lidarr API v1 endpoints quality profile metadata profile documentation 2025`
4. `JavaScript TypeScript JSON deep diff comparison library Deno compatible 2025`
5. `Terraform plan output format structure JSON API design pattern`
6. `Server-Sent Events SSE Deno SvelteKit streaming long-running operations pattern`
7. `Radarr API v3 qualityprofile endpoint response schema GET list qualities customformatitems`
8. `Lidarr API v1 qualityprofile metadataprofile endpoint GET list response schema`
9. `ArgoCD sync preview diff API design pattern resource hook dry-run 2025`
10. `Ansible check mode diff mode API design pattern dry run preview changes`
11. `json-diff-ts npm library API changeset structure flatDiff atomicArrayDiff example`
12. `deep-diff npm library JavaScript TypeScript object comparison Deno compatible`
13. `SvelteKit server-sent events ReadableStream Deno streaming response implementation example 2025`
14. `Radarr Sonarr API rate limiting concurrent requests performance bulk operations`
15. `jsondiffpatch library TypeScript nested object diff human readable output Deno 2025`
16. `Pulumi preview output format diff structure plan API TypeScript`
17. `Sonarr v4 v5 API changes release profile deprecated custom format migration 2025`
18. `Servarr wiki API endpoints custom format quality profile release profile documentation`
19. `Radarr CustomFormatResource schema properties name specifications implementation negate required fields JSON`
20. `sveltekit-sse library source function produce event streaming SvelteKit server endpoint pattern`

---

## Sources

### Arr Application APIs
- [Radarr API Documentation](https://radarr.video/docs/api/)
- [Radarr OpenAPI Spec (GitHub)](https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json)
- [Radarr REST API (DeepWiki)](https://deepwiki.com/radarr/radarr/4.1-rest-api)
- [Radarr GitHub Repository](https://github.com/Radarr/Radarr)
- [Sonarr API Documentation](https://sonarr.tv/docs/api/)
- [Sonarr OpenAPI Spec (GitHub)](https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/Sonarr.Api.V3/openapi.json)
- [Sonarr v4 FAQ (Servarr Wiki)](https://wiki.servarr.com/sonarr/faq-v4)
- [Lidarr API Documentation](https://lidarr.audio/docs/api/)
- [Lidarr OpenAPI Spec (GitHub)](https://raw.githubusercontent.com/lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json)
- [Lidarr Settings (Servarr Wiki)](https://wiki.servarr.com/lidarr/settings)
- [Radarr Terraform Provider - Quality Profile](https://registry.terraform.io/providers/Fuochi/radarr/latest/docs/resources/quality_profile)
- [Radarr Terraform Provider - Custom Format](https://registry.terraform.io/providers/devopsarr/radarr/latest/docs/resources/custom_format)

### Diff/Comparison Libraries
- [microdiff - GitHub](https://github.com/AsyncBanana/microdiff)
- [microdiff - deno.land/x](https://deno.land/x/microdiff@v1.3.1)
- [json-diff-ts - GitHub](https://github.com/ltwlf/json-diff-ts)
- [json-diff-ts - npm](https://www.npmjs.com/package/json-diff-ts)
- [json-diff-ts - Deno npm](https://deno.com/npm/package/json-diff-ts)
- [jsondiffpatch - GitHub](https://github.com/benjamine/jsondiffpatch)
- [deep-object-diff - GitHub](https://github.com/mattphillips/deep-object-diff)
- [@opentf/obj-diff - JSR](https://jsr.io/@opentf/obj-diff)
- [deep-diff TypeScript port - GitHub](https://github.com/fry69/deep-diff)

### IaC Precedent / Plan Formats
- [Terraform JSON Output Format (HashiCorp)](https://developer.hashicorp.com/terraform/internals/json-format)
- [terraform-json Go Package](https://pkg.go.dev/github.com/hashicorp/terraform-json)
- [ArgoCD Diff Customization](https://argo-cd.readthedocs.io/en/stable/user-guide/diffing/)
- [ArgoCD Diff Strategies](https://argo-cd.readthedocs.io/en/stable/user-guide/diff-strategies/)
- [ArgoCD Sync Phases and Waves](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/)
- [ArgoCD Diff Preview Tool](https://github.com/dag-andersen/argocd-diff-preview)
- [Ansible Check Mode / Diff Mode](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html)
- [Pulumi Preview CLI](https://www.pulumi.com/docs/iac/cli/commands/pulumi_preview/)
- [Pulumi Update Plans](https://www.pulumi.com/docs/iac/concepts/update-plans/)

### Streaming / SSE
- [SvelteKit SSE Library](https://github.com/razshare/sveltekit-sse)
- [Building Real-time SvelteKit Apps with SSE](https://sveltetalk.com/posts/building-real-time-sveltekit-apps-with-server-sent-events)
- [SvelteKit Streaming Guide](https://khromov.se/sveltekit-streaming-the-complete-guide/)
- [SvelteKit Web Standards - Streams](https://kit.svelte.dev/docs/web-standards)
- [MDN Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
- [SvelteKit SSE Issue #887](https://github.com/sveltejs/kit/issues/887)
