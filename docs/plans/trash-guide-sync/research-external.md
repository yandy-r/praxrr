# External API Research: trash-guide-sync

## Executive Summary

Implementing TRaSH Guides sync for Praxrr requires integration with three external systems: (1) the
TRaSH Guides repository (JSON data organized by `metadata.json` paths), (2) the Radarr v3 REST API,
and (3) the Sonarr v3 REST API. Both Arr APIs share nearly identical endpoint patterns for quality
profiles, custom formats, quality definitions, naming config, and media management -- authenticated
via `X-Api-Key` header. The data pipeline is well-proven by two mature competitors: Recyclarr (C#,
pipeline architecture, 5-phase sync) and Configarr (TypeScript, merge-precedence model). Praxrr's
existing `BaseSyncer` pattern, PCD entity system, git execution utilities, and job queue
infrastructure provide a strong foundation. The primary design challenge is mapping TRaSH guide
`trash_id`-keyed JSON data through Praxrr's PCD ops layer and then out to Arr APIs, while supporting
user overrides at every level.

**Confidence**: High -- based on multiple authoritative sources (official repos, API specs,
competitor codebases).

---

## Primary APIs

### TRaSH Guides Data

- **Repository**: [TRaSH-Guides/Guides](https://github.com/TRaSH-Guides/Guides)
- **Documentation**: [TRaSH Guides Website](https://trash-guides.info/) |
  [DeepWiki Analysis](https://deepwiki.com/TRaSH-Guides/Guides)
- **Contributing Spec**:
  [CONTRIBUTING.md](https://github.com/TRaSH-Guides/Guides/blob/master/CONTRIBUTING.md)

**Confidence**: High -- primary sources, actively maintained, multiple cross-references.

#### Repository Structure

The repository uses a `metadata.json` root file
([source](https://github.com/TRaSH-Guides/Guides/blob/master/metadata.json)) that declares resource
locations, validated against `metadata.schema.json`
([source](https://github.com/TRaSH-Guides/Guides/blob/master/metadata.schema.json)):

```
TRaSH-Guides/Guides/
  metadata.json          # Resource path declarations
  metadata.schema.json   # Schema validation
  docs/json/
    radarr/
      cf/                # Individual custom format JSON files (100+)
      cf-groups/         # Grouped custom format bundles
      quality-size/      # Quality definition (min/preferred/max) files
      quality-profiles/  # Complete quality profile definitions
      quality-profile-groups/  # Profile grouping metadata
      naming/            # Naming convention templates
    sonarr/
      cf/                # Individual custom format JSON files (100+)
      cf-groups/         # Grouped custom format bundles
      quality-size/      # Quality definition files
      quality-profiles/  # Complete quality profile definitions
      quality-profile-groups/  # Profile grouping metadata
      naming/            # Naming convention templates
    guide-only/          # Guide-specific reference files
```

#### metadata.json Format

```json
{
  "$schema": "metadata.schema.json",
  "json_paths": {
    "radarr": {
      "custom_formats": ["docs/json/radarr/cf"],
      "qualities": ["docs/json/radarr/quality-size"],
      "naming": ["docs/json/radarr/naming"],
      "quality_profiles": ["docs/json/radarr/quality-profiles"],
      "custom_format_groups": ["docs/json/radarr/cf-groups"],
      "quality_profile_groups": ["docs/json/radarr/quality-profile-groups"]
    },
    "sonarr": {
      "custom_formats": ["docs/json/sonarr/cf"],
      "qualities": ["docs/json/sonarr/quality-size"],
      "naming": ["docs/json/sonarr/naming"],
      "quality_profiles": ["docs/json/sonarr/quality-profiles"],
      "custom_format_groups": ["docs/json/sonarr/cf-groups"],
      "quality_profile_groups": ["docs/json/sonarr/quality-profile-groups"]
    }
  }
}
```

#### Custom Format JSON Structure

Each CF file in `cf/` follows this structure (appended to Starr-exported JSON):

```json
{
  "trash_id": "496f355514737f7d83bf7aa4d24f8169",
  "trash_scores": {
    "default": -10000,
    "sqp-1-2160p": -10000,
    "anime-radarr": -10000,
    "german": -35000
  },
  "trash_description": "Description of what this CF detects",
  "trash_regex": "https://regex101.com/r/example",
  "name": "Bad Dual Groups",
  "includeCustomFormatWhenRenaming": false,
  "specifications": [
    {
      "name": "ReleaseTitleMatch",
      "implementation": "ReleaseTitleSpecification",
      "negate": false,
      "required": true,
      "fields": {
        "value": "\\b(SMURF|DEMAND)\\b"
      }
    }
  ]
}
```

**Key fields:**

- `trash_id` -- MD5 hash uniquely identifying the CF across all tools and versions. Generated from
  CF name with app-specific prefixes (e.g., `Sonarr CF_name` for Sonarr).
- `trash_scores` -- Object mapping score-set names to numeric values. `"default"` is the standard
  score; others like `"sqp-1-1080p"`, `"anime-radarr"`, `"german"` provide context-specific
  overrides.
- `trash_regex` -- Optional link to regex101.com test cases.
- `trash_description` -- Human-readable description.
- `name`, `includeCustomFormatWhenRenaming`, `specifications` -- Direct Starr API fields.

**Specification implementations:** | Implementation | Purpose | Field Value | |---|---|---| |
`ReleaseTitleSpecification` | Regex on release title | Regex pattern | | `ReleaseGroupSpecification`
| Regex on release group | Regex pattern | | `SourceSpecification` | Media source type | Numeric
(WEBDL=7, WEBRIP=8, Bluray=9) | | `ResolutionSpecification` | Resolution | Numeric (2160, 1080, 720)
| | `QualityModifierSpecification` | Modifier like REMUX | Numeric (REMUX=5) | |
`LanguageSpecification` | Language code | Language ID |

Each spec also has `negate` (invert match) and `required` (AND vs OR logic) booleans.

**File naming rules:** Lowercase, hyphens replace spaces, "plus" instead of "+", no special chars
except hyphens. File name must match CF name.

**Confidence**: High -- directly from CONTRIBUTING.md and repository inspection.

#### Quality Size (Definition) JSON Structure

Files in `quality-size/`:

```json
{
  "trash_id": "aed34b69-based-quality-id",
  "type": "movie",
  "qualities": [
    {
      "quality": "Bluray-1080p",
      "min": 3.0,
      "preferred": 12.0,
      "max": 25.0
    },
    {
      "quality": "WEBDL-1080p",
      "min": 2.0,
      "preferred": 10.0,
      "max": 25.0
    }
  ]
}
```

**Fields:** `trash_id`, `type` (e.g. `"movie"`, `"series"`, `"anime"`), and `qualities` array with
`quality` name, `min`/`preferred`/`max` in MB per minute of runtime.

**Confidence**: High -- corroborated across Recyclarr docs and TRaSH Guides repo.

#### Quality Profile JSON Structure

Files in `quality-profiles/` (e.g., `sqp-1-1080p.json`):

```json
{
  "trash_id": "0896c29d74de619df168d23b98104b22",
  "name": "[SQP] SQP-1 (1080p)",
  "trash_score_set": "sqp-1-1080p",
  "group": 99,
  "upgradeAllowed": true,
  "cutoff": "Bluray|WEB-1080p",
  "minFormatScore": 1000,
  "cutoffFormatScore": 10000,
  "minUpgradeFormatScore": 1,
  "language": "Original",
  "items": [
    {
      "name": "Bluray|WEB-1080p",
      "allowed": true,
      "qualities": ["Bluray-1080p", "WEBDL-1080p", "WEBRip-1080p"]
    },
    {
      "name": "WEB 720p",
      "allowed": true,
      "qualities": ["WEBDL-720p", "WEBRip-720p"]
    }
  ],
  "formatItems": [
    { "name": "TrueHD ATMOS", "score": 500 },
    { "name": "DTS X", "score": 400 }
  ]
}
```

**Key fields:**

- `trash_score_set` -- identifies which score column in `trash_scores` CFs should use
- `group` -- numeric group ID for display ordering
- `items` -- quality tier groupings with allowed/disabled flags
- `formatItems` -- CF score assignments for this profile
- `minFormatScore` -- minimum CF score to grab a release
- `cutoffFormatScore` -- CF score at which upgrades stop
- `minUpgradeFormatScore` -- minimum CF score increment for upgrade

**Confidence**: High -- verified against actual repo file and DeepWiki analysis.

#### Quality Profile Groups JSON Structure

Files in `quality-profile-groups/groups.json`:

```json
[
  {
    "name": "Standard",
    "profiles": ["trash_id_1", "trash_id_2"]
  },
  {
    "name": "Anime",
    "profiles": ["trash_id_3"]
  }
]
```

Profiles sorted alphabetically within groups; each profile belongs to exactly one group.

**Confidence**: Medium -- structure inferred from multiple secondary sources.

#### Custom Format Groups JSON Structure

Files in `cf-groups/`:

```json
{
  "trash_id": "group-unique-id",
  "name": "Group Name",
  "default": true,
  "custom_formats": [
    {
      "trash_id": "cf-trash-id-1",
      "required": true
    },
    {
      "trash_id": "cf-trash-id-2",
      "required": false
    }
  ]
}
```

- `default: true` -- group is enabled by default for compatible profiles
- `required: true` on a CF -- always included when group is active
- CFs with `required: false` -- optional, user must explicitly include

**Confidence**: Medium -- synthesized from Recyclarr and Configarr documentation.

#### Naming Convention JSON Structure

**Radarr** (`radarr-naming.json`):

```json
{
  "folder": {
    "default": "{Movie CleanTitle} ({Release Year})",
    "plex-imdb": "{Movie CleanTitle} ({Release Year}) {imdb-{ImdbId}}",
    "plex-tmdb": "{Movie CleanTitle} ({Release Year}) {tmdb-{TmdbId}}",
    "emby-imdb": "{Movie CleanTitle} ({Release Year}) [imdbid-{ImdbId}]",
    "emby-tmdb": "{Movie CleanTitle} ({Release Year}) [tmdbid-{TmdbId}]",
    "jellyfin-imdb": "{Movie CleanTitle} ({Release Year}) [imdbid-{ImdbId}]",
    "jellyfin-tmdb": "{Movie CleanTitle} ({Release Year}) [tmdbid-{TmdbId}]"
  },
  "file": {
    "standard": "{Movie CleanTitle} {(Release Year)} - {{Edition Tags}} {[Custom Formats]}{[Quality Full]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo VideoCodec]}{-Release Group}",
    "plex-tmdb": "...",
    "original": "{Original Title}",
    "p2p-scene": "..."
  }
}
```

**Sonarr** (`sonarr-naming.json`):

```json
{
  "season": {
    "default": "Season {season:00}"
  },
  "series": {
    "default": "{Series TitleYear}",
    "plex-imdb": "{Series TitleYear} {imdb-{ImdbId}}",
    "plex-tvdb": "{Series TitleYear} {tvdb-{TvdbId}}",
    "emby-imdb": "{Series TitleYear} [imdb-{ImdbId}]",
    "emby-tvdb": "{Series TitleYear} [tvdb-{TvdbId}]",
    "jellyfin-tvdb": "{Series TitleYear} [tvdbid-{TvdbId}]"
  },
  "episodes": {
    "standard": {
      "default": "{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle:90} {[Custom Formats]}{[Quality Full]}...",
      "original": "{Original Title}",
      "p2p-scene": "..."
    },
    "daily": {
      "default": "{Series TitleYear} - {Air-Date} - {Episode CleanTitle:90} ...",
      "original": "{Original Title}"
    },
    "anime": {
      "default": "{Series TitleYear} - S{season:00}E{episode:00} - {absolute:000} - {Episode CleanTitle:90} ..."
    }
  }
}
```

**Confidence**: High -- extracted directly from repo files.

---

### Radarr API v3

- **Documentation**: [radarr.video/docs/api](https://radarr.video/docs/api/) (Swagger UI)
- **OpenAPI Spec**:
  [openapi.json on GitHub](https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json)
- **Wiki**: [Radarr API Wiki](https://github.com/Radarr/Radarr/wiki/API) |
  [DeepWiki](https://deepwiki.com/radarr/radarr/4.1-rest-api)
- **API Version**: OpenAPI 3.0.4, Radarr API v3.0.0, License: GPL-3.0
- **Base Path**: `/api/v3/`
- **Total Endpoints**: 145+

**Confidence**: High -- official OpenAPI spec.

#### Authentication

Two methods supported (identical for Sonarr):

1. **Header**: `X-Api-Key: <apikey>` (preferred)
2. **Query string**: `?apikey=<apikey>`

API key is alphanumeric lowercase, found in Settings > General, stored in `Config.xml`.

#### Key Endpoints

**Custom Formats:** | Method | Endpoint | Description | |---|---|---| | `GET` |
`/api/v3/customformat` | List all custom formats | | `POST` | `/api/v3/customformat` | Create custom
format | | `GET` | `/api/v3/customformat/{id}` | Get specific custom format | | `PUT` |
`/api/v3/customformat/{id}` | Update custom format | | `DELETE` | `/api/v3/customformat/{id}` |
Delete custom format | | `PUT` | `/api/v3/customformat/bulk` | Bulk update custom formats | |
`DELETE` | `/api/v3/customformat/bulk` | Bulk delete custom formats | | `GET` |
`/api/v3/customformat/schema` | Get CF specification schema |

**Quality Profiles:** | Method | Endpoint | Description | |---|---|---| | `GET` |
`/api/v3/qualityprofile` | List all quality profiles | | `POST` | `/api/v3/qualityprofile` | Create
quality profile | | `GET` | `/api/v3/qualityprofile/{id}` | Get specific profile | | `PUT` |
`/api/v3/qualityprofile/{id}` | Update quality profile | | `DELETE` | `/api/v3/qualityprofile/{id}`
| Delete quality profile | | `GET` | `/api/v3/qualityprofile/schema` | Quality profile template |

**Quality Definitions:** | Method | Endpoint | Description | |---|---|---| | `GET` |
`/api/v3/qualitydefinition` | List quality definitions | | `GET` | `/api/v3/qualitydefinition/{id}`
| Get specific definition | | `PUT` | `/api/v3/qualitydefinition/{id}` | Update quality definition |

**Naming Configuration:** | Method | Endpoint | Description | |---|---|---| | `GET` |
`/api/v3/config/naming` | Get naming settings | | `PUT` | `/api/v3/config/naming/{id}` | Update
naming settings |

Naming resource properties: `renameMovies` (bool), `standardMovieFormat` (string template),
`movieFolderFormat` (string template).

**Media Management:** | Method | Endpoint | Description | |---|---|---| | `GET` |
`/api/v3/config/mediamanagement` | Get media management settings | | `PUT` |
`/api/v3/config/mediamanagement/{id}` | Update media management settings |

**Release Profiles:** | Method | Endpoint | Description | |---|---|---| | `GET` |
`/api/v3/releaseprofile` | List release profiles | | `POST` | `/api/v3/releaseprofile` | Create
release profile | | `GET` | `/api/v3/releaseprofile/{id}` | Get specific profile | | `PUT` |
`/api/v3/releaseprofile/{id}` | Update release profile | | `DELETE` | `/api/v3/releaseprofile/{id}`
| Delete release profile |

#### Custom Format API Resource Structure

```typescript
interface CustomFormatResource {
  id: number;
  name: string;
  includeCustomFormatWhenRenaming: boolean;
  specifications: CustomFormatSpecificationSchema[];
}

interface CustomFormatSpecificationSchema {
  name: string;
  implementation: string; // e.g., "ReleaseTitleSpecification"
  negate: boolean;
  required: boolean;
  fields: FieldDefinition[];
}
```

#### Quality Profile API Resource Structure

```typescript
interface QualityProfileResource {
  id: number;
  name: string;
  upgradeAllowed: boolean;
  cutoff: number; // Quality ID for upgrade ceiling
  minFormatScore: number; // Minimum CF score to grab
  cutoffFormatScore: number; // CF score to stop upgrading
  minUpgradeFormatScore: number; // Min CF increment for upgrade
  items: QualityProfileQualityItem[];
  formatItems: ProfileFormatItem[];
  language: LanguageResource; // Radarr-specific
}

interface QualityProfileQualityItem {
  id: number;
  name: string;
  quality?: Quality;
  items?: QualityProfileQualityItem[]; // Nested quality groups
  allowed: boolean;
}

interface ProfileFormatItem {
  format: number; // CF ID on the Arr instance
  name: string;
  score: number;
}
```

#### Radarr-Specific Differences from Sonarr

- **Language**: Radarr quality profiles have a `language` property (single language per profile).
  Sonarr handles language via Custom Formats instead.
- **Release Profiles**: Radarr supports release profiles but they are deprecated in favor of Custom
  Formats. Sonarr v3 used release profiles extensively; Sonarr v4 replaced them with Custom Formats.
- **No bulk quality definition update**: Quality definitions must be updated individually by ID.
- **Minimum version**: Recyclarr requires Radarr >= v3.0.0.

**Confidence**: High -- from OpenAPI spec and Terraform provider documentation.

---

### Sonarr API v3

- **Documentation**: [sonarr.tv/docs/api](https://sonarr.tv/docs/api/) (Swagger UI)
- **OpenAPI Spec**:
  [openapi.json on GitHub](https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/Sonarr.Api.V3/openapi.json)
- **API Versions**: v3 (Sonarr v3+v4) and v5 (Sonarr v5+)
- **Base Path**: `/api/v3/`
- **Authentication**: Same as Radarr (`X-Api-Key` header or `?apikey=` query)

**Confidence**: High -- official OpenAPI spec.

#### Key Endpoints

Sonarr endpoints mirror Radarr almost exactly:

**Custom Formats (Sonarr v4+):** | Method | Endpoint | Description | |---|---|---| | `GET` |
`/api/v3/customformat` | List all custom formats | | `POST` | `/api/v3/customformat` | Create custom
format | | `GET` | `/api/v3/customformat/{id}` | Get specific custom format | | `PUT` |
`/api/v3/customformat/{id}` | Update custom format | | `DELETE` | `/api/v3/customformat/{id}` |
Delete custom format | | `PUT` | `/api/v3/customformat/bulk` | Bulk update | | `DELETE` |
`/api/v3/customformat/bulk` | Bulk delete | | `GET` | `/api/v3/customformat/schema` | CF schema |

**Quality Profiles:** | Method | Endpoint | Description | |---|---|---| | `GET` |
`/api/v3/qualityprofile` | List all quality profiles | | `POST` | `/api/v3/qualityprofile` | Create
quality profile | | `GET` | `/api/v3/qualityprofile/{id}` | Get specific profile | | `PUT` |
`/api/v3/qualityprofile/{id}` | Update quality profile | | `DELETE` | `/api/v3/qualityprofile/{id}`
| Delete quality profile |

**Quality Definitions:** | Method | Endpoint | Description | |---|---|---| | `GET` |
`/api/v3/qualitydefinition` | List quality definitions | | `GET` | `/api/v3/qualitydefinition/{id}`
| Get specific definition | | `PUT` | `/api/v3/qualitydefinition/{id}` | Update quality definition |

**Naming Configuration:** | Method | Endpoint | Description | |---|---|---| | `GET` |
`/api/v3/config/naming` | Get naming settings | | `PUT` | `/api/v3/config/naming/{id}` | Update
naming settings |

Naming resource properties: `renameEpisodes` (bool), `standardEpisodeFormat`, `dailyEpisodeFormat`,
`animeEpisodeFormat`, `seriesFolderFormat`, `seasonFolderFormat`.

**Media Management:** | Method | Endpoint | Description | |---|---|---| | `GET` |
`/api/v3/config/mediamanagement` | Get settings | | `PUT` | `/api/v3/config/mediamanagement/{id}` |
Update settings |

**Release Profiles (legacy, Sonarr v3 only):** | Method | Endpoint | Description | |---|---|---| |
`GET` | `/api/v3/releaseprofile` | List release profiles | | `POST` | `/api/v3/releaseprofile` |
Create release profile | | `PUT` | `/api/v3/releaseprofile/{id}` | Update release profile | |
`DELETE` | `/api/v3/releaseprofile/{id}` | Delete release profile |

#### Sonarr-Specific Differences from Radarr

- **No language on quality profile**: Sonarr uses Custom Formats for language matching instead of a
  profile-level language setting.
- **Additional quality profile fields** (Sonarr v4): `minUpgradeFormatScore`, `cutoffFormatScore` --
  same as Radarr.
- **Episode naming** vs movie naming: Sonarr has `standard`, `daily`, and `anime` episode formats
  plus `series`/`season` folder formats.
- **Release profiles**: Only functional in Sonarr v3. Sonarr v4 replaced Preferred Words with Custom
  Formats.
- **Custom formats**: Not available in Sonarr v3 at all; this is v4+ only.
- **Minimum version**: Recyclarr requires Sonarr >= v4.0.0 (dropped v3 support in Recyclarr v7.0).

**Confidence**: High -- from OpenAPI spec and Recyclarr compatibility docs.

---

### API Rate Limiting and Constraints

- **No formal rate limits**: Radarr and Sonarr do not enforce explicit API rate limits on their own
  REST APIs. They are local services designed for trusted network access.
- **Practical concerns**: Pushing many changes simultaneously (e.g., 100+ custom format creates) can
  cause temporary UI unresponsiveness. Both Recyclarr and Configarr process sequentially within each
  entity type.
- **Recommended approach**: Sequential processing per entity type, reasonable delays (100-200ms)
  between operations for large batches, concurrent processing across different Arr instances.
- **Indexer rate limits**: Separate concern -- indexer APIs (Prowlarr, etc.) have strict limits, but
  Arr instance APIs do not.
- **Connection testing**: Always validate connection (`GET /api/v3/system/status` or `GET /ping`)
  before sync operations.

**Confidence**: Medium -- no official documentation on rate limits; based on community experience
and competitor behavior.

---

## Competitor Analysis

### Recyclarr

- **Repository**: [recyclarr/recyclarr](https://github.com/recyclarr/recyclarr)
- **Documentation**: [recyclarr.dev](https://recyclarr.dev/)
- **DeepWiki**: [recyclarr/recyclarr](https://deepwiki.com/recyclarr/recyclarr)
- **Technology**: C# / .NET 10, CLI application
- **License**: MIT

**Confidence**: High -- extensive official documentation and source code analysis.

#### Architecture

Recyclarr implements a **modular pipeline-based architecture** using Autofac for DI:

```
CLI Entry (Spectre.Console.Cli)
  -> SyncProcessor (orchestrator)
    -> Feature Pipelines (per entity type)
      -> 5 Phases per pipeline
    -> External Services (TRaSH repo, Arr APIs)
```

**Pipeline pattern (GenericSyncPipeline\<TContext\>):**

1. **Config Phase** -- Parse/validate YAML, transform to processable objects
2. **Fetch Phase** -- Retrieve data from TRaSH Guides repo + current Arr state
3. **Transaction Phase** -- Compare desired vs current state, build change plan
4. **Persist Phase** -- Execute API calls to create/update/delete
5. **Preview Phase** -- Display proposed changes (when `--preview` flag used)

Each phase receives and returns a pipeline context object.

#### Data Flow

```
TRaSH Guides Git Repo (clone/pull)
  -> Parse JSON files (via metadata.json paths)
    -> Match trash_ids to user's YAML config
      -> Fetch current state from Arr API
        -> Diff desired vs current
          -> Generate create/update/delete operations
            -> Execute API calls
```

#### Sync Strategy

- **Pull-based from TRaSH Guides**: Clones or updates local copy of the TRaSH Guides git repository
- **Push-based to Arr instances**: Makes API calls to sync desired state
- **Per-instance configs**: Each Arr instance gets independent configuration
- **Deterministic operations**: Same config always produces same result
- **Independent pipelines**: CF pipeline can fail without blocking quality profile pipeline
- **Dependent pipelines**: When CFs are required by quality profiles, failure cascades intentionally

#### Configuration (YAML)

Recyclarr uses YAML configuration with JSON schema validation:

```yaml
radarr:
  movies:
    base_url: !secret radarr_url
    api_key: !secret radarr_apikey

    # Quality definitions (file sizes)
    quality_definition:
      type: movie
      preferred_ratio: 0.5 # 0.0-1.0 interpolation

    # Quality profiles
    quality_profiles:
      - trash_id: d1d67249d3890e49bc12e275d989a7e9 # Guide-backed
        reset_unmatched_scores:
          enabled: true
      - name: 'Custom Profile' # Manual profile
        upgrade:
          allowed: true
          until_quality: Remux-1080p
          until_score: 10000
        min_format_score: 0
        qualities:
          - name: Remux-1080p
          - name: WEB 1080p
            qualities:
              - WEBDL-1080p
              - WEBRip-1080p

    # Custom formats
    delete_old_custom_formats: false
    custom_formats:
      - trash_ids:
          - b6832f586342ef70d9c128d40c07b872
          - 47435ece6b99a0b477caf360e79ba0bb
        assign_scores_to:
          - name: HD Bluray + WEB
            score: -10000 # Override guide default

    # Custom format groups
    custom_format_groups:
      skip:
        - some-group-trash-id
      add:
        - trash_id: another-group-id
          assign_scores_to:
            - name: My Profile

    # Media naming
    media_naming:
      folder: plex-tmdb
      movie:
        rename: true
        standard: plex-tmdb

    # Media management
    media_management:
      propers_and_repacks: do-not-prefer
```

Configuration schema:
[config-schema.json](https://raw.githubusercontent.com/recyclarr/recyclarr/master/schemas/config-schema.json)

#### Sync Behavior Details

**Custom Format sync:**

- Creates new CFs not present on Arr instance
- Updates existing CFs that differ from guide
- Optionally deletes CFs removed from config (`delete_old_custom_formats: true`)
- Only manages CFs it created (tracks via cache); manually-created CFs are safe
- `replace_existing_custom_formats: true` overrides even manually-created same-name CFs

**Quality Profile sync:**

- Guide-backed profiles (by `trash_id`): auto-sync qualities, score sets, CF scores
- Manual profiles (by `name`): user controls all settings
- `reset_unmatched_scores`: zeros out CF scores not in config
- `score_set`: selects which `trash_scores` column to use (e.g., `"sqp-1-1080p"`)

**Quality Definitions sync:**

- `preferred_ratio`: 0.0-1.0 interpolation between min and max
- Individual quality overrides possible

**Media Naming sync:**

- Maps naming "keys" (e.g., `plex-tmdb`) to TRaSH naming templates
- Unspecified properties are not synced (preserves manual settings)

#### Strengths

- Mature, battle-tested (thousands of users)
- Comprehensive YAML configuration with schema validation
- Preview mode for safe dry-runs
- Detailed logging and error reporting
- Template and include system for config reuse
- Secrets management
- CLI `list` commands for discovery

#### Weaknesses

- CLI-only (no web UI)
- No real-time monitoring or status dashboard
- Configuration requires YAML editing
- No conflict visualization
- No per-entity granular override UI
- Requires separate scheduling (cron/Docker)

---

### Configarr

- **Repository**: [raydak-labs/configarr](https://github.com/raydak-labs/configarr)
- **Documentation**: [configarr.de](https://configarr.de/)
- **DeepWiki**: [raydak-labs/configarr](https://deepwiki.com/raydak-labs/configarr)
- **Technology**: TypeScript (98.4%), esbuild, Vitest, Playwright
- **License**: MIT

**Confidence**: High -- source code and documentation reviewed.

#### Architecture

```
YAML Config Loading (custom tag resolution: !secret, !env, !file)
  -> Template Merging (5-level precedence)
    -> Processing (CF, Quality Def, Quality Profile pipelines)
      -> Unified API Client (per Arr type)
        -> Apply to Arr instances
```

**Unified Client abstraction:**

- `IArrClient` interface with implementations: `SonarrClient`, `RadarrClient`, `WhisparrClient`,
  `ReadarrClient`, `LidarrClient`
- HTTP via `ky` library
- API types generated via `swagger-typescript-api`
- Validation: `zod` for config, connection testing before processing

#### Data Flow

```
TRaSH-Guides Repo (cloneTrashRepo())
  + Recyclarr Templates (cloneRecyclarrTemplateRepo())
    + Local Files
      + Global Config
        + Instance Config
          = MergedConfigInstance
            -> Process CFs, Quality Defs, Quality Profiles
              -> Unified API Client
                -> Arr Instance
```

#### Merge Precedence (highest wins)

| Priority    | Source              | Notes                        |
| ----------- | ------------------- | ---------------------------- |
| 1 (lowest)  | TRaSH-Guides        | Foundation standards         |
| 2           | Recyclarr Templates | Structured community configs |
| 3           | Local Files         | User's template files        |
| 4           | Global Config       | App-type-wide settings       |
| 5 (highest) | Instance Config     | Per-instance overrides       |

For same `trash_id`: later source overrides earlier. For profiles: same-named profiles deep-merged.

#### Sync Strategy

- **CF Processing**: `transformTrashCFGroups()` -> individual CF assignments -> scoring via
  `mapQualityProfiles()` -> deduplication
- **Quality Profile**: `loadQualityProfilesFromServer()` -> `mapQualityProfiles()` ->
  `mapQualities()` -> compare -> create/update
- **Operations sequence**: rename -> clone -> score assignment (sequential per profile)
- **Recyclarr template compatibility**: Can use Recyclarr YAML templates directly

#### Configuration

```yaml
trashGuideUrl: https://github.com/TRaSH-Guides/Guides # Override fork URL
recyclarrConfigUrl: https://github.com/recyclarr/config-templates
trashRevision: main
recyclarrRevision: develop

sonarr:
  instance1:
    base_url: !secret SONARR_URL
    api_key: !secret SONARR_API_KEY
    enabled: true

    include:
      - template: sonarr-quality-template
      - template: d1498e7d189fbe6c7110ceaabb7473e6
        source: TRASH

    quality_definition:
      qualities:
        - quality: 'HDTV-720p'
          min: 17.1
          preferred: 500
          max: 1000

    quality_profiles:
      - name: WEB-1080p
        reset_unmatched_scores:
          enabled: true
        upgrade:
          allowed: true
          until_quality: Remux-1080p
          until_score: 10000
          min_format_score: 100

    custom_formats:
      - trash_ids:
          - 47435ece6b99a0b477caf360e79ba0bb
        assign_scores_to:
          - name: WEB-1080p
            score: 0

    customFormatDefinitions: # Inline CF definitions
      - trash_id: custom-id
        name: 'My Custom Format'
        specifications:
          - name: Spec
            implementation: LanguageSpecification
            fields:
              value: 4

    media_naming:
      series: default
      season: default
      episodes:
        rename: true
        standard: default

    delete_unmanaged_custom_formats:
      enabled: true
      ignore:
        - some-cf-to-keep

    delete_unmanaged_quality_profiles:
      enabled: true
```

#### Additional Syncable Settings (beyond Recyclarr)

- **Delay Profiles** -- protocol preferences, delays, tag-based rules
- **Download Clients** (v1.19+) -- qBittorrent, Transmission, SABnzbd
- **Root Folders** -- directory management
- **Remote Path Mappings** (v1.20+) -- download client path remapping
- **UI Config** (v1.21+) -- theme, language, calendar preferences

#### Strengths

- TypeScript (closer to Praxrr's stack)
- Broader Arr support (Whisparr, Readarr, Lidarr experimental)
- Recyclarr template compatibility
- Inline custom format definitions
- More syncable settings (delay profiles, download clients, root folders)
- Modern tooling (esbuild, Vitest)

#### Weaknesses

- Less mature than Recyclarr
- Container-only deployment model (Docker/Kubernetes)
- No web UI (YAML config only)
- No preview/dry-run mode documented
- Less community documentation

---

## Integration Patterns

### TRaSH Guide Data Mapping to Arr API Payloads

**Confidence**: High -- verified across Recyclarr and Configarr implementations.

#### Custom Format: TRaSH JSON -> Arr API

```
TRaSH CF JSON                    Arr API POST /api/v3/customformat
-----------                      --------------------------------
trash_id                    -->  (stored in Praxrr PCD for tracking, NOT sent to Arr)
trash_scores                -->  (used during quality profile score assignment)
trash_description           -->  (stored in PCD, not sent to Arr)
trash_regex                 -->  (stored in PCD, not sent to Arr)
name                        -->  name
includeCustomFormatWhenRenaming --> includeCustomFormatWhenRenaming
specifications[].name       -->  specifications[].name
specifications[].implementation --> specifications[].implementation
specifications[].negate     -->  specifications[].negate
specifications[].required   -->  specifications[].required
specifications[].fields     -->  specifications[].fields
```

Key: The `trash_id` and `trash_scores` fields are TRaSH-specific metadata stripped before sending to
the Arr API. The Arr assigns its own numeric `id` on creation. Praxrr must maintain a mapping:
`trash_id <-> arr_instance_cf_id`.

#### Quality Profile: TRaSH JSON -> Arr API

```
TRaSH QP JSON                   Arr API PUT /api/v3/qualityprofile/{id}
-----------                      --------------------------------
trash_id                    -->  (PCD tracking only)
trash_score_set             -->  (selects which trash_scores column to use)
name                        -->  name
upgradeAllowed              -->  upgradeAllowed
cutoff (name)               -->  cutoff (resolved to quality ID via schema)
minFormatScore              -->  minFormatScore
cutoffFormatScore           -->  cutoffFormatScore
minUpgradeFormatScore       -->  minUpgradeFormatScore
language                    -->  language (Radarr only, resolved to language ID)
items[]                     -->  items[] (qualities resolved to IDs via schema)
formatItems[]               -->  formatItems[] (CFs resolved to instance IDs)
```

Critical: Quality and CF names must be resolved to instance-specific numeric IDs. Use
`/api/v3/qualityprofile/schema` and `/api/v3/customformat` to build lookup tables.

#### Quality Definition: TRaSH JSON -> Arr API

```
TRaSH Quality-Size JSON          Arr API PUT /api/v3/qualitydefinition/{id}
-----------                      --------------------------------
type                        -->  (selects which definitions to update)
qualities[].quality         -->  (matched by name to existing definitions)
qualities[].min             -->  minSize
qualities[].preferred       -->  preferredSize (interpolated via preferred_ratio)
qualities[].max             -->  maxSize
```

Note: Quality definitions cannot be created or deleted via API -- only existing definitions can be
updated. The set of available qualities is fixed per Arr installation.

#### Naming Config: TRaSH JSON -> Arr API

```
TRaSH Naming JSON                Arr API PUT /api/v3/config/naming/{id}
-----------                      --------------------------------
(Radarr)
folder[key]                 -->  movieFolderFormat
file.standard[key]          -->  standardMovieFormat
(rename flag)               -->  renameMovies

(Sonarr)
series[key]                 -->  seriesFolderFormat
season[key]                 -->  seasonFolderFormat
episodes.standard[key]      -->  standardEpisodeFormat
episodes.daily[key]         -->  dailyEpisodeFormat
episodes.anime[key]         -->  animeEpisodeFormat
(rename flag)               -->  renameEpisodes
```

### Merge Strategies

**Confidence**: High -- both competitors implement similar patterns.

#### Strategy 1: Overwrite (Recyclarr Default)

- Guide data takes precedence for managed entities
- User-created entities are untouched
- Tracked via internal cache (trash_id -> arr_id mapping)
- `reset_unmatched_scores: true` zeros out unmanaged CF scores

**Best for:** Users who want guide-recommended settings as-is.

#### Strategy 2: Merge with Override (Configarr Model)

- 5-level precedence hierarchy (TRaSH -> templates -> local -> global -> instance)
- Same `trash_id` in later source overrides earlier
- Same-named profiles are deep-merged
- Individual field overrides possible

**Best for:** Users who want guide defaults but need per-instance tweaks.

#### Strategy 3: PCD-Native (Praxrr Opportunity)

- TRaSH guide data becomes base ops in PCD
- User overrides become user ops (existing Praxrr pattern)
- Conflict detection via value guards (existing Praxrr infrastructure)
- Visual diff/merge UI possible in web interface

**Best for:** Leveraging Praxrr's existing PCD architecture for superior conflict handling.

### Score Mapping

Custom format scores flow through two levels:

1. **Score Set Selection**: Quality profile specifies `trash_score_set` (e.g., `"sqp-1-1080p"`)
2. **Score Lookup**: Each CF's `trash_scores` object is consulted for the score-set key. Falls back
   to `"default"` if key missing.

```
Quality Profile: score_set = "sqp-1-1080p"
Custom Format: trash_scores = { "default": 75, "sqp-1-1080p": 150 }
  -> Score assigned: 150

Quality Profile: score_set = "default"
Custom Format: trash_scores = { "default": 75, "sqp-1-1080p": 150 }
  -> Score assigned: 75
```

Score ranges in practice:

- **+1500 to +2000**: Top-tier sources (e.g., Remux, best release groups)
- **+500 to +1500**: High-quality sources
- **+1 to +500**: Preferred characteristics
- **0**: Informational / neutral
- **-1 to -100**: Mild avoidance
- **-10000**: Strong rejection (effectively blocked)

### Quality Profile Composition

1. Fetch quality profile template from TRaSH guide (by `trash_id`)
2. Resolve quality names to instance IDs (via `/api/v3/qualityprofile/schema`)
3. Create/update custom formats referenced by the profile
4. Map CF `trash_id` to instance CF `id` for `formatItems`
5. Apply user score overrides
6. Push complete profile to Arr API

**Dependency order matters**: Custom formats must exist before quality profiles can reference them.

---

## Libraries and SDKs

### For Deno/TypeScript (Praxrr Stack)

**Confidence**: High -- Deno standard library and established npm packages.

#### Git Operations

Praxrr already has git utilities at `$utils/git/` using `Deno.Command('git', ...)` for process
execution. This is the recommended approach for TRaSH guide repo clone/pull:

```typescript
// Existing pattern in packages/praxrr-app/src/lib/server/utils/git/exec.ts
export async function execGit(args: string[], cwd: string): Promise<string> {
  const command = new Deno.Command('git', {
    args,
    cwd,
    stdout: 'piped',
    stderr: 'piped',
    env: {
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: 'echo',
      GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
    },
  });
  // ...
}
```

**Alternative**: [isomorphic-git](https://isomorphic-git.org/) -- pure JS git implementation, works
in Deno, but adds significant dependency weight. Not recommended since Praxrr already uses shell
git.

#### YAML Parsing

Deno standard library includes YAML support:

```typescript
import { parse, stringify } from 'jsr:@std/yaml';
// or for npm compatibility:
import { parse, stringify } from '@std/yaml';
```

Also available: [yaml@v2.8.x on deno.land/x](https://deno.land/x/yaml) (js-yaml port with more
features like custom tags).

For Recyclarr config compatibility (custom tags like `!secret`, `!env`, `!file`), the more
full-featured `yaml` library may be needed.

#### JSON Parsing

Native `JSON.parse()` / `JSON.stringify()` -- no library needed for TRaSH guide JSON files.

#### HTTP Client

Praxrr already has HTTP client infrastructure at `$http/` and Arr clients at `$arr/`. These should
be extended rather than replaced.

#### Schema Validation

Consider `zod` (used by Configarr) for runtime validation of TRaSH guide data structures. Available
via `npm:zod` in Deno.

---

## Constraints and Gotchas

### 1. Radarr vs Sonarr API Semantic Differences

**Impact**: Must maintain separate transformation logic per Arr type.

- **Language handling**: Radarr = profile-level language; Sonarr = Custom Format language specs
- **Release profiles**: Deprecated in both (replaced by CFs) but API endpoints still exist
- **Custom formats**: Not available in Sonarr v3 (v4+ only)
- **Naming tokens**: Completely different between Radarr (movie) and Sonarr (episode/series)
- **Quality names**: Some quality names differ between Radarr and Sonarr (verify per
  `qualityprofile/schema`)

**Workaround**: Separate transformation pipelines per `arr_type`, consistent with Praxrr's existing
Cross-Arr Semantic Validation Policy.

**Confidence**: High.

### 2. trash_id to Arr Instance ID Resolution

**Impact**: Core challenge for sync implementation.

- TRaSH CFs use `trash_id` (MD5 hash), Arr instances use numeric `id`
- Must maintain persistent mapping table: `(trash_id, instance_id) -> arr_cf_id`
- Matching on CF name is fragile (names can change across guide versions)
- Recyclarr uses a cache file; Configarr uses `carrIdMapping`

**Workaround**: Store `trash_id -> arr_id` mapping in PCD or app database per instance.

**Confidence**: High.

### 3. Quality ID Resolution

**Impact**: Quality profiles reference qualities by numeric ID, not name.

- Quality IDs are not consistent across Arr installations
- Must call `/api/v3/qualityprofile/schema` to get current quality ID mappings
- TRaSH guide quality profiles reference qualities by name; must resolve to IDs

**Workaround**: Build quality name-to-ID lookup from schema endpoint at sync time.

**Confidence**: High.

### 4. TRaSH Guide Data Versioning

**Impact**: Guide data changes upstream; must handle gracefully.

- No formal versioning -- guide uses git commits on `master` branch
- `trash_id` is stable across versions (hash of name)
- CF specifications (regex patterns, etc.) change frequently
- New CFs added, old ones occasionally removed
- Quality profile recommendations evolve

**Workaround**: Git-based change detection (diff between cached and pulled versions). TRaSH Guides
repo tracks changes via commit history.

**Confidence**: Medium -- no formal versioning contract.

### 5. Dependency Ordering During Sync

**Impact**: Quality profiles depend on custom formats existing first.

- CFs must be created/updated BEFORE quality profiles that reference them
- CF score assignment in profiles requires CF instance IDs
- Deleting a CF that is referenced by a profile will fail

**Workaround**: Strict sync ordering: CFs -> Quality Definitions -> Quality Profiles -> Naming ->
Media Management. Recyclarr handles this via independent vs dependent pipeline distinction.

**Confidence**: High.

### 6. No Bulk Quality Definition Update

**Impact**: Quality definitions must be updated one at a time.

- No bulk endpoint exists for quality definitions
- Each quality definition has a fixed ID per installation
- Only `min`, `preferred`, `max` can be updated

**Workaround**: Sequential updates with quality name-to-ID resolution. Minimal API calls (typically
20-30 quality definitions total).

**Confidence**: High.

### 7. CF Score of 0 is Semantically Distinct

**Impact**: TRaSH Guides CONTRIBUTING.md states "Default scores of 0 are FORBIDDEN."

- A CF with score 0 means "informational only, no impact on selection"
- Missing `trash_scores.default` means the CF has no default score
- `reset_unmatched_scores` zeros out scores for CFs not in config

**Workaround**: Distinguish between "score is 0" and "no score assigned" in the data model.

**Confidence**: High.

### 8. Large Batch Sync Performance

**Impact**: First sync of a fresh Arr instance may involve 100+ CF creates.

- Each CF create is an individual API call
- No true bulk create endpoint (bulk update/delete only)
- Radarr/Sonarr may become temporarily unresponsive during heavy writes

**Workaround**: Sequential processing with small delays (50-100ms). Progress reporting via job
status. Consider batching by entity type.

**Confidence**: Medium.

---

## All Syncable Settings Catalog

### Radarr

| Category               | TRaSH Guide Source                                    | Arr API Endpoint                          | Sync Direction |
| ---------------------- | ----------------------------------------------------- | ----------------------------------------- | -------------- |
| Custom Formats         | `docs/json/radarr/cf/*.json`                          | `POST/PUT/DELETE /api/v3/customformat`    | PCD -> Arr     |
| Custom Format Groups   | `docs/json/radarr/cf-groups/*.json`                   | (Expanded to individual CFs)              | PCD -> Arr     |
| Quality Profiles       | `docs/json/radarr/quality-profiles/*.json`            | `POST/PUT /api/v3/qualityprofile`         | PCD -> Arr     |
| Quality Profile Groups | `docs/json/radarr/quality-profile-groups/groups.json` | (Organizational metadata only)            | Display only   |
| Quality Definitions    | `docs/json/radarr/quality-size/*.json`                | `PUT /api/v3/qualitydefinition/{id}`      | PCD -> Arr     |
| Media Naming           | `docs/json/radarr/naming/radarr-naming.json`          | `PUT /api/v3/config/naming/{id}`          | PCD -> Arr     |
| Media Management       | (Propers/Repacks config)                              | `PUT /api/v3/config/mediamanagement/{id}` | PCD -> Arr     |
| Release Profiles       | (Deprecated, legacy support)                          | `POST/PUT/DELETE /api/v3/releaseprofile`  | Optional       |

### Sonarr

| Category               | TRaSH Guide Source                                    | Arr API Endpoint                          | Sync Direction  |
| ---------------------- | ----------------------------------------------------- | ----------------------------------------- | --------------- |
| Custom Formats         | `docs/json/sonarr/cf/*.json`                          | `POST/PUT/DELETE /api/v3/customformat`    | PCD -> Arr      |
| Custom Format Groups   | `docs/json/sonarr/cf-groups/*.json`                   | (Expanded to individual CFs)              | PCD -> Arr      |
| Quality Profiles       | `docs/json/sonarr/quality-profiles/*.json`            | `POST/PUT /api/v3/qualityprofile`         | PCD -> Arr      |
| Quality Profile Groups | `docs/json/sonarr/quality-profile-groups/groups.json` | (Organizational metadata only)            | Display only    |
| Quality Definitions    | `docs/json/sonarr/quality-size/*.json`                | `PUT /api/v3/qualitydefinition/{id}`      | PCD -> Arr      |
| Media Naming           | `docs/json/sonarr/naming/sonarr-naming.json`          | `PUT /api/v3/config/naming/{id}`          | PCD -> Arr      |
| Media Management       | (Propers/Repacks config)                              | `PUT /api/v3/config/mediamanagement/{id}` | PCD -> Arr      |
| Release Profiles       | (Sonarr v3 only, legacy)                              | `POST/PUT/DELETE /api/v3/releaseprofile`  | Optional/Legacy |

### Additional Settings (Configarr extends beyond TRaSH Guides)

| Category             | Applicable Apps | Notes                              |
| -------------------- | --------------- | ---------------------------------- |
| Delay Profiles       | All             | Protocol preferences, delays, tags |
| Download Clients     | All             | qBittorrent, Transmission, SABnzbd |
| Root Folders         | All             | Media directory management         |
| Remote Path Mappings | All             | Download client path remapping     |
| UI Configuration     | All             | Theme, language, calendar          |

---

## Praxrr Integration Advantages

Praxrr has significant existing infrastructure that competitors lack:

1. **PCD ops system**: TRaSH guide data can become base ops; user tweaks become user ops. This is
   architecturally superior to Recyclarr's flat cache or Configarr's merge hierarchy -- it provides
   full audit trail, conflict detection, and rollback.

2. **Existing sync pipeline**: `BaseSyncer` at `$sync/base.ts` already implements
   fetch-transform-push pattern for custom formats, quality profiles, delay profiles, and media
   management.

3. **Arr client infrastructure**: `$arr/clients/radarr.ts`, `$arr/clients/sonarr.ts` already exist
   with typed HTTP clients.

4. **Git utilities**: `$utils/git/exec.ts` provides sandboxed git command execution, already used
   for PCD repo management.

5. **Job queue**: `$jobs/` provides scheduled execution, dispatcher, and queue management. The
   `pcdSync` handler already exists.

6. **Web UI**: Unlike CLI-only competitors, Praxrr can provide visual diff previews, conflict
   resolution UI, sync status monitoring, and granular entity-level override controls.

7. **Preview system**: `$sync/preview/` already has diff computation, section diffs, and
   orchestration for sync preview.

---

## Open Questions

1. **PCD integration depth**: Should TRaSH guide data be ingested as PCD base ops (full integration
   with existing conflict/override system) or maintained as a parallel data source with a separate
   cache?

2. **Recyclarr config compatibility**: Should Praxrr support importing Recyclarr YAML configs?
   Configarr already does this, and it would lower the migration barrier.

3. **Custom PCD repos vs TRaSH Guides**: Praxrr already supports custom PCD databases. Should TRaSH
   guide sync be treated as "just another PCD database" or as a first-class separate feature?

4. **Sync granularity**: Should users be able to sync individual CFs/profiles selectively, or only
   in batches per entity type? The existing PCD entity system supports individual entity management.

5. **Deletion policy**: When a TRaSH guide removes a CF, should Praxrr auto-delete it from Arr
   instances? Recyclarr defaults to "no" (opt-in via `delete_old_custom_formats`). What should
   Praxrr's default be?

6. **Multi-instance sync coordination**: When the same profile is assigned to multiple Arr
   instances, should changes propagate atomically (all-or-nothing) or individually?

7. **Sonarr v3 support**: Recyclarr dropped Sonarr v3 in v7.0. Should Praxrr support Sonarr v3 (no
   custom formats) or require v4+?

8. **Lidarr/Readarr/Whisparr**: Configarr has experimental support. Given Praxrr already has a
   Lidarr client, should TRaSH guide sync extend to non-standard Arr apps?

---

## Search Queries Executed

1. TRaSH Guides GitHub repository structure JSON data format custom formats
2. Recyclarr architecture data flow TRaSH guides sync Radarr Sonarr
3. Configarr TRaSH guides TypeScript sync architecture GitHub
4. Radarr API v3 endpoints quality profiles custom formats documentation
5. Sonarr API v3 endpoints quality profiles custom formats release profiles documentation
6. Sonarr API v4 openapi specification endpoints custom format quality profile naming
7. Configarr source code custom format sync implementation TypeScript raydak-labs
8. TRaSH Guides custom format JSON example structure trash_id trash_scores
9. Recyclarr YAML configuration schema quality_definition media_naming
10. Deno git clone library isomorphic-git TypeScript
11. YAML parser library Deno 2 TypeScript jsr deno.land
12. TRaSH Guides quality-size quality definition JSON format
13. TRaSH Guides naming convention JSON format
14. TRaSH Guides quality profile JSON format
15. Radarr Sonarr API differences custom format quality profile
16. Recyclarr media naming configuration YAML reference
17. Recyclarr quality definition type configuration reference
18. Recyclarr media management proper repack configuration
19. Radarr Sonarr API rate limiting throttling
20. Radarr API authentication X-Api-Key header
21. TRaSH Guides cf-groups custom format groups JSON structure
22. TRaSH Guides quality-profile-groups JSON structure
23. Recyclarr delete old custom formats sync behavior
24. Radarr API quality profile resource JSON structure
25. Sonarr API quality profile resource schema
26. Radarr API config naming resource properties

---

## Uncertainties and Gaps

- **CF group JSON schema**: The exact schema for `cf-groups/` files is not fully documented in
  CONTRIBUTING.md. Structure inferred from Recyclarr/Configarr behavior. **(Low Confidence)**
- **Quality profile group schema**: The `quality-profile-groups/groups.json` structure is inferred
  from secondary sources. **(Medium Confidence)**
- **Arr API rate behavior**: No formal rate limit documentation exists for Radarr/Sonarr APIs.
  Practical limits are based on community experience. **(Medium Confidence)**
- **Sonarr v5 API**: Sonarr is developing a v5 API. The v3 endpoints remain stable for now, but
  future migration may be needed. **(Low Confidence on timeline)**
- **TRaSH Guides breaking changes**: No SemVer or formal compatibility contract. Changes are tracked
  via git commits only. **(Medium Confidence on stability)**
- **Exact Arr API response schemas**: Full request/response body schemas for all endpoints were not
  fully extracted (OpenAPI spec is very large). The type definitions provided are synthesized from
  multiple sources. **(Medium Confidence)**

---

## Sources

### Primary

- [TRaSH-Guides/Guides Repository](https://github.com/TRaSH-Guides/Guides)
- [TRaSH Guides metadata.json](https://github.com/TRaSH-Guides/Guides/blob/master/metadata.json)
- [TRaSH Guides metadata.schema.json](https://github.com/TRaSH-Guides/Guides/blob/master/metadata.schema.json)
- [TRaSH Guides CONTRIBUTING.md](https://github.com/TRaSH-Guides/Guides/blob/master/CONTRIBUTING.md)
- [Radarr OpenAPI Spec](https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json)
- [Sonarr OpenAPI Spec](https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/Sonarr.Api.V3/openapi.json)
- [Radarr API Docs](https://radarr.video/docs/api/)
- [Sonarr API Docs](https://sonarr.tv/docs/api/)
- [Radarr API Wiki](https://github.com/Radarr/Radarr/wiki/API)

### Competitor Analysis

- [Recyclarr Repository](https://github.com/recyclarr/recyclarr)
- [Recyclarr Documentation](https://recyclarr.dev/)
- [Recyclarr Config Reference](https://recyclarr.dev/wiki/yaml/config-reference/)
- [Recyclarr Custom Formats Reference](https://recyclarr.dev/reference/configuration/custom-formats/)
- [Recyclarr Quality Profiles Reference](https://recyclarr.dev/reference/configuration/quality-profiles/)
- [Recyclarr Quality Definitions Reference](https://recyclarr.dev/reference/configuration/quality-definition/)
- [Recyclarr Media Naming Reference](https://recyclarr.dev/wiki/yaml/config-reference/media-naming/)
- [Recyclarr Features](https://recyclarr.dev/wiki/features/)
- [Recyclarr TRaSH Guides Structure](https://recyclarr.dev/reference/settings/resource-providers/trash-guides-structure/)
- [Recyclarr DeepWiki](https://deepwiki.com/recyclarr/recyclarr)
- [Configarr Repository](https://github.com/raydak-labs/configarr)
- [Configarr Documentation](https://configarr.de/)
- [Configarr Config File Reference](https://configarr.de/docs/configuration/config-file/)
- [Configarr DeepWiki](https://deepwiki.com/raydak-labs/configarr)

### TRaSH Guides Analysis

- [TRaSH Guides Website](https://trash-guides.info/)
- [TRaSH Guides Guide-Sync](https://trash-guides.info/Guide-Sync/)
- [TRaSH Guides DeepWiki](https://deepwiki.com/TRaSH-Guides/Guides)
- [Radarr Quality Profiles Setup DeepWiki](https://deepwiki.com/TRaSH-Guides/Guides/3.2-radarr-quality-profiles)
- [Radarr Naming JSON](https://github.com/TRaSH-Guides/Guides/blob/master/docs/json/radarr/naming/radarr-naming.json)
- [Sonarr Naming JSON](https://github.com/TRaSH-Guides/Guides/blob/master/docs/json/sonarr/naming/sonarr-naming.json)
- [SQP-1 1080p Profile Example](https://github.com/TRaSH-Guides/Guides/blob/master/docs/json/radarr/quality-profiles/sqp-1-1080p.json)

### Libraries

- [Deno YAML Parsing](https://docs.deno.com/examples/parsing_serializing_yaml/)
- [isomorphic-git](https://isomorphic-git.org/)
- [Radarr REST API DeepWiki](https://deepwiki.com/radarr/radarr/4.1-rest-api)
- [Sonarr API and Startup DeepWiki](https://deepwiki.com/Sonarr/Sonarr/2.2-api-and-application-startup)
- [Servarr Wiki - Radarr Settings](https://wiki.servarr.com/radarr/settings)
- [Servarr Wiki - Sonarr Settings](https://wiki.servarr.com/sonarr/settings)
