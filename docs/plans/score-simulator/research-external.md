# External API Research: Score Simulator

## Executive Summary

The score simulator can be built almost entirely on top of infrastructure Praxrr already owns: the C# parser microservice (parse + match endpoints), the PCD custom format/quality profile data model, and the existing condition-type definitions. No new external APIs are required for the core scoring simulation. The primary integration pattern is: (1) parse a release title via the parser `/parse` endpoint, (2) evaluate each custom format's conditions against the parsed result plus regex matches from the `/match` endpoint, (3) sum scores from the quality profile, and (4) present the breakdown to the user. A lightweight JS-only fallback (`@ctrl/video-filename-parser`) exists if the parser service is unavailable, though it lacks .NET regex fidelity.

**Confidence**: High -- all building blocks already exist in the codebase.

## Primary APIs

### Radarr/Sonarr Custom Formats API

- **Documentation**: [Radarr API Docs](https://radarr.video/docs/api/) | [Servarr Wiki - Radarr Settings](https://wiki.servarr.com/radarr/settings)
- **Authentication**: API key via `X-Api-Key` header or `?apikey=` query parameter
- **Key Endpoints** (both apps use `/api/v3`):
  - `GET /api/v3/customformat` -- List all custom formats
  - `GET /api/v3/customformat/{id}` -- Get single custom format
  - `POST /api/v3/customformat` -- Create custom format
  - `PUT /api/v3/customformat/{id}` -- Update custom format
  - `GET /api/v3/customformat/schema` -- Get available specification types and their field definitions
  - `GET /api/v3/qualityprofile` -- List quality profiles (includes custom format scores)
  - `GET /api/v3/qualityprofile/{id}` -- Get single quality profile
  - `GET /api/v3/parse?title={title}` -- Parse a release title (returns parsed info + matched custom formats)
- **Rate Limits**: No documented rate limits; these are self-hosted applications.

**Confidence**: High -- endpoints verified from Radarr source code and community documentation.

> **Note for score simulator**: The Radarr/Sonarr API is NOT needed for the simulator itself. Praxrr already has all custom format definitions and quality profile scores stored locally in the PCD system. The simulator should operate entirely against local data, not live Arr instances.

### Praxrr Parser Microservice (Existing)

The C# parser microservice at `packages/praxrr-parser/` is the primary integration point. It already provides everything the simulator needs.

- **Integration**: HTTP POST to `http://{PARSER_HOST}:{PARSER_PORT}/`
- **Endpoints**:

  | Endpoint       | Method | Purpose                                        |
  | -------------- | ------ | ---------------------------------------------- |
  | `/parse`       | POST   | Parse a release title into structured metadata |
  | `/match`       | POST   | Test regex patterns against a single text      |
  | `/match/batch` | POST   | Test regex patterns against multiple texts     |
  | `/health`      | GET    | Health check + version info                    |

- **Parse Request/Response**:

  ```json
  // Request
  { "title": "Movie.Name.2024.1080p.BluRay.x264-GROUP", "type": "movie" }

  // Response
  {
    "title": "Movie.Name.2024.1080p.BluRay.x264-GROUP",
    "type": "movie",
    "source": "Bluray",
    "resolution": 1080,
    "modifier": "None",
    "revision": { "version": 1, "real": 0, "isRepack": false },
    "languages": ["English"],
    "releaseGroup": "GROUP",
    "movieTitles": ["Movie Name"],
    "year": 2024,
    "edition": null,
    "imdbId": null,
    "tmdbId": 0,
    "hardcodedSubs": null,
    "releaseHash": null,
    "episode": null
  }
  ```

- **Match Request/Response**:

  ```json
  // Request
  { "text": "Movie.Name.2024.1080p.BluRay.x264-GROUP", "patterns": ["\\bBluRay\\b", "\\bWEB\\b"] }

  // Response
  { "results": { "\\bBluRay\\b": true, "\\bWEB\\b": false } }
  ```

- **Batch Match Request/Response**:

  ```json
  // Request
  {
    "texts": ["Release.A.1080p.BluRay", "Release.B.720p.WEB-DL"],
    "patterns": ["\\bBluRay\\b", "\\bWEB\\b"]
  }

  // Response
  {
    "results": {
      "Release.A.1080p.BluRay": { "\\bBluRay\\b": true, "\\bWEB\\b": false },
      "Release.B.720p.WEB-DL": { "\\bBluRay\\b": false, "\\bWEB\\b": true }
    }
  }
  ```

- **Existing client wrapper**: `$arr/parser/client.ts` provides `parse()`, `matchPatterns()`, `matchPatternsBatch()`, `parseWithCache()` with built-in caching, retries, and version-based cache invalidation.

**Confidence**: High -- source code reviewed directly.

## Custom Format Condition Types

The PCD system defines these condition types in `$shared/pcd/conditions.ts`:

| Condition Type     | Matching Method    | Arr Scope | Data Source                                     |
| ------------------ | ------------------ | --------- | ----------------------------------------------- |
| `resolution`       | Enum comparison    | All       | Parser `/parse` response `.resolution`          |
| `source`           | Enum comparison    | All       | Parser `/parse` response `.source`              |
| `quality_modifier` | Enum comparison    | Radarr    | Parser `/parse` response `.modifier`            |
| `release_title`    | Regex match        | All       | Parser `/match` endpoint against raw title      |
| `release_group`    | Regex match        | All       | Parser `/match` endpoint or `.releaseGroup`     |
| `edition`          | Regex match        | Radarr    | Parser `/match` endpoint or `.edition`          |
| `language`         | Enum comparison    | All       | Parser `/parse` response `.languages`           |
| `release_type`     | Enum comparison    | Sonarr    | Parser `/parse` response `.episode.releaseType` |
| `indexer_flag`     | Flag comparison    | All       | Not parseable from title (indexer metadata)     |
| `size`             | Range comparison   | All       | Not parseable from title (file size)            |
| `year`             | Numeric comparison | All       | Parser `/parse` response `.year`                |

**Key insight**: `indexer_flag` and `size` conditions cannot be evaluated from a release title alone. The simulator should either skip these (marking them as "not evaluable from title") or allow the user to optionally provide file size and indexer flags as additional inputs.

**Confidence**: High -- verified from codebase source.

## Libraries and SDKs

### Recommended Libraries

#### @ctrl/video-filename-parser (JS/TS Fallback Parser)

- **Package**: [@ctrl/video-filename-parser](https://www.npmjs.com/package/@ctrl/video-filename-parser)
- **Source**: [github.com/scttcper/video-filename-parser](https://github.com/scttcper/video-filename-parser)
- **License**: MIT
- **Install**: `npm install @ctrl/video-filename-parser`
- **Purpose**: Client-side/fallback parsing when C# parser is unavailable
- **Parsed fields**: title, year, resolution, sources, videoCodec, revision, group, edition, languages, seasons, episodeNumbers
- **Usage**:

  ```typescript
  import { filenameParse } from '@ctrl/video-filename-parser';

  // Movie
  const result = filenameParse('Movie.2024.1080p.BluRay.x264-GROUP');
  // { title: 'Movie', year: 2024, resolution: '1080P', sources: ['BLURAY'], ... }

  // TV
  const tvResult = filenameParse('Show.S01E02.720p.WEB-DL', true);
  // { title: 'Show', seasons: [1], episodeNumbers: [2], ... }
  ```

- **Limitations**:
  - Based on Radarr's parser but is a JS port, not identical behavior
  - Regex patterns use JS regex engine, not .NET -- subtle differences possible
  - No Deno-specific build, but should work via npm compatibility
  - Does NOT handle custom format condition matching, only title parsing

**Recommendation**: Use as a degraded-mode fallback only. The C# parser should be the primary path because it uses the same .NET regex engine as Radarr/Sonarr, ensuring pattern matching fidelity.

**Confidence**: Medium -- library is functional but not tested in Deno runtime.

#### svelte-codemirror-editor (Input Component)

- **Package**: [svelte-codemirror-editor](https://www.npmjs.com/package/svelte-codemirror-editor)
- **Source**: [github.com/touchifyapp/svelte-codemirror-editor](https://github.com/touchifyapp/svelte-codemirror-editor)
- **Purpose**: Rich text input with autocomplete for release title entry

**Recommendation**: NOT recommended for this use case. A standard `<input>` or `<textarea>` with debounce is simpler and more appropriate. CodeMirror adds unnecessary weight for a single-line text input. The existing `FormInput` component from `$ui/form/FormInput.svelte` should suffice.

**Confidence**: High -- overkill for this feature.

### Alternative/Supplementary Options

| Library                           | Use Case                | Verdict                               |
| --------------------------------- | ----------------------- | ------------------------------------- |
| `@ctrl/video-filename-parser`     | JS fallback parser      | Use for degraded mode only            |
| `svelte-codemirror-editor`        | Rich editor input       | Skip -- standard input is sufficient  |
| Blazor WASM compilation of parser | Client-side .NET parser | Feasible but high effort, skip for v1 |

## Integration Patterns

### Scoring Algorithm

The custom format scoring algorithm in Radarr/Sonarr works as follows (verified from [CustomFormatCalculationService.cs](https://github.com/Radarr/Radarr/blob/develop/src/NzbDrone.Core/CustomFormats/CustomFormatCalculationService.cs)):

1. **Input normalization**: A `CustomFormatInput` is created containing parsed release info (title, quality, languages, release group, edition), the movie/series reference, file size, and indexer flags.

2. **Specification grouping**: Each custom format's specifications are grouped by implementation type.

3. **Group evaluation (OR within type, AND across types)**:
   - Specifications of the same type form a group
   - Within a group: at least one spec must match (OR logic)
   - Exception: specs marked `required=true` MUST individually match regardless of group
   - Specs marked `negate=true` have their match result inverted
   - ALL groups must pass for the custom format to match (AND logic across groups)

4. **Score summation**: For each quality profile, matching custom formats contribute their assigned score. The total score is the sum of all matching custom format scores.

5. **Decision logic**:
   - Release is rejected if total score < `minimumScore`
   - Release triggers upgrade if total score > current file's score AND total score <= `upgradeUntilScore`

**Confidence**: High -- verified from Radarr source code.

### Recommended Simulator Architecture

```
User enters release title
        |
        v
[Debounce 300ms]
        |
        v
[SvelteKit API endpoint: /api/v1/simulator/score]
        |
        +---> [Parser /parse] --> Parsed metadata (source, resolution, languages, etc.)
        |
        +---> [Parser /match] --> Regex match results for all release_title/group/edition patterns
        |
        v
[Server-side scoring engine]
  1. Load custom formats from PCD cache (already in memory)
  2. For each custom format:
     a. Evaluate each condition against parsed data + match results
     b. Apply negate/required boolean logic
     c. Determine if format matches
  3. Look up scores from selected quality profile
  4. Sum matched format scores
  5. Compare against minimumScore and upgradeUntilScore
        |
        v
[Return JSON response]
  {
    parsedInfo: { source, resolution, languages, releaseGroup, ... },
    matchedFormats: [
      { name, score, conditions: [{ type, matched, negate, required }] }
    ],
    unmatchedFormats: [...],
    totalScore: number,
    meetsMinimum: boolean,
    meetsUpgrade: boolean
  }
        |
        v
[Client renders results]
  - Parsed metadata summary
  - Matched/unmatched format breakdown with condition details
  - Score waterfall visualization
  - Pass/fail indicators for minimum and upgrade thresholds
```

### Client-Side vs Server-Side Analysis

| Factor              | Server-Side (Recommended)                             | Client-Side                                |
| ------------------- | ----------------------------------------------------- | ------------------------------------------ |
| **Parser fidelity** | .NET regex via C# parser (identical to Radarr/Sonarr) | JS regex (subtle differences)              |
| **Data access**     | Direct PCD cache access (already loaded)              | Would need to fetch all CFs + profiles     |
| **Latency**         | ~50-100ms per request (parser + scoring)              | Instant after initial data load            |
| **Complexity**      | Lower -- reuse existing parser client                 | Higher -- reimplement matching logic in JS |
| **Offline**         | Requires parser service running                       | Could work without parser                  |
| **Consistency**     | Guaranteed match with actual sync behavior            | May diverge from actual Arr matching       |

**Recommendation**: Server-side scoring via a new API endpoint. This ensures regex matching uses the .NET engine (matching actual Radarr/Sonarr behavior), leverages the existing parser client with caching, and directly accesses PCD data without serializing everything to the client.

**Confidence**: High -- aligns with existing architecture.

### Real-Time Feedback Pattern

The recommended UX pattern for real-time scoring feedback:

1. **Debounced input**: Use a 300ms debounce on the release title input. The app already uses `getPersistentSearchStore` with configurable debounce in `$lib/client/stores/search`.

2. **Loading state**: Show a spinner or skeleton while the server request is in flight.

3. **Incremental display**: Render parsed metadata immediately (fast), then render scoring results as they arrive.

4. **Error handling**: If the parser is unavailable, show a clear message suggesting the user start the parser service. Optionally fall back to `@ctrl/video-filename-parser` for a degraded experience.

5. **Input history**: Store recent titles in localStorage for quick re-testing.

**Confidence**: High -- standard SvelteKit patterns.

## Existing Ecosystem Tools

### Profilarr (Reference Implementation)

- **Source**: [github.com/Dictionarry-Hub/profilarr](https://github.com/Dictionarry-Hub/profilarr)
- **Relevance**: Configuration management platform for Radarr/Sonarr that includes custom format testing and regex validation.
- **Key similarities**: Uses its own C# parser microservice (same architecture -- .NET 8+, port 5000) for custom format and quality profile testing. TypeScript-based (62.9% of codebase).
- **What they do**: Validate regex patterns and custom format conditions before syncing to Arr instances. This is conceptually similar to the score simulator but focused on validation rather than release-level scoring simulation.
- **What they DON'T do**: Full scoring simulation with score breakdowns and quality profile integration.

**Confidence**: Medium -- reviewed at high level; specific testing implementation not deeply examined.

### Recyclarr

- **Source**: [recyclarr.dev](https://recyclarr.dev)
- **Relevance**: CLI tool that syncs TRaSH Guide custom formats and scores to Arr instances. Provides a reference for how custom format scores are applied to quality profiles.
- **No simulation feature**: Recyclarr does not include a score simulator.

**Confidence**: High -- well-documented tool.

### TRaSH Guides

- **Source**: [trash-guides.info](https://trash-guides.info)
- **Relevance**: Curated custom format collections with scoring recommendations. The JSON format used by TRaSH is the de facto standard for custom format interchange (also used by Praxrr PCD).
- **Custom Format JSON Structure** (from [TRaSH Guides architecture](https://deepwiki.com/TRaSH-Guides/Guides/2-custom-formats-system-architecture)):
  ```json
  {
    "trash_id": "b6832f586342ef70d9c128d40c07b872",
    "trash_scores": { "default": -10000, "german": -35000 },
    "name": "Bad Dual Groups",
    "includeCustomFormatWhenRenaming": false,
    "specifications": [
      {
        "name": "alfaHD",
        "implementation": "ReleaseGroupSpecification",
        "negate": false,
        "required": false,
        "fields": { "value": "^(alfaHD.*)$" }
      }
    ]
  }
  ```

**Confidence**: High -- primary data source for Praxrr.

## Constraints and Gotchas

### Parser Microservice Dependency

- **Impact**: The score simulator requires the C# parser to be running for full-fidelity results.
- **Workaround**: Degrade gracefully. Show a "Parser unavailable" warning and optionally use `@ctrl/video-filename-parser` for basic parsing. Regex pattern matching (release_title, release_group, edition conditions) CANNOT be done with JS regex and maintain .NET regex fidelity.
- **Existing pattern**: The app already handles parser unavailability -- `parseWithCache()` returns `null` when the parser is down, and `matchPatterns()` returns `null`.

### Non-Evaluable Condition Types

- **`indexer_flag`**: Cannot be determined from a release title. Indexer flags are metadata from the torrent/usenet indexer.
- **`size`**: Cannot be determined from a release title. File size is only known after download.
- **Impact**: Custom formats that rely solely on these conditions will show as "not evaluable" in the simulator.
- **Workaround**: Add optional input fields for file size (MB) and indexer flags (multi-select) so users can simulate these conditions when needed.

### .NET vs JS Regex Differences

- **Impact**: .NET regex has features not present in JS regex (e.g., named backreferences with different syntax, lookbehind with variable length, `RegexOptions.IgnoreCase` behavior nuances).
- **Workaround**: Always use the C# parser `/match` endpoint for regex evaluation. Never evaluate custom format regex patterns client-side with JS regex.

### Source/Resolution Enum Mapping Differences Between Arr Apps

- **Impact**: Radarr and Sonarr use DIFFERENT numeric values for the same source types in their API (e.g., Radarr: WEBDL=7, Sonarr: WEBDL=3).
- **Workaround**: Praxrr's PCD system already normalizes these to string enum values (`web_dl`, `bluray`, etc.) in `$shared/pcd/conditions.ts`. The simulator should work with PCD string enums, not raw Arr API numeric values.
- **Existing handling**: The parser client in `$arr/parser/client.ts` already maps string source/resolution values from the parser response to PCD enum values.

**Confidence**: High -- verified from source code.

### Performance Considerations

- **Parser latency**: The `/parse` endpoint typically responds in <10ms. The `/match` endpoint with 50+ patterns responds in <20ms. Batch matching is efficient due to compiled regex with 100ms timeout per pattern.
- **Custom format count**: A typical PCD database may contain 100-200 custom formats. Evaluating all of them against parsed data is computationally trivial (simple enum comparisons + pre-computed regex results).
- **Debounce**: 300ms debounce on input prevents excessive parser calls during typing.
- **Caching**: The existing parser cache (`parsedReleaseCacheQueries` and `patternMatchCacheQueries`) means repeated evaluations of the same title are instant.

**Confidence**: High -- existing caching and batch infrastructure handles this well.

### WASM Compilation of C# Parser

- **Feasibility**: Technically possible via Blazor WebAssembly AOT compilation (.NET 8+). The parser code is platform-agnostic (no OS-specific calls).
- **Effort**: High. Would require restructuring the parser as a Blazor WASM library, building a JS interop layer, and managing WASM binary size (AOT binaries are typically 5-15MB+).
- **Recommendation**: Skip for v1. The server-side parser approach is simpler, already works, and provides identical fidelity. WASM compilation would only be worth exploring if offline/client-only scoring becomes a hard requirement.

**Confidence**: Medium -- feasible but high effort with unclear benefit.

## Code Examples

### Scoring Engine Pseudocode (TypeScript)

```typescript
interface SimulationInput {
  title: string;
  type: 'movie' | 'series';
  qualityProfileId: string;
  databaseId: string;
  // Optional inputs for conditions that can't be parsed from title
  fileSize?: number; // MB
  indexerFlags?: string[];
}

interface ConditionResult {
  name: string;
  type: string;
  matched: boolean;
  negate: boolean;
  required: boolean;
  evaluable: boolean; // false for indexer_flag/size when not provided
}

interface FormatResult {
  name: string;
  matched: boolean;
  score: number;
  conditions: ConditionResult[];
}

interface SimulationResult {
  parsedInfo: ParseResult;
  formats: FormatResult[];
  totalScore: number;
  minimumScore: number;
  upgradeUntilScore: number;
  meetsMinimum: boolean;
  meetsUpgrade: boolean;
}

async function simulateScore(
  input: SimulationInput
): Promise<SimulationResult> {
  // 1. Parse the release title
  const parsed = await parseWithCache(input.title, input.type);
  if (!parsed) throw new Error('Parser unavailable');

  // 2. Collect all regex patterns from custom formats
  const regexPatterns: string[] = [];
  // ... collect from all release_title, release_group, edition conditions

  // 3. Match all patterns in one batch call
  const matches = await matchPatterns(input.title, regexPatterns);

  // 4. Load custom formats and quality profile from PCD
  const customFormats = getCustomFormatsFromPCD(input.databaseId);
  const profile = getQualityProfileFromPCD(
    input.databaseId,
    input.qualityProfileId
  );

  // 5. Evaluate each custom format
  const formats: FormatResult[] = customFormats.map((cf) => {
    const conditions = evaluateConditions(
      cf.conditions,
      parsed,
      matches,
      input
    );
    const matched = isFormatMatched(conditions);
    const score = matched ? (profile.scores[cf.name] ?? 0) : 0;
    return { name: cf.name, matched, score, conditions };
  });

  // 6. Calculate totals
  const totalScore = formats.reduce((sum, f) => sum + f.score, 0);

  return {
    parsedInfo: parsed,
    formats,
    totalScore,
    minimumScore: profile.minimumScore,
    upgradeUntilScore: profile.upgradeUntilScore,
    meetsMinimum: totalScore >= profile.minimumScore,
    meetsUpgrade: totalScore <= profile.upgradeUntilScore,
  };
}

function evaluateCondition(
  condition: {
    type: string;
    value: string;
    negate: boolean;
    required: boolean;
  },
  parsed: ParseResult,
  matches: Map<string, boolean> | null,
  input: SimulationInput
): ConditionResult {
  let matched = false;
  let evaluable = true;

  switch (condition.type) {
    case 'resolution':
      matched =
        String(parsed.resolution) === condition.value ||
        `${parsed.resolution}p` === condition.value;
      break;
    case 'source':
      matched = parsed.source.toLowerCase() === condition.value.toLowerCase();
      break;
    case 'release_title':
    case 'release_group':
    case 'edition':
      matched = matches?.get(condition.value) ?? false;
      break;
    case 'language':
      matched = parsed.languages.some(
        (l) => l.toLowerCase() === condition.value.toLowerCase()
      );
      break;
    case 'indexer_flag':
      if (input.indexerFlags) {
        matched = input.indexerFlags.includes(condition.value);
      } else {
        evaluable = false;
      }
      break;
    case 'size':
      if (input.fileSize !== undefined) {
        // condition.value contains min:max in GB
        // ... size range check
      } else {
        evaluable = false;
      }
      break;
    // ... other types
  }

  // Apply negate
  if (evaluable && condition.negate) {
    matched = !matched;
  }

  return {
    name: condition.name ?? condition.type,
    type: condition.type,
    matched,
    negate: condition.negate,
    required: condition.required,
    evaluable,
  };
}

function isFormatMatched(conditions: ConditionResult[]): boolean {
  // Group by type
  const groups = new Map<string, ConditionResult[]>();
  for (const c of conditions) {
    if (!groups.has(c.type)) groups.set(c.type, []);
    groups.get(c.type)!.push(c);
  }

  for (const [, group] of groups) {
    // Required conditions must individually match
    const requiredInGroup = group.filter((c) => c.required);
    if (requiredInGroup.some((c) => c.evaluable && !c.matched)) {
      return false;
    }

    // Non-required: at least one must match (OR logic)
    const optional = group.filter((c) => !c.required && c.evaluable);
    if (optional.length > 0 && !optional.some((c) => c.matched)) {
      return false;
    }
  }

  return true;
}
```

### API Endpoint Skeleton

```typescript
// packages/praxrr-app/src/routes/api/v1/simulator/score/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseWithCache, matchPatterns } from '$arr/parser';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { title, type, databaseId, qualityProfileId, fileSize, indexerFlags } =
    body;

  // Validate inputs
  if (!title || !type || !databaseId || !qualityProfileId) {
    return json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Run simulation
  const result = await simulateScore({
    title,
    type,
    qualityProfileId,
    databaseId,
    fileSize,
    indexerFlags,
  });

  return json(result);
};
```

## Open Questions

1. **Multi-title comparison**: Should the simulator support entering multiple release titles simultaneously to compare scores side-by-side? This would help users understand why Radarr/Sonarr would prefer one release over another.

2. **Quality profile selection**: Should the simulator default to showing scores for ALL quality profiles, or require the user to select one profile at a time? Showing all profiles provides a comprehensive view but increases UI complexity.

3. **Indexer flag and file size inputs**: Should these optional inputs be hidden behind an "Advanced" toggle to keep the default UI simple, or always visible?

4. **Historical results**: Should the simulator persist past simulations in the database for reference, or keep them ephemeral (session/localStorage only)?

5. **Integration with existing scoring page**: The quality profile scoring page at `/quality-profiles/[databaseId]/[id]/scoring` already shows custom format scores. Should the simulator be a separate page, or integrated as a panel within the scoring page?

6. **Batch testing**: Should users be able to paste multiple release titles (one per line) for bulk comparison? The parser already supports batch matching via `/match/batch`.

## Sources

- [Radarr API Documentation](https://radarr.video/docs/api/)
- [Radarr CustomFormatCalculationService.cs](https://github.com/Radarr/Radarr/blob/develop/src/NzbDrone.Core/CustomFormats/CustomFormatCalculationService.cs)
- [Radarr CustomFormatResource.cs](https://github.com/Radarr/Radarr/blob/develop/src/Radarr.Api.V3/CustomFormats/CustomFormatResource.cs)
- [Radarr REST API - DeepWiki](https://deepwiki.com/radarr/radarr/4.1-rest-api)
- [Servarr Wiki - Radarr Settings](https://wiki.servarr.com/radarr/settings)
- [Servarr Wiki - Sonarr v4 FAQ](https://wiki.servarr.com/sonarr/faq-v4)
- [TRaSH Guides - Radarr Custom Formats](https://trash-guides.info/Radarr/Radarr-collection-of-custom-formats/)
- [TRaSH Guides - Custom Formats Architecture](https://deepwiki.com/TRaSH-Guides/Guides/2-custom-formats-system-architecture)
- [TRaSH Guides - Quality Profiles Setup](https://trash-guides.info/Radarr/radarr-setup-quality-profiles/)
- [Buildarr - Radarr Custom Formats](https://buildarr.github.io/plugins/radarr/configuration/settings/custom-formats/)
- [Profilarr - GitHub](https://github.com/Dictionarry-Hub/profilarr)
- [Recyclarr Documentation](https://recyclarr.dev)
- [@ctrl/video-filename-parser - npm](https://www.npmjs.com/package/@ctrl/video-filename-parser)
- [@ctrl/video-filename-parser - GitHub](https://github.com/scttcper/video-filename-parser)
- [svelte-codemirror-editor - npm](https://www.npmjs.com/package/svelte-codemirror-editor)
- [Blazor WebAssembly AOT - Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/webassembly-build-tools-and-aot)
- [Svelte Debounce Patterns](https://www.okupter.com/blog/svelte-debounce)

## Search Queries Executed

1. `Radarr custom format scoring API documentation 2025`
2. `Sonarr custom format scoring API v4 documentation`
3. `Radarr Sonarr custom format score simulator tools arr ecosystem`
4. `release title parsing library JavaScript TypeScript arr Radarr Sonarr`
5. `Radarr custom format matching logic source code CustomFormatCalculationService C#`
6. `Profilarr custom format testing regex validation tool GitHub`
7. `Radarr API v3 custom format endpoints GET POST customformat`
8. `Sonarr custom format condition types indexer flag language specification v4`
9. `Svelte interactive playground sandbox component code editor library 2025`
10. `@ctrl/video-filename-parser GitHub usage API features parsed fields`
11. `CodeMirror Svelte component input autocomplete editor npm 2025`
12. `Radarr Sonarr API customformat schema endpoint response format specifications`
13. `C# dotnet compile WASM Blazor WebAssembly feasibility 2025`
14. `SvelteKit real-time form feedback debounce server action pattern`
15. `Radarr custom format JSON structure example specifications conditions`

## Uncertainties and Gaps

- **Exact PCD condition data model**: The scoring pseudocode assumes a specific shape for custom format conditions from the PCD cache. The actual PCD data structure for conditions needs to be verified against the compiled cache schema (not fully explored in this research).
- **Parser response enum value alignment**: The mapping between parser response strings (e.g., `"Bluray"`) and PCD condition values (e.g., `"bluray"`) needs case-sensitivity verification. The existing parser client in `$arr/parser/client.ts` handles some of this mapping but may need extensions for simulator-specific comparisons.
- **Year condition evaluation**: The `year` condition type is defined in PCD but its matching logic (exact match? range?) is not fully documented in the Radarr source code results.
- **Quality modifier mapping for Sonarr**: Sonarr does not use quality modifiers, but the parser always returns a modifier value. Need to confirm the simulator correctly ignores `quality_modifier` conditions for Sonarr-typed databases.
