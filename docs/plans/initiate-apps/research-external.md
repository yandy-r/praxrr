# External API Research: initiate-apps

## Executive Summary

The initiate-apps feature requires parsing indexed environment variables at startup to auto-configure Arr instances (Radarr, Sonarr, Lidarr) in the Praxrr database. All target Arr apps share a common authentication model (API key via `X-Api-Key` header) and provide a `/api/{version}/system/status` endpoint for connectivity validation. The Praxrr codebase already has a robust Arr client layer (`BaseArrClient`, `createArrClient` factory, `arrInstancesQueries`) that handles API versioning (v3 for Radarr/Sonarr, v1 for Lidarr) and connection testing, so the implementation primarily involves building an environment variable parser and inserting validated instances into the existing DB layer during the startup sequence.

## Search Queries Executed

1. `Radarr API documentation v3 system status endpoint authentication`
2. `Sonarr API v3 documentation system status endpoint API key authentication`
3. `Lidarr API documentation endpoints authentication API key`
4. `Recyclarr environment variable configuration multiple instances YAML`
5. `Notifiarr Buildarr environment variable instance configuration arr apps Docker`
6. `Unpackerr environment variable configuration multiple Radarr Sonarr instances indexed Docker`
7. `Deno environment variable parsing library indexed numbered env vars configuration`
8. `Deno 2 Deno.env.toObject iterate environment variables pattern matching TypeScript`
9. `devopsarr typescript SDK Radarr Sonarr Lidarr API npm jsr deno compatible`
10. `Radarr Sonarr Lidarr API /ping endpoint health check no authentication required`
11. `Radarr Sonarr API rate limiting throttling concurrent requests limits`
12. `Readarr API version v1 Prowlarr API version v1 Whisparr API version system status endpoint`
13. `golift starr Go library API versions Radarr v3 Sonarr v3 Lidarr v1 Readarr v1 Prowlarr v1`
14. `Docker environment variable indexed pattern best practices multiple service instances`
15. `Recyclarr environment variable substitution YAML syntax !env_var default value`
16. `Radarr API v3 system status response schema appName instanceName version`

---

## Primary APIs

### Radarr API (v3)

- **Documentation**: [https://radarr.video/docs/api/](https://radarr.video/docs/api/) | [GitHub Wiki](https://github.com/Radarr/Radarr/wiki/API)
- **OpenAPI Spec**: [https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json](https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json)
- **API Version**: `v3` (base path: `/api/v3/`)
- **Default Port**: `7878`
- **OpenAPI Standard**: 3.0.4

**Authentication**:

- **Header**: `X-Api-Key: <api-key>` (primary method)
- **Query string**: `?apikey=<api-key>` (alternative)
- API keys are alphanumeric (lowercase), stored in `Config.xml` on the Arr instance
- All dates/timestamps are ISO-8601 formatted in UTC

**Key Endpoints for Validation & Initialization**:

- `GET /ping` - Health check, **no authentication required** (fixed in [Radarr PR](https://github.com/Radarr/Radarr/issues/8043), merged Feb 2023). Returns `{"status": "OK"}`
- `GET /api/v3/system/status` - Full system info (requires API key)
- `GET /api/v3/health` - Health warnings array (requires API key)
- `GET /api` - API info resource (version metadata)
- `GET /api/v3/qualityprofile` - Quality profiles
- `GET /api/v3/customformat` - Custom formats
- `GET /api/v3/delayprofile` - Delay profiles

**Rate Limits**: No documented rate limits on the Arr API itself. The Arr apps have no built-in throttling for incoming API requests. Rate limiting concerns are about outbound indexer calls, not inbound API usage.

**Confidence**: High - Verified across official docs, OpenAPI spec, GitHub wiki, and the existing Praxrr `BaseArrClient` implementation.

---

### Sonarr API (v3)

- **Documentation**: [https://sonarr.tv/docs/api/](https://sonarr.tv/docs/api/)
- **OpenAPI Spec**: [https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/Sonarr.Api.V3/openapi.json](https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/Sonarr.Api.V3/openapi.json)
- **API Version**: `v3` (base path: `/api/v3/`). Note: Sonarr also has a v5 spec in development on the `v5-develop` branch.
- **Default Port**: `8989`

**Authentication**: Identical to Radarr (`X-Api-Key` header or `?apikey=` query param).

**Key Endpoints for Validation & Initialization**:

- `GET /ping` - Health check, no authentication required (Sonarr was the first to implement this)
- `GET /api/v3/system/status` - Full system info (requires API key)
- `GET /api/v3/health` - Health warnings array
- `GET /api/v3/qualityprofile` - Quality profiles
- `GET /api/v3/customformat` - Custom formats

**Rate Limits**: No documented rate limits on the Sonarr API itself.

**Confidence**: High - Same authentication model as Radarr, confirmed in Sonarr OpenAPI spec and forums.

---

### Lidarr API (v1)

- **Documentation**: [https://lidarr.audio/docs/api/](https://lidarr.audio/docs/api/)
- **OpenAPI Spec**: [https://raw.githubusercontent.com/lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json](https://raw.githubusercontent.com/lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json)
- **API Version**: `v1` (base path: `/api/v1/`) -- **different from Radarr/Sonarr**
- **Default Port**: `8686`

**Authentication**: Identical to Radarr/Sonarr (`X-Api-Key` header or `?apikey=` query param).

**Key Endpoints for Validation & Initialization**:

- `GET /ping` - Health check (expected to be unauthenticated, following Servarr conventions)
- `GET /api/v1/system/status` - Full system info (requires API key)
- `GET /api/v1/health` - Health warnings array
- `GET /api/v1/qualityprofile` - Quality profiles
- `GET /api/v1/metadataprofile` - Metadata profiles (Lidarr-specific)

**Rate Limits**: No documented rate limits on the Lidarr API itself.

**Confidence**: High - Confirmed in OpenAPI spec. The existing Praxrr `LidarrClient` already overrides `apiVersion = 'v1'`.

---

### System Status Response Schema (Shared)

The `/api/{version}/system/status` endpoint returns a consistent schema across all Arr apps. The Praxrr codebase already has this typed as `ArrSystemStatus` in `/packages/praxrr-app/src/lib/server/utils/arr/types.ts`.

Key fields returned (confirmed from Radarr API, applies to all Arr apps):

| Field            | Type      | Description                                   | Validation Use                             |
| ---------------- | --------- | --------------------------------------------- | ------------------------------------------ |
| `appName`        | `string`  | App name (e.g., "Radarr", "Sonarr", "Lidarr") | Verify instance type matches declared type |
| `instanceName`   | `string`  | Instance name configured in the Arr app       | Auto-naming if no name provided            |
| `version`        | `string`  | App version (e.g., "5.17.2.9580")             | Logging, compatibility check               |
| `isDocker`       | `boolean` | Whether the Arr app is running in Docker      | Logging context                            |
| `urlBase`        | `string`  | URL base path (e.g., "/radarr")               | Validate base URL configuration            |
| `authentication` | `string`  | Auth mode ("none", "basic", "forms")          | Informational                              |
| `branch`         | `string`  | Update branch (e.g., "main", "develop")       | Informational                              |

**Confidence**: High - Already typed and used in the Praxrr codebase. Schema verified against actual Radarr API response.

---

### API Version Summary Table

| Arr App  | API Version | Default Port | Status                      |
| -------- | ----------- | ------------ | --------------------------- |
| Radarr   | v3          | 7878         | Fully supported in Praxrr   |
| Sonarr   | v3          | 8989         | Fully supported in Praxrr   |
| Lidarr   | v1          | 8686         | Fully supported in Praxrr   |
| Readarr  | v1          | 8787         | Not yet in Praxrr `ArrType` |
| Prowlarr | v1          | 9696         | Not yet in Praxrr `ArrType` |
| Whisparr | v3          | 6969         | Not yet in Praxrr `ArrType` |

**Confidence**: High for Radarr/Sonarr/Lidarr (verified in code). Medium for Readarr/Prowlarr/Whisparr (verified from Servarr wiki and Buildarr plugin proxy class naming, but not tested).

---

## Libraries and SDKs

### Existing Praxrr Infrastructure (Recommended -- No New Dependencies)

The Praxrr codebase already has everything needed for the API interaction layer:

- **`BaseArrClient`** (`$arr/base.ts`): Base client with `testConnection()` method that calls `/api/{version}/system/status`, uses `X-Api-Key` header authentication, has built-in retry logic (3 attempts with exponential backoff).
- **`createArrClient`** (`$arr/factory.ts`): Factory function that creates the correct client type (RadarrClient, SonarrClient, LidarrClient, ChaptarrClient) based on `ArrType`.
- **`BaseHttpClient`** (`$http/client.ts`): Underlying HTTP client with retry, timeout, and error handling.
- **`arrInstancesQueries`** (`$db/queries/arrInstances.ts`): Full CRUD for `arr_instances` table including `nameExists()` and `apiKeyExists()` duplicate checking.

**No new API libraries are needed.** The implementation should build the env-var parsing layer and integrate with the existing infrastructure.

**Confidence**: High - Verified by reading the actual source code.

### Deno Environment Variable API

Deno provides built-in environment variable access without any external libraries:

- **`Deno.env.get(key)`**: Get a single variable. Returns `string | undefined`.
- **`Deno.env.toObject()`**: Get all environment variables as `Record<string, string>`. Returns a snapshot at invocation time.
- **`Deno.env.has(key)`**: Check if a variable exists.

For the indexed env var parsing pattern, no external library is needed. `Deno.env.toObject()` combined with regex-based key matching provides everything required.

- **Documentation**: [https://docs.deno.com/runtime/reference/env_variables/](https://docs.deno.com/runtime/reference/env_variables/)
- **API Reference**: [https://docs.deno.com/api/deno/~/Deno.Env](https://docs.deno.com/api/deno/~/Deno.Env)
- **Permission**: Requires `--allow-env` (already used by Praxrr)

**Confidence**: High - Standard Deno API, well-documented.

### External TypeScript Libraries (Not Recommended)

| Library                                                       | Status                       | Why Not Recommended                                                      |
| ------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------ |
| [TsArr](https://github.com/robbeverhelst/TsArr)               | v1.9.0, Bun-optimized, MIT   | Bun-native, no Deno support. Praxrr already has equivalent client layer. |
| [devopsarr/radarr-py](https://github.com/devopsarr/radarr-py) | Python SDK                   | Wrong language                                                           |
| [golift/starr](https://github.com/golift/starr)               | Go SDK, 100+ methods per app | Wrong language, but good reference for API version mapping               |

**Confidence**: High - Praxrr's existing client layer is more appropriate than any external library.

---

## Integration Patterns

### How Other Tools Handle Indexed Environment Variables

Three well-established tools in the Arr ecosystem use indexed environment variables for multi-instance configuration. Their patterns provide strong prior art:

#### Notifiarr Client

- **Documentation**: [https://notifiarr.wiki/pages/client/configuration/](https://notifiarr.wiki/pages/client/configuration/)
- **Pattern**: `DN_{APP}_{INDEX}_{PROPERTY}`
- **Index start**: `0` (zero-based)
- **Supported apps**: SONARR, RADARR, LIDARR, READARR, PROWLARR

Properties per instance:

```
DN_SONARR_0_NAME
DN_SONARR_0_URL
DN_SONARR_0_API_KEY
DN_SONARR_0_USERNAME
DN_SONARR_0_PASSWORD
```

Multiple instances: `DN_SONARR_1_URL`, `DN_SONARR_2_URL`, etc.

**Confidence**: High - Directly documented on Notifiarr wiki.

#### Unpackerr

- **Documentation**: [https://unpackerr.zip/docs/install/configuration/](https://unpackerr.zip/docs/install/configuration/)
- **Pattern**: `UN_{APP}_{INDEX}_{PROPERTY}`
- **Index start**: `0` (zero-based)
- **Supported apps**: RADARR, SONARR, LIDARR, READARR, WHISPARR

Properties per instance:

```
UN_RADARR_0_URL=http://radarr
UN_RADARR_0_API_KEY=32characters
UN_RADARR_1_URL=http://radarr4k
UN_RADARR_1_API_KEY=32morecharacters
```

"There is no limit to the number of supported instances."

**Confidence**: High - Directly documented on Unpackerr site and verified in Docker Compose examples.

#### Recyclarr

- **Documentation**: [https://recyclarr.dev/reference/configuration/](https://recyclarr.dev/reference/configuration/) | [Environment Variables](https://recyclarr.dev/wiki/yaml/env-vars/)
- **Pattern**: YAML-based with env var substitution using `!env_var VAR_NAME [default]`
- **Multi-instance**: Named instances under app type keys in YAML

```yaml
radarr:
  movies-hd:
    base_url: !env_var RADARR_BASE_URL
    api_key: !env_var RADARR_API_KEY
  movies-4k:
    base_url: !env_var RADARR_4K_BASE_URL
    api_key: !env_var RADARR_4K_API_KEY
```

Constraints: Only scalar values substituted. Missing vars without defaults cause exceptions. Names are case-sensitive.

**Confidence**: High - Directly from Recyclarr documentation.

#### Buildarr

- **Documentation**: [https://buildarr.github.io/configuration/](https://buildarr.github.io/configuration/)
- **Pattern**: YAML with `instances` block for multiple instances of same app type

```yaml
sonarr:
  instances:
    sonarr1:
      hostname: 'sonarr1.example.com'
      port: 8989
      protocol: 'http'
    sonarr2:
      hostname: 'sonarr2.example.com'
      port: 8989
```

**Confidence**: High - From Buildarr official documentation.

---

### Recommended Approach: Dual-Mode Environment Variable Parsing

Based on the feature description and ecosystem precedents, support two parsing modes:

#### Mode 1: Type-Prefixed (app name in variable prefix)

Pattern: `{APP}_INSTANCE_URL_{N}`, `{APP}_INSTANCE_API_KEY_{N}`, `{APP}_INSTANCE_NAME_{N}`

```bash
# Instance 1: Radarr
RADARR_INSTANCE_URL_1=http://radarr:7878
RADARR_INSTANCE_API_KEY_1=abc123
RADARR_INSTANCE_NAME_1=Radarr-HD

# Instance 2: Radarr 4K
RADARR_INSTANCE_URL_2=http://radarr4k:7878
RADARR_INSTANCE_API_KEY_2=def456
RADARR_INSTANCE_NAME_2=Radarr-4K

# Instance 3: Sonarr
SONARR_INSTANCE_URL_1=http://sonarr:8989
SONARR_INSTANCE_API_KEY_1=ghi789

# Instance 4: Lidarr
LIDARR_INSTANCE_URL_1=http://lidarr:8686
LIDARR_INSTANCE_API_KEY_1=jkl012
```

#### Mode 2: Generic (type as a separate variable)

Pattern: `INSTANCE_TYPE_{N}`, `INSTANCE_URL_{N}`, `INSTANCE_API_KEY_{N}`, `INSTANCE_NAME_{N}`

```bash
INSTANCE_TYPE_1=radarr
INSTANCE_URL_1=http://radarr:7878
INSTANCE_API_KEY_1=abc123
INSTANCE_NAME_1=Radarr-HD

INSTANCE_TYPE_2=sonarr
INSTANCE_URL_2=http://sonarr:8989
INSTANCE_API_KEY_2=ghi789
```

Both modes should be supported simultaneously. Type-prefixed takes precedence if both define the same index.

### Authentication Flow

1. Parse environment variables at startup (after DB migrations, before job initialization)
2. For each parsed instance definition:
   a. Validate required fields (URL + API key + type)
   b. Check for duplicates against existing DB instances (by `api_key` and normalized `url`)
   c. Create an `ArrClient` using `createArrClient(type, url, apiKey)`
   d. Call `client.testConnection()` to validate connectivity
   e. On success: verify `status.appName` matches the declared `type` (e.g., `appName === "Radarr"` for type `radarr`)
   f. Insert into `arr_instances` table via `arrInstancesQueries.create()`
   g. On failure: log warning but do not block startup

### Startup Sequence Integration

The environment variable parsing should be inserted into the existing startup sequence in `hooks.server.ts`:

```
config.init() -> db.initialize() -> runMigrations() -> logSettings.load()
  -> pcdManager.initialize() -> [NEW: initiateAppsFromEnv()] -> initializeJobs()
```

This placement ensures:

- Database is initialized and migrated (arr_instances table exists)
- PCD manager is ready (in case instance creation triggers downstream effects)
- Job queue has not started yet (no sync jobs fire before instances are registered)

---

## Constraints and Gotchas

### 1. API Version Divergence Across Arr Apps

**Impact**: High
**Details**: Lidarr uses `/api/v1/` while Radarr and Sonarr use `/api/v3/`. Readarr also uses `/api/v1/`. The existing `BaseArrClient` handles this via the `apiVersion` property, which is overridden in subclasses.
**Workaround**: Already handled by the factory pattern. The `createArrClient` function dispatches to the correct client class which sets the proper API version.

**Confidence**: High - Verified in codebase.

### 2. Instance Name Auto-Generation

**Impact**: Medium
**Details**: The `arr_instances` table has a `UNIQUE` constraint on `name`. If no `NAME` variable is provided, the system needs a strategy for auto-generating names. The `appName` and `instanceName` fields from the system status response can be used.
**Workaround**: Use `{appName}-{index}` as a fallback (e.g., `Radarr-1`). Check `nameExists()` and append a suffix if needed.

**Confidence**: High - Based on DB schema analysis.

### 3. Idempotent Startup Behavior

**Impact**: High
**Details**: Environment variables persist across restarts. The system must not create duplicate instances on every startup. This is the most critical edge case.
**Workaround**: Before creating, check if an instance with the same `api_key` (or same normalized `url` + `type` combination) already exists via `arrInstancesQueries.apiKeyExists()`. Skip creation if a match is found.

**Confidence**: High - The `apiKeyExists()` query is already in the codebase.

### 4. URL Normalization

**Impact**: Medium
**Details**: Users may provide URLs with or without trailing slashes, with or without `/api` suffix, with or without port numbers. The `BaseHttpClient` already strips trailing slashes.
**Workaround**: Normalize URLs before comparison: strip trailing slashes, remove `/api/v{N}` suffixes if present, ensure scheme is included. Log a warning if the URL looks malformed.

**Confidence**: High - `BaseHttpClient` constructor already does `baseUrl.replace(/\/$/, '')`.

### 5. Connection Failure Should Not Block Startup

**Impact**: High
**Details**: Arr instances may not be running when Praxrr starts (common in Docker Compose where services start in parallel). The system must register instances even if the initial connection test fails.
**Workaround**: Register the instance in the database regardless of connection test result. Log the connection status. Mark `enabled = 1` so sync jobs can retry later. The existing `testConnection()` method already has retry logic (3 attempts).

**Confidence**: High - This is a standard Docker-first pattern. Notifiarr and Unpackerr behave the same way.

### 6. Environment Variable Index Gaps

**Impact**: Low
**Details**: Users might define `_1` and `_3` but skip `_2`. The parser must handle non-contiguous indices.
**Workaround**: Parse all matching variables and extract unique indices rather than iterating sequentially. Use regex matching on `Deno.env.toObject()` keys.

**Confidence**: High - Standard pattern, all reviewed tools handle this.

### 7. Case Sensitivity of Arr Type

**Impact**: Low
**Details**: Users might write `Radarr`, `RADARR`, or `radarr`. The `ArrType` type is lowercase.
**Workaround**: Normalize to lowercase before validation.

**Confidence**: High - Simple string normalization.

### 8. API Key Format

**Impact**: Low
**Details**: Arr API keys are 32-character alphanumeric strings (lowercase). Invalid keys should be caught before attempting connection.
**Workaround**: Validate format with regex `/^[a-f0-9]{32}$/i` before attempting API call. Log clear error for malformed keys.

**Confidence**: Medium - Length is consistently 32 chars in practice, but there is no official documentation mandating this exact format. Some self-hosted instances may have different key formats.

### 9. Missing Ping Endpoint in Older Versions

**Impact**: Low
**Details**: The unauthenticated `/ping` endpoint was added to Radarr in early 2023 (ported from Sonarr). Very old Radarr instances may not have it. Lidarr's `/ping` availability is less documented.
**Workaround**: Use `/api/{version}/system/status` with API key for validation (which is what the existing `testConnection()` method already does). Do not rely on `/ping`.

**Confidence**: High - The existing `testConnection()` method is the correct approach.

### 10. `appName` Validation for Type Mismatch

**Impact**: Medium
**Details**: If a user declares `INSTANCE_TYPE_1=radarr` but provides a Sonarr URL, the `system/status` response will have `appName: "Sonarr"`. This should be detected.
**Workaround**: After successful `testConnection()`, compare `status.appName.toLowerCase()` against the declared type. Log a warning if mismatched but still register the instance (using the detected type, not the declared type). This provides a better UX than silently registering a wrongly-typed instance.

**Confidence**: High - The `appName` field is reliable and consistent across all Arr apps.

---

## Code Examples

### Environment Variable Parser (TypeScript/Deno)

```typescript
import type { ArrType } from '$arr/types.ts';

/** Supported Arr types for env-var-based instance creation */
const SUPPORTED_ARR_TYPES: ReadonlySet<string> = new Set([
  'radarr',
  'sonarr',
  'lidarr',
]);

/** Parsed instance definition from environment variables */
interface ParsedInstanceDef {
  type: ArrType;
  url: string;
  apiKey: string;
  name?: string;
  externalUrl?: string;
}

/**
 * Type-prefixed pattern:
 *   RADARR_INSTANCE_URL_1, RADARR_INSTANCE_API_KEY_1, etc.
 */
const TYPE_PREFIXED_REGEX =
  /^(RADARR|SONARR|LIDARR)_INSTANCE_(URL|API_KEY|NAME|EXTERNAL_URL)_(\d+)$/;

/**
 * Generic pattern:
 *   INSTANCE_TYPE_1, INSTANCE_URL_1, INSTANCE_API_KEY_1, etc.
 */
const GENERIC_REGEX = /^INSTANCE_(TYPE|URL|API_KEY|NAME|EXTERNAL_URL)_(\d+)$/;

/**
 * Parse all environment variables and extract instance definitions.
 * Supports both type-prefixed and generic patterns.
 */
export function parseInstanceEnvVars(): ParsedInstanceDef[] {
  const env = Deno.env.toObject();
  const typePrefixed = new Map<string, Map<string, string>>(); // "radarr:1" -> { URL: "...", API_KEY: "..." }
  const generic = new Map<string, Map<string, string>>(); // "1" -> { TYPE: "...", URL: "..." }

  for (const [key, value] of Object.entries(env)) {
    // Try type-prefixed pattern first
    let match = key.match(TYPE_PREFIXED_REGEX);
    if (match) {
      const [, appType, property, index] = match;
      const mapKey = `${appType.toLowerCase()}:${index}`;
      if (!typePrefixed.has(mapKey)) {
        typePrefixed.set(mapKey, new Map());
      }
      typePrefixed.get(mapKey)!.set(property, value);
      continue;
    }

    // Try generic pattern
    match = key.match(GENERIC_REGEX);
    if (match) {
      const [, property, index] = match;
      if (!generic.has(index)) {
        generic.set(index, new Map());
      }
      generic.get(index)!.set(property, value);
    }
  }

  const instances: ParsedInstanceDef[] = [];

  // Process type-prefixed entries
  for (const [mapKey, props] of typePrefixed) {
    const [type] = mapKey.split(':');
    const url = props.get('URL')?.trim();
    const apiKey = props.get('API_KEY')?.trim();
    if (!url || !apiKey) continue;

    instances.push({
      type: type as ArrType,
      url,
      apiKey,
      name: props.get('NAME')?.trim() || undefined,
      externalUrl: props.get('EXTERNAL_URL')?.trim() || undefined,
    });
  }

  // Process generic entries (only if not already covered by type-prefixed)
  for (const [, props] of generic) {
    const rawType = props.get('TYPE')?.trim().toLowerCase();
    const url = props.get('URL')?.trim();
    const apiKey = props.get('API_KEY')?.trim();
    if (!rawType || !url || !apiKey) continue;
    if (!SUPPORTED_ARR_TYPES.has(rawType)) continue;

    // Skip if this URL + apiKey combo is already in type-prefixed results
    const alreadyDefined = instances.some(
      (inst) => inst.url === url && inst.apiKey === apiKey
    );
    if (alreadyDefined) continue;

    instances.push({
      type: rawType as ArrType,
      url,
      apiKey,
      name: props.get('NAME')?.trim() || undefined,
      externalUrl: props.get('EXTERNAL_URL')?.trim() || undefined,
    });
  }

  return instances;
}
```

### Startup Initialization (TypeScript/Deno)

```typescript
import { parseInstanceEnvVars } from './parseEnvVars.ts';
import { createArrClient } from '$arr/factory.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { logger } from '$logger/logger.ts';
import type { ArrSystemStatus } from '$arr/types.ts';

/**
 * Initialize Arr instances from environment variables.
 * Called once during startup, after DB migrations and before job initialization.
 * Idempotent: skips instances that already exist in the database.
 */
export async function initiateAppsFromEnv(): Promise<void> {
  const parsed = parseInstanceEnvVars();
  if (parsed.length === 0) return;

  await logger.info(
    `Found ${parsed.length} Arr instance(s) in environment variables`,
    {
      source: 'InitiateApps',
    }
  );

  for (const def of parsed) {
    // Skip if API key already registered
    if (arrInstancesQueries.apiKeyExists(def.apiKey)) {
      await logger.debug(
        `Skipping instance (API key already registered): ${def.url}`,
        {
          source: 'InitiateApps',
        }
      );
      continue;
    }

    // Generate name if not provided
    const name =
      def.name || `${def.type.charAt(0).toUpperCase() + def.type.slice(1)}-env`;
    const finalName = ensureUniqueName(name);

    // Attempt connection test (non-blocking)
    const client = createArrClient(def.type, def.url, def.apiKey);
    let connected = false;
    try {
      connected = await client.testConnection();
    } catch {
      // Connection failure is non-fatal
    }

    // Register instance regardless of connection status
    try {
      arrInstancesQueries.create({
        name: finalName,
        type: def.type,
        url: def.url,
        apiKey: def.apiKey,
        externalUrl: def.externalUrl,
        enabled: true,
      });

      await logger.info(`Registered Arr instance from env: ${finalName}`, {
        source: 'InitiateApps',
        meta: {
          type: def.type,
          url: def.url,
          connected,
        },
      });
    } catch (error) {
      await logger.warn(
        `Failed to register Arr instance from env: ${finalName}`,
        {
          source: 'InitiateApps',
          meta: { error: String(error) },
        }
      );
    }
  }
}

/**
 * Ensure a name is unique in the arr_instances table.
 * Appends -2, -3, etc. if needed.
 */
function ensureUniqueName(baseName: string): string {
  if (!arrInstancesQueries.nameExists(baseName)) {
    return baseName;
  }

  let suffix = 2;
  while (arrInstancesQueries.nameExists(`${baseName}-${suffix}`)) {
    suffix++;
  }
  return `${baseName}-${suffix}`;
}
```

### Docker Compose Example

```yaml
services:
  praxrr:
    image: praxrr:latest
    ports:
      - '6868:6868'
    environment:
      # Type-prefixed mode
      - RADARR_INSTANCE_URL_1=http://radarr:7878
      - RADARR_INSTANCE_API_KEY_1=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
      - RADARR_INSTANCE_NAME_1=Radarr-HD
      - RADARR_INSTANCE_URL_2=http://radarr4k:7878
      - RADARR_INSTANCE_API_KEY_2=e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
      - RADARR_INSTANCE_NAME_2=Radarr-4K
      - SONARR_INSTANCE_URL_1=http://sonarr:8989
      - SONARR_INSTANCE_API_KEY_1=c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6
      - LIDARR_INSTANCE_URL_1=http://lidarr:8686
      - LIDARR_INSTANCE_API_KEY_1=d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1

      # OR generic mode
      # - INSTANCE_TYPE_1=radarr
      # - INSTANCE_URL_1=http://radarr:7878
      # - INSTANCE_API_KEY_1=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
    volumes:
      - praxrr-data:/app/data

  radarr:
    image: linuxserver/radarr:latest
    ports:
      - '7878:7878'

  sonarr:
    image: linuxserver/sonarr:latest
    ports:
      - '8989:8989'

  lidarr:
    image: linuxserver/lidarr:latest
    ports:
      - '8686:8686'
```

---

## Ecosystem Comparison Matrix

| Feature                  | Notifiarr                                     | Unpackerr                                     | Recyclarr               | Buildarr                      | Praxrr (Proposed)           |
| ------------------------ | --------------------------------------------- | --------------------------------------------- | ----------------------- | ----------------------------- | --------------------------- |
| Config format            | Env vars                                      | Env vars + config file                        | YAML + env substitution | YAML                          | Env vars + UI               |
| Index pattern            | `DN_{APP}_{N}_{PROP}`                         | `UN_{APP}_{N}_{PROP}`                         | Named instances in YAML | Named instances in YAML       | `{APP}_INSTANCE_{PROP}_{N}` |
| Index start              | 0                                             | 0                                             | N/A (named)             | N/A (named)                   | 1                           |
| Generic mode             | No                                            | No                                            | No                      | No                            | Yes (`INSTANCE_TYPE_{N}`)   |
| Connection test          | At startup                                    | At startup                                    | At sync time            | At run time                   | At startup (non-blocking)   |
| Fail on connection error | No                                            | No                                            | Yes (at sync)           | Yes (at run)                  | No (register anyway)        |
| Duplicate detection      | By index                                      | By index                                      | By instance name        | By instance name              | By API key                  |
| Supported apps           | 5 (Radarr, Sonarr, Lidarr, Readarr, Prowlarr) | 5 (Radarr, Sonarr, Lidarr, Readarr, Whisparr) | 2 (Radarr, Sonarr)      | 3+ (Radarr, Sonarr, Prowlarr) | 3 (Radarr, Sonarr, Lidarr)  |

---

## Open Questions

1. **Index numbering: 0-based or 1-based?** Notifiarr and Unpackerr use 0-based. The feature description uses 1-based (`_1`, `_2`, `_3`). Recommend supporting both (any positive integer or zero). The parser should extract the index from the variable name and group by it, regardless of starting point.

2. **Should the env var prefix be `PRAXRR_` namespaced?** Using `PRAXRR_RADARR_INSTANCE_URL_1` would avoid collisions with other tools but is more verbose. Ecosystem precedent (Notifiarr uses `DN_`, Unpackerr uses `UN_`) suggests a short prefix is acceptable, but since Praxrr already uses `PRAXRR_` for its own env vars (`PRAXRR_DEFAULT_DB_URL`, etc.), consistency would favor the namespaced form.

3. **What happens when env-var-created instances are deleted via the UI?** They will be re-created on the next startup unless the env vars are also removed. This is the expected behavior (same as Notifiarr/Unpackerr). It should be documented clearly.

4. **Should env-var instances be marked with an `origin` field?** Adding an `origin` column (e.g., `'env'` vs `'ui'`) to `arr_instances` would allow the UI to display which instances were auto-created and warn users that deleting them will cause re-creation on restart. This would require a DB migration.

5. **Should the feature support `EXTERNAL_URL` per instance?** The `arr_instances` table already has an `external_url` column (added in migration `20260216_add_arr_instance_external_url.ts`). Supporting it via env vars (e.g., `RADARR_INSTANCE_EXTERNAL_URL_1`) would maintain feature parity with the UI.

6. **Should `enabled` be configurable via env var?** An `INSTANCE_ENABLED_{N}=false` variable could allow defining but not activating instances. Default should be `enabled=true`.

---

## Uncertainties and Gaps

- **Readarr, Prowlarr, and Whisparr support**: The current `ArrType` in Praxrr is `'radarr' | 'sonarr' | 'lidarr' | 'chaptarr'`. The env var parser should be designed to be extensible (registry pattern) but the initial implementation should only support the three main types. Adding Readarr/Prowlarr/Whisparr is a separate feature.

- **API key rotation**: If a user changes their API key in the Arr app and updates the env var, the startup flow will see it as a new instance (old API key no longer matches). There is no clean way to handle this without a persistent identifier beyond the API key. This is a known limitation shared by all tools in the ecosystem.

- **Rate limiting on rapid startup**: If 10+ instances are defined, the startup sequence will make 10+ sequential `system/status` API calls. For very large deployments, a configurable concurrency limit or parallel connection test could improve startup time. However, this is an optimization, not a blocker.

- **Lidarr `/ping` endpoint**: Whether Lidarr supports the unauthenticated `/ping` endpoint is not conclusively documented. The recommendation to use `system/status` with API key (as the existing `testConnection()` does) avoids this uncertainty entirely.

## Sources

- [Radarr API Documentation](https://radarr.video/docs/api/)
- [Radarr GitHub Wiki - API](https://github.com/Radarr/Radarr/wiki/API)
- [Radarr OpenAPI Specification](https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json)
- [Radarr REST API - DeepWiki](https://deepwiki.com/radarr/radarr/4.1-rest-api)
- [Radarr /ping endpoint issue #8043](https://github.com/Radarr/Radarr/issues/8043)
- [Radarr appName in system status - issue #6952](https://github.com/Radarr/Radarr/issues/6952)
- [Sonarr API Documentation](https://sonarr.tv/docs/api/)
- [Sonarr OpenAPI Specification](https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/Sonarr.Api.V3/openapi.json)
- [Sonarr /ping health check discussion](https://github.com/Sonarr/Sonarr/issues/5396)
- [Lidarr API Documentation](https://lidarr.audio/docs/api/)
- [Lidarr OpenAPI Specification](https://raw.githubusercontent.com/lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json)
- [Servarr Wiki](https://wiki.servarr.com/)
- [Notifiarr Client Configuration](https://notifiarr.wiki/pages/client/configuration/)
- [Unpackerr Configuration](https://unpackerr.zip/docs/install/configuration/)
- [Recyclarr Configuration Reference](https://recyclarr.dev/reference/configuration/)
- [Recyclarr Configuration Examples](https://recyclarr.dev/wiki/yaml/config-examples/)
- [Recyclarr Environment Variables](https://recyclarr.dev/wiki/yaml/env-vars/)
- [Buildarr Configuration](https://buildarr.github.io/configuration/)
- [Buildarr GitHub](https://github.com/buildarr/buildarr)
- [TsArr TypeScript SDK](https://github.com/robbeverhelst/TsArr)
- [golift/starr Go SDK](https://github.com/golift/starr)
- [Deno Environment Variables Documentation](https://docs.deno.com/runtime/reference/env_variables/)
- [Deno.Env API Reference](https://docs.deno.com/api/deno/~/Deno.Env)
- [Docker Environment Variables Best Practices](https://docs.docker.com/compose/how-tos/environment-variables/best-practices/)
