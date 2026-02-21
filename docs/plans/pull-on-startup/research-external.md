# External API Research: pull-on-startup

## Executive Summary

`pull-on-startup` can be implemented against existing Arr REST contracts (Radarr/Sonarr `/api/v3/*`, Lidarr `/api/v1/*`) using API-key auth and full-list GET endpoints for managed entities. Praxrr already has most read clients in `packages/praxrr-app/src/lib/server/utils/arr/base.ts` and `packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts`, so the external API risk is mainly semantic drift and default-item handling, not endpoint availability.

Key findings for startup pull:

- Auth is API-key based (`X-Api-Key` header preferred; `apikey` query parameter also supported in OpenAPI).
- The relevant config endpoints are non-paginated list/object reads for quality profiles, custom formats, delay profiles, naming config, media management config, and Lidarr metadata profiles.
- Release profile endpoints exist in all three OpenAPI specs, but Praxrr currently has no release-profile methods in `BaseArrClient`; this is a scope and compatibility decision to make explicitly.
- OpenAPI contracts for these endpoints document success payloads well, but do not consistently document non-2xx response schemas, so startup pull should treat error payloads as loosely typed.
- There is no explicit universal `isDefault` flag for most target entities; ignoring Arr defaults requires deterministic per-entity heuristics (or persisted source metadata) rather than one generic field.

Primary sources:

- Radarr API docs: <https://radarr.video/docs/api/>
- Sonarr API docs: <https://sonarr.tv/docs/api/>
- Lidarr API docs: <https://lidarr.audio/docs/api/>
- Radarr OpenAPI: <https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json>
- Sonarr OpenAPI: <https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/Sonarr.Api.V3/openapi.json>
- Lidarr OpenAPI: <https://raw.githubusercontent.com/lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json>
- Sonarr v4 FAQ (custom format migration context): <https://wiki.servarr.com/sonarr/faq-v4>

## Primary APIs

### Authentication

Across Radarr, Sonarr, and Lidarr OpenAPI specs:

- Security schemes include:
  - `X-Api-Key` (`in: header`, preferred)
  - `apikey` (`in: query`, fallback)
- Top-level security allows either scheme.
- In practice and in Praxrr client code, header auth is already used.

### Read Endpoints Needed for Startup Pull

#### Shared core entities

| Entity                                       | Radarr                               | Sonarr                               | Lidarr                               | Notes                                                       |
| -------------------------------------------- | ------------------------------------ | ------------------------------------ | ------------------------------------ | ----------------------------------------------------------- |
| Custom formats                               | `GET /api/v3/customformat`           | `GET /api/v3/customformat`           | `GET /api/v1/customformat`           | Full list response; includes `id`, `name`, `specifications` |
| Quality profiles                             | `GET /api/v3/qualityprofile`         | `GET /api/v3/qualityprofile`         | `GET /api/v1/qualityprofile`         | Full list; includes `formatItems` score mappings            |
| Delay profiles                               | `GET /api/v3/delayprofile`           | `GET /api/v3/delayprofile`           | `GET /api/v1/delayprofile`           | Full list; default handling differs by app                  |
| Media management                             | `GET /api/v3/config/mediamanagement` | `GET /api/v3/config/mediamanagement` | `GET /api/v1/config/mediamanagement` | Single config object                                        |
| Naming config                                | `GET /api/v3/config/naming`          | `GET /api/v3/config/naming`          | `GET /api/v1/config/naming`          | Single config object; schema differs by app                 |
| Quality definitions (related mapping object) | `GET /api/v3/qualitydefinition`      | `GET /api/v3/qualitydefinition`      | `GET /api/v1/qualitydefinition`      | Useful for quality-name compatibility checks                |
| Tags (related mapping object)                | `GET /api/v3/tag`                    | `GET /api/v3/tag`                    | `GET /api/v1/tag`                    | Tag IDs may appear in profile/tag arrays                    |

#### Arr-specific entities

| Entity            | Endpoint                                                                            | App                  | Notes                                                                    |
| ----------------- | ----------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------ |
| Metadata profiles | `GET /api/v1/metadataprofile`                                                       | Lidarr               | Lidarr-only; present in Praxrr `LidarrClient`                            |
| Release profiles  | `GET /api/v3/releaseprofile` (Radarr/Sonarr), `GET /api/v1/releaseprofile` (Lidarr) | All three in OpenAPI | Not currently wired in Praxrr Arr client; explicit scope decision needed |

### Default-Item Detection Signals (for "ignore Arr defaults")

OpenAPI schemas for target resources generally do not expose a universal `isDefault` boolean. For startup pull, defaults must be detected via app/entity-specific logic:

- Delay profiles: Praxrr already treats default profile specially (`id=1` for Radarr/Sonarr; runtime resolution for Lidarr) in sync logic.
- Naming/media-management configs: singleton config resources; not list defaults.
- Quality profiles/custom formats/release profiles: no explicit default marker in published schemas; recommended approach is metadata-based ownership (Praxrr-managed marker/suffix/source) plus conservative name-based filters for known built-ins.

Confidence note: this is based on current OpenAPI contracts and Praxrr source patterns; built-in naming conventions can vary by app version and locale.

### Pagination, Limits, and Throughput

- Target pull endpoints above are list/object reads without documented pagination parameters.
- ID endpoints (e.g., `/qualityprofile/{id}`) are single-item reads only.
- No official rate-limit contract is documented in Arr API references for these resources.
- Operationally, treat startup pull as bounded fan-out with explicit timeouts and low concurrency per instance.

### Error Formats and Status Handling

OpenAPI specs for these endpoints mostly define `200` responses and do not provide consistent non-2xx schema contracts.

Implications:

- Handle HTTP status as source of truth (`401/403/404/409/422/5xx` expectations from real deployments).
- Parse error body defensively (`unknown` JSON or plain text).
- Log structured status + excerpt; avoid brittle parsing assumptions.
- Fail startup pull per-instance without blocking entire app boot unless product policy explicitly requires hard-fail.

## Libraries and SDKs

- Preferred runtime client: existing Praxrr Arr clients (`BaseArrClient`, `LidarrClient`).
- Reason: endpoints, retry behavior, and typing already align with current sync and pull architecture.
- Official vendor SDKs: none for TypeScript from Radarr/Sonarr/Lidarr maintainers.
- Viable alternative: generate a typed client from each OpenAPI contract for offline drift detection, while still keeping Praxrr runtime client as the integration boundary.

Reference URLs:

- OpenAPI Generator: <https://openapi-generator.tech/>
- Radarr OpenAPI: <https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json>
- Sonarr OpenAPI: <https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/Sonarr.Api.V3/openapi.json>
- Lidarr OpenAPI: <https://raw.githubusercontent.com/lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json>

## Integration Patterns

Recommended startup pull flow for `PULL_ON_START=true`:

1. Read enabled Arr instances from Praxrr DB.
2. For each instance, call `GET /system/status` first for connectivity and version telemetry.
3. Fetch managed resources via parallel GETs (bounded concurrency).
4. Normalize payloads into Praxrr managed shape (drop unmanaged/computed fields, preserve exact names).
5. Classify each incoming item by Praxrr ownership and match key:
   - `match`: same entity by name + metadata guard
   - `new`: Arr item not present in Praxrr DB
   - `conflict`: same name but incompatible metadata/shape
   - `default`: identified built-in/default Arr item, ignored
6. Apply safeguards before writing local ops:
   - no destructive delete during startup pull
   - no implicit cross-Arr mapping fallback
   - skip ambiguous matches (fail-fast per entity)
   - emit diagnostics for skipped defaults/conflicts
7. Persist imported state as user ops with provenance (`source=startup-pull`, timestamp, instance id).

Safeguards that matter most for this feature:

- Startup lock: single in-flight pull job per app boot.
- Timeout budget: bounded total pull time so boot does not hang indefinitely.
- Partial success policy: one failing instance should not erase successful pulls from other instances.
- Idempotency: repeated startup pulls should produce no net new ops when remote state is unchanged.

## Constraints and Gotchas

- API version split is real: Radarr/Sonarr use `/api/v3`; Lidarr uses `/api/v1`.
- Quality profile semantics are not identical across Arr apps even if endpoint names match.
- Naming config type mismatch: Radarr uses string-style colon replacement enum, Sonarr/Lidarr use numeric fields.
- Sonarr v4 shifted language/preferred-word behavior toward custom formats; scoring logic parity with Radarr should not be assumed.
- Lidarr has metadata profiles and audio-domain quality semantics; treat as first-class Lidarr-only behavior.
- OpenAPI includes release profile endpoints, but product semantics differ and Praxrr currently lacks runtime client coverage for them.
- Error payload contracts are underspecified; strict schema decoding for failures is brittle.
- Default detection lacks a universal API field; relying on names alone is risky without additional metadata.

Key risks for implementation:

- **High risk:** false-positive imports when default/built-in objects are misclassified as user-managed.
- **Medium risk:** cross-Arr semantic drift causing incorrect mapping (especially quality/profile score semantics).
- **Medium risk:** startup latency and noisy failures if one or more Arr instances are unavailable.
- **Medium risk:** silent contract drift if Sonarr v5 or future Arr versions alter payload shape/version paths.

## Code Examples

```ts
type ArrType = 'radarr' | 'sonarr' | 'lidarr';

interface ArrInstance {
  id: number;
  type: ArrType;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
}

interface PullResult {
  instanceId: number;
  imported: number;
  skippedDefaults: number;
  conflicts: number;
  errors: string[];
}

const API_VERSION: Record<ArrType, 'v3' | 'v1'> = {
  radarr: 'v3',
  sonarr: 'v3',
  lidarr: 'v1',
};

function arrUrl(instance: ArrInstance, path: string): string {
  const version = API_VERSION[instance.type];
  return `${instance.baseUrl.replace(/\/$/, '')}/api/${version}${path}`;
}

async function getJson<T>(instance: ArrInstance, path: string): Promise<T> {
  const res = await fetch(arrUrl(instance, path), {
    headers: {
      'X-Api-Key': instance.apiKey,
      Accept: 'application/json',
    },
  });

  const text = await res.text();
  const payload = text.length > 0 ? safeJson(text) : null;

  if (!res.ok) {
    const detail = typeof payload === 'string' ? payload : JSON.stringify(payload);
    throw new Error(`[${instance.type}] ${res.status} ${res.statusText}: ${detail}`);
  }

  return payload as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isDefaultDelayProfile(
  item: { id?: number; order?: number; tags?: number[] | null },
  arrType: ArrType
): boolean {
  if (arrType === 'radarr' || arrType === 'sonarr') {
    return item.id === 1;
  }
  // Lidarr default detection is less stable; keep conservative.
  return item.order === 1 && (item.tags == null || item.tags.length === 0);
}

export async function pullOnStartup(instances: ArrInstance[]): Promise<PullResult[]> {
  const enabled = instances.filter((i) => i.enabled);

  return Promise.all(
    enabled.map(async (instance): Promise<PullResult> => {
      const result: PullResult = {
        instanceId: instance.id,
        imported: 0,
        skippedDefaults: 0,
        conflicts: 0,
        errors: [],
      };

      try {
        await getJson(instance, '/system/status');

        const [customFormats, qualityProfiles, delayProfiles] = await Promise.all([
          getJson<Array<{ name: string }>>(instance, '/customformat'),
          getJson<Array<{ name: string }>>(instance, '/qualityprofile'),
          getJson<Array<{ id?: number; order?: number; tags?: number[] | null; name?: string }>>(
            instance,
            '/delayprofile'
          ),
        ]);

        for (const profile of delayProfiles) {
          if (isDefaultDelayProfile(profile, instance.type)) {
            result.skippedDefaults += 1;
            continue;
          }
          // upsertDelayProfileByNameAndMetadata(instance.id, profile)
          result.imported += 1;
        }

        for (const cf of customFormats) {
          // upsertCustomFormatByNameAndMetadata(instance.id, cf)
          result.imported += 1;
        }

        for (const qp of qualityProfiles) {
          // upsertQualityProfileByNameAndMetadata(instance.id, qp)
          result.imported += 1;
        }
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : 'Unknown pull error');
      }

      return result;
    })
  );
}
```

Notes on the example:

- Uses header-based API auth.
- Pull loop is per-instance and parallelized.
- Error bodies are parsed defensively due to inconsistent error schemas.
- Default handling is explicit and conservative, with Lidarr marked as heuristic.

## Open Questions

1. Is release-profile pull in scope for `pull-on-startup` now, or deferred until Praxrr adds first-class release-profile entities and Arr client methods?
2. What is the canonical default-ignore policy per entity type (especially quality profiles/custom formats where no explicit default flag exists)?
3. Should startup pull hard-fail boot when all instances fail, or always degrade gracefully and continue startup?
4. Should startup pull write only truly new items, or also update existing Praxrr entities when Arr diverges at startup?
5. How should conflict precedence work when local user ops and Arr remote both changed since last sync?
6. Do we require a persisted pull fingerprint/hash to guarantee idempotency and provide audit visibility?
7. For Sonarr and Lidarr, do we need app-specific guards for schema drift (Sonarr v5 path/version changes, Lidarr metadata/profile evolution)?
8. What exact metadata fields should be considered part of the match key besides name (e.g., arr_type, namespace suffix, source database identity)?
