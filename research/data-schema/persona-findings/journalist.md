# Journalist Persona: Landscape Investigation

## PCD Ingestion Format Migration: SQL Ops vs JSON/YAML

**Investigator**: Journalist Persona (Research Specialist)
**Date**: 2026-02-22
**Subject**: Should Praxrr's PCD ingestion data format migrate from SQL ops files to JSON/YAML for the ingestion layer (praxrr-db, praxrr-schema repos), while keeping the runtime SQLite cache?

---

## Executive Summary

The Arr ecosystem configuration management landscape is fragmented across four main tools, each using different data formats: TRaSH-Guides (JSON), Recyclarr (YAML), Configarr (YAML), and Profilarr/Praxrr (SQL ops). The broader configuration format debate shows no single winner -- JSON dominates API interchange (74% of APIs), YAML dominates DevOps configuration (55% developer preference), and SQL remains the strongest for relational constraint enforcement. Newer alternatives (TOML, CUE, Pkl) solve specific pain points but lack ecosystem adoption in this domain. JSON Schema has reached significant maturity (60M+ weekly downloads, Draft 2020-12) but remains a validation tool, not a data definition language. YAML's well-documented pitfalls (Norway problem, implicit coercion, billion laughs) are real but partially mitigated in YAML 1.2 and by StrictYAML-style approaches.

---

## 1. TRaSH-Guides Format Deep Dive

### JSON File Structure

TRaSH-Guides stores all configuration data as **individual JSON files** organized by application type. Each custom format is a standalone JSON file.

**Confidence**: High (verified against official CONTRIBUTING.md and multiple consumers)

#### Custom Format JSON Structure

```json
{
  "trash_id": "cae4ca30163749b891686f95532519bd",
  "trash_scores": {
    "default": -10000,
    "sqp-1-2160p": -10000,
    "anime-radarr": -10000,
    "german": -35000
  },
  "trash_regex": "https://regex101.com/r/example",
  "trash_description": "Description of what this CF matches",
  "name": "AV1",
  "includeCustomFormatWhenRenaming": false,
  "specifications": [
    {
      "name": "AV1",
      "implementation": "ReleaseTitleSpecification",
      "negate": false,
      "required": true,
      "fields": {
        "value": "\\bAV1\\b"
      }
    }
  ]
}
```

Key observations:

- **`trash_id`** is an MD5 hash generated from a naming convention (e.g., MD5 of `CF_name` for Radarr, MD5 of `Sonarr CF_name` for Sonarr). This is the canonical identifier across all consuming tools.
- **`trash_scores`** maps profile names to numeric scores. Default scores of 0 are forbidden.
- The file is essentially a Starr API export with `trash_*` prefix fields prepended.
- Files are one-entity-per-file: one CF per JSON file.

Sources:

- [TRaSH-Guides CONTRIBUTING.md](https://github.com/TRaSH-Guides/Guides/blob/master/CONTRIBUTING.md)
- [TRaSH-Guides Collection of Custom Formats](https://trash-guides.info/Radarr/Radarr-collection-of-custom-formats/)

#### Quality Profile JSON Structure

```json
{
  "trash_id": "<MD5 hash of profile name>",
  "name": "Profile Name",
  "trash_description": "HTML-formatted description",
  "group": 1,
  "upgradeAllowed": true,
  "cutoff": 21,
  "minFormatScore": 10,
  "cutoffFormatScore": 10000,
  "minUpgradeFormatScore": 1,
  "language": "Any",
  "items": ["<quality sources list>"],
  "formatItems": ["<mandatory custom format references>"]
}
```

Key observations:

- The `group` field determines sort order (1-9 English, 11-19 German, 81-89 Anime, etc.)
- `formatItems` contains only mandatory CFs; optional cf-groups are excluded
- Profile JSON also mirrors the Starr API export format

**Confidence**: High

#### Repository Directory Structure

```
docs/json/
  radarr/
    cf/           # Custom format JSON files
    quality-size/ # Quality definition files
    naming/       # Media naming pattern files
  sonarr/
    cf/
    quality-size/
    naming/
```

A root `metadata.json` directs consumers to resource locations:

```json
{
  "json_paths": {
    "radarr": {
      "custom_formats": ["docs/json/radarr/cf"],
      "qualities": ["docs/json/radarr/quality-size"],
      "naming": ["docs/json/radarr/naming"]
    }
  }
}
```

Sources:

- [Recyclarr TRaSH-Guides Structure Reference](https://recyclarr.dev/reference/settings/resource-providers/trash-guides-structure/)
- [TRaSH-Guides metadata.json](https://github.com/TRaSH-Guides/Guides/blob/master/metadata.json)

#### February 2026 Changes

TRaSH-Guides made significant breaking changes in February 2026, affecting CF group semantics (switching from exclude to include semantics) and quality profile ordering (from reversed to display order). Configarr added a `compatibilityTrashGuide20260219Enabled` flag for backward compatibility.

**Confidence**: Medium (based on consumer tool references; exact TRaSH changelog not retrieved)

Sources:

- [Configarr Configuration File](https://configarr.de/docs/configuration/config-file/)

---

## 2. Recyclarr Format Deep Dive

### YAML Configuration Structure

Recyclarr uses **YAML configuration files** to declaratively describe desired state for Arr instances. A single YAML file can contain configurations for multiple Sonarr and Radarr instances.

**Confidence**: High (verified against official documentation)

#### Core Structure

```yaml
# recyclarr.yml
radarr:
  instance_name:
    base_url: http://radarr:7878
    api_key: !secret radarr_api_key

    delete_old_custom_formats: false

    custom_formats:
      - trash_ids:
          - 0f12c086e289cf966fa5948eac571f44 # Hybrid
          - 570bc9ebecd92723d2d21500f4be314c # Remaster
        assign_scores_to:
          - name: 'Remux + WEB 1080p'
          - name: 'Remux + WEB 2160p'
            score: -1000 # Override guide score

    custom_format_groups:
      add:
        - trash_id: <group_hex_id>
          assign_scores_to:
            - name: ProfileName
          select:
            - <cf_hex_id>

    quality_profiles:
      - name: 'Remux + WEB 1080p'
        reset_unmatched_scores:
          enabled: true
        upgrade:
          allowed: true
          until_quality: 'Remux-1080p'
          until_score: 10000
        qualities:
          - name: 'Remux-1080p'
          - name: 'WEB 1080p'
            qualities:
              - WEBDL-1080p
              - WEBRip-1080p
        quality_sort: top

sonarr:
  instance_name:
    # Similar structure to radarr
```

#### Key Design Decisions

1. **Reference by `trash_id`**: Recyclarr references TRaSH-Guides data exclusively through hex `trash_id` values. This creates a dependency on TRaSH-Guides as the canonical source.
2. **Template system**: Recyclarr provides premade YAML templates in a separate [config-templates repository](https://github.com/recyclarr/config-templates).
3. **Secrets management**: A separate `secrets.yml` file stores sensitive values.
4. **JSON Schema validation**: Recyclarr publishes a JSON Schema for its YAML config at `https://raw.githubusercontent.com/recyclarr/recyclarr/master/schemas/config-schema.json`.
5. **Score delegation**: Scores default to TRaSH-Guides values unless explicitly overridden.

#### Known Pain Points

- **Full-file validation required**: Even when running app-specific sync, the entire YAML file must be free of syntax errors. Recyclarr validates everything during parsing.
- **Breaking version changes**: Version 4.0.0 changed `quality_definitions` syntax, forcing manual migration.
- **Merge complexity**: When splitting YAML across multiple files, users cannot duplicate top-level sections under an instance name -- sections must be merged carefully.
- **Duplicate warnings**: Accidental duplicate `trash_id` specifications for the same quality profile cause warnings.
- **Docker volume sensitivity**: User/group ID changes between container runs can cause file ownership errors.

**Confidence**: High

Sources:

- [Recyclarr Configuration Reference](https://recyclarr.dev/reference/configuration/)
- [Recyclarr Custom Formats](https://recyclarr.dev/reference/configuration/custom-formats/)
- [Recyclarr Quality Profiles](https://recyclarr.dev/reference/configuration/quality-profiles/)
- [Recyclarr Errors & Warnings](https://recyclarr.dev/guide/troubleshooting/errors/)
- [Recyclarr Config Templates](https://github.com/recyclarr/config-templates)

---

## 3. Profilarr Investigation

### Data Format: YAML Files in a Hierarchical Database Structure

Profilarr (Dictionarry-Hub) uses **YAML files** organized in a hierarchical structure within Git repositories. The Dictionarry database repository contains:

**Confidence**: Medium (pieced together from multiple sources; internal format not fully documented publicly)

#### Repository Structure

```
custom_formats/     # YAML custom format definitions
media_management/   # Media management settings
profiles/           # Quality profile definitions
regex_patterns/     # Regular expression patterns (shared, reusable)
scripts/            # Python utility scripts
templates/          # Template files
```

#### Key Architecture

1. **Three-level hierarchy**: Regex Patterns (foundation) -> Custom Formats (depend on patterns) -> Profiles (depend on CFs). This mirrors Praxrr's entity relationship model.
2. **Reusable components**: Regular expressions are separate entities shared across custom formats. This is a significant differentiator from TRaSH-Guides where regex patterns are inline.
3. **Unified configuration language**: One configuration compiles to Radarr/Sonarr-specific formats on sync.
4. **Git-native version control**: All changes tracked through Git history.

#### Profilarr Compliant Database (PCD) Concept

Profilarr defines an open format called "Profilarr Compliant Database" (PCD) that any repository can implement. The standard Dictionarry database is the default, but users can subscribe to any PCD-compliant repository.

When synced to Profilarr, the YAML files are compiled into the application, and Profilarr handles the compilation to Arr-native API formats. The runtime uses **append-only SQL operations** internally for compilation and state management, which is notably similar to Praxrr's approach.

**Important note**: Profilarr's repository is "100.0% Python" according to GitHub, suggesting the YAML files are processed by Python tooling (likely PyYAML or equivalent).

Sources:

- [Profilarr GitHub](https://github.com/Dictionarry-Hub/profilarr)
- [Dictionarry Database](https://github.com/Dictionarry-Hub/database)
- [Profilarr Wiki: Developing Custom Formats & Quality Profiles](https://github.com/Dictionarry-Hub/profilarr/wiki/Developing-Custom-Formats-&-Quality-Profiles)
- [Dictionarry Official Site](https://dictionarry.dev/)
- [Profilarr Issue #178: Import Custom Formats](https://github.com/Dictionarry-Hub/profilarr/issues/178)

---

## 4. Configarr Investigation

### Data Format: YAML Configuration with TRaSH-Guides JSON Consumption

Configarr uses a **single YAML configuration file** (`config.yml`) that orchestrates synchronization from multiple sources. It is not a database format but rather a declarative sync configuration.

**Confidence**: High (verified against official documentation)

#### Core Architecture

Configarr consumes data from multiple sources in their native formats:

- **TRaSH-Guides**: Clones the Git repo and reads JSON files directly
- **Recyclarr templates**: Compatible with Recyclarr YAML templates up to v7.4.0
- **User-defined custom formats**: Defined inline in YAML using the same structure as TRaSH JSON but within YAML syntax
- **Remote HTTP templates**: Experimental support since v1.18.0

#### Configuration Example

```yaml
trashGuideUrl: https://github.com/TRaSH-Guides/Guides
recyclarrConfigUrl: https://github.com/recyclarr/config

customFormatDefinitions:
  - trash_id: example-cf
    trash_scores:
      default: -10000
    name: 'Display Name'
    specifications:
      - name: Specification Name
        implementation: ImplementationType
        fields:
          fieldName: value

sonarr:
  instance-name:
    base_url: http://sonarr:8989
    api_key: !secret SONARR_API_KEY
    quality_profiles:
      - name: WEB-1080p
        upgrade:
          allowed: true
          until_quality: Remux-1080p
    custom_formats:
      - trash_ids:
          - 47435ece6b99a0b477caf360e79ba0bb
        assign_scores_to:
          - name: WEB-1080p
```

#### Key Differentiators from Recyclarr

- **Custom quality profiles from scratch**: Not limited to template-based profiles
- **Custom quality sizes**: User-defined quality size overrides
- **Inline custom format definitions**: CFs can be defined directly in config YAML
- **Multi-Arr support**: Extends beyond Sonarr/Radarr to Whisparr, Readarr, Lidarr
- **Containerized deployment focus**: Designed for Docker/Kubernetes cron jobs

#### Secret Management

Supports three value source methods:

- `!secret KEY` references `secrets.yml`
- `!env VARIABLE` pulls environment variables
- `!file /path/to/file` reads file contents

Sources:

- [Configarr Configuration File](https://configarr.de/docs/configuration/config-file/)
- [Configarr Comparison](https://configarr.de/docs/comparison/)
- [Configarr GitHub](https://github.com/raydak-labs/configarr)
- [Configarr Introduction](https://configarr.de/docs/intro/)

---

## 5. JSON vs YAML for Configuration Data

### Current Community Sentiment (2024-2025)

The debate remains firmly use-case driven, with no universal winner.

**Confidence**: High (multiple independent sources agree)

#### Key Statistics

- **74% of APIs** use JSON (State of API Integration report)
- **55% of developers** prefer YAML for configuration files (Stack Overflow survey)
- **50%+ of DevOps roles** prefer YAML for configuration
- **JSON5** gets 65M+ weekly npm downloads; ranks in top 0.1% of most-depended packages

#### Format Strengths Summary

| Attribute             | JSON                 | YAML                    | TOML                     | JSON5/JSONC     |
| --------------------- | -------------------- | ----------------------- | ------------------------ | --------------- |
| Machine parsing speed | Best                 | Moderate                | Good                     | Good            |
| Human readability     | Moderate             | Best                    | Good                     | Good            |
| Comments support      | No                   | Yes                     | Yes                      | Yes             |
| Type safety           | Strict               | Weak (coercion)         | Strong (explicit)        | Strict          |
| Schema validation     | Mature (JSON Schema) | Via JSON Schema         | Limited                  | Via JSON Schema |
| Nesting support       | Unlimited            | Unlimited               | Awkward for deep nesting | Unlimited       |
| Ecosystem size        | Largest              | Large (DevOps)          | Growing (Rust, Python)   | Growing         |
| Security              | Safe                 | Risky (deserialization) | Safe                     | Safe            |

#### Newer Alternatives

**TOML**: Gaining traction in developer tooling. Python standardized on `pyproject.toml`. Rust uses `Cargo.toml`. Cloud Native Buildpacks chose TOML over YAML specifically to avoid syntactic ambiguity. However, TOML struggles with deeply nested structures, making it unsuitable for Praxrr's hierarchical entity relationships.

**CUE**: Based on lessons from Google's internal config languages. Disallows overrides by design. Types are values and values are types. Suited for large-scale constraint validation. Limited adoption outside Google/cloud-native ecosystem.

**Pkl** (Apple, 2024): Domain-specific programming language for configuration. Strong schema support, code generation, documentation generation. Native binaries larger than competitors. Smaller community. Addresses YAML/JSON limitations around modularity, abstraction, and validation.

**Dhall**: Functional, Haskell-inspired configuration language. Safe imports, total (guaranteed to terminate). Niche adoption.

**KCL**: Statically compiled configuration language. Production-ready performance for large-scale modeling. Low overhead. Recommended for scalable configurations with types.

**Assessment for Praxrr**: None of these newer alternatives have meaningful adoption in the Arr ecosystem. TRaSH-Guides, Recyclarr, Configarr, and Profilarr all use JSON or YAML. Adopting CUE/Pkl/KCL would create an ecosystem island.

**Confidence**: High

Sources:

- [Configuration Format Comparison (2025)](https://schoenwald.aero/posts/2025-05-03_configuration-format-comparison/)
- [Pkl Comparison with Other Languages](https://pkl-lang.org/main/current/introduction/comparison.html)
- [KCL vs Pkl Comparison](https://www.kcl-lang.io/blog/2024-03-22-pkl-kcl-comparison)
- [Heroku: Why Buildpacks Use TOML](https://www.heroku.com/blog/why-buildpacks-use-toml/)
- [AWS: YAML vs JSON](https://aws.amazon.com/compare/the-difference-between-yaml-and-json/)
- [JSONC vs JSON](https://www.cloudthat.com/resources/blog/jsonc-vs-json-for-modern-configuration-files)
- [JSON5 Official](https://json5.org/)

---

## 6. JSON Schema Ecosystem

### Maturity Assessment: Production-Ready

JSON Schema has reached substantial maturity as of 2024-2025.

**Confidence**: High (verified against official project data and multiple independent sources)

#### Key Metrics

- **Current specification**: Draft 2020-12
- **Weekly downloads**: 60+ million
- **Active community**: 5,000+ practitioners on Slack
- **Sponsoring organizations**: 15+, including Airbnb, Postman, AsyncAPI
- **Language support**: Production-ready implementations in virtually every major programming language

#### Draft 2020-12 Features

- Redesigned array/tuple keywords (`prefixItems`/`items` replacing overloaded `items`/`additionalItems`)
- Dynamic references (`$dynamicRef`/`$dynamicAnchor`)
- Split format vocabulary (annotation vs assertion)
- Unicode regex support
- Conditional logic (`oneOf`, `allOf`, `if/then/else`)
- Cross-reference support (`$ref`)

#### Validation Tooling

| Tool               | Language                | Notes                                                          |
| ------------------ | ----------------------- | -------------------------------------------------------------- |
| AJV                | JavaScript/TypeScript   | Fastest validator, 5-18x faster than Zod for complex schemas   |
| Zod                | TypeScript              | 38K+ GitHub stars, 30M+ weekly npm downloads, TypeScript-first |
| TypeBox            | TypeScript              | JSON Schema compatible with TypeScript type inference          |
| jsonschema         | Python                  | Reference implementation                                       |
| Blaze (sourcemeta) | C++ (with Java wrapper) | High-performance native validator                              |

#### Code Generation Ecosystem

- **JSON Schema -> TypeScript**: Multiple tools (json-schema-to-typescript, TypeBox)
- **JSON Schema -> Zod**: Converters exist (json-to-zod)
- **JSON Schema -> SQL DDL**: Tools exist but lossy (jsonschema2ddl, json-schema-to-sql)
- **SQL DDL -> JSON Schema**: Reverse direction also supported (sql-ddl-to-json-schema)

#### JSON Schema vs SQL DDL for Constraints

| Capability                 | JSON Schema         | SQL DDL             |
| -------------------------- | ------------------- | ------------------- |
| Structural validation      | Strong              | Strong              |
| Type constraints           | Strong              | Strong              |
| Referential integrity (FK) | Not supported       | Native              |
| Multi-column constraints   | Not supported       | Native              |
| Hierarchical data          | Native              | Requires joins      |
| Pattern matching           | Regex support       | Limited (LIKE/GLOB) |
| Enumeration                | Native              | CHECK constraints   |
| Conditional logic          | if/then/else, oneOf | CHECK with CASE     |
| Cross-entity validation    | Limited ($ref)      | Full (FK, triggers) |

**Key finding**: JSON Schema is a validation tool, not a data definition language. It excels at structural validation of individual documents but cannot express relational constraints (foreign keys, cross-table checks, referential cascades) that SQL DDL handles natively. For Praxrr's PCD schema with 26 interrelated tables, this gap is significant.

**Confidence**: High

Sources:

- [JSON Schema Official](https://json-schema.org/)
- [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12)
- [The State of JSON Schema 2025](https://www.apiscene.io/lifecycle/state-of-json-schema-2025/)
- [JSON Schema GSoC 2024 Wrap-up](https://json-schema.org/blog/posts/gsoc24-wrapup)
- [Best Schema Validation Tools 2024](https://debugg.ai/resources/best-schema-validation-tools-2024)
- [TypeBox vs Zod](https://betterstack.com/community/guides/scaling-nodejs/typebox-vs-zod/)
- [Oracle: JSON Schema and Relational Databases](https://json-schema.org/blog/posts/oracle-case-study)

---

## 7. YAML Pain Points at Scale

### Documented Issues

YAML has well-documented, extensively researched pitfalls that are relevant to configuration management.

**Confidence**: High (multiple authoritative sources, real-world CVEs)

#### 7.1 The Norway Problem (Implicit Boolean Coercion)

In YAML 1.1, unquoted values are implicitly cast based on content:

- `NO` -> `false` (the country code for Norway becomes a boolean)
- `yes`, `on`, `y` -> `true`
- `no`, `off`, `n` -> `false`

**YAML 1.2 partially fixes this**: Only `true`, `True`, `TRUE`, `false`, `False`, `FALSE` are recognized as booleans. However, many parsers still default to YAML 1.1 behavior, and the "fix" is not universally applied.

**Praxrr relevance**: Moderate. PCD data includes string identifiers (custom format names, quality names) that could theoretically hit coercion edge cases if passed through YAML. However, since Praxrr controls its own parser, it could enforce YAML 1.2 or StrictYAML behavior.

Sources:

- [YAML: The Norway Problem (Bram.us)](https://www.bram.us/2022/01/11/yaml-the-norway-problem/)
- [StrictYAML: Why Implicit Typing Was Removed](https://hitchdev.com/strictyaml/why/implicit-typing-removed/)

#### 7.2 Implicit Type Coercion (Beyond Booleans)

- **Sexagesimal numbers**: `22:22` parses as `1342` (base-60) in YAML 1.1
- **Octal numbers**: `010` parses as `8` (octal) in YAML 1.1; YAML 1.2 requires `0o10`
- **Floats vs strings**: `10.23` may parse as a float rather than a version string
- **Exponent problem**: Values like `1e3` parse as `1000.0` rather than string `"1e3"`

**Praxrr relevance**: Low-to-moderate. PCD data includes numeric scores (integers), regex patterns (strings), and entity names (strings). Scores are always numeric in context, but version-like strings or regex patterns containing numeric-looking values could be affected.

Sources:

- [The YAML Document from Hell (Ruud van Asseldonk)](https://ruudvanasseldonk.com/2023/01/11/the-yaml-document-from-hell)

#### 7.3 Indentation Sensitivity

YAML uses significant whitespace for structure. A single tab character or inconsistent indentation can silently change the meaning of a document or cause parse failures. There are no visible delimiters to catch errors.

Quote from noyaml.com: "extra line break otherwise all shit goes to hell"

**Praxrr relevance**: Moderate. If PCD authors are editing YAML files manually (which is the whole point of a human-readable format), indentation errors are a real risk. However, tooling (YAML linters, editor plugins) mitigates this.

#### 7.4 Anchor/Alias Security Issues (Billion Laughs)

YAML anchors (`&name`) and aliases (`*name`) allow recursive references that can cause exponential memory expansion:

```yaml
a: &a ['lol', 'lol', 'lol', 'lol', 'lol', 'lol', 'lol', 'lol', 'lol']
b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]
c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b]
```

This is the YAML variant of the "Billion Laughs" XML attack. CVE-2019-11253 affected the Kubernetes API server through this vector.

**Praxrr relevance**: Low. PCD databases are authored by trusted curators, not untrusted user input. The attack surface exists only if Praxrr accepts YAML from arbitrary external PCD repos. This can be mitigated with parser limits (max node count, max expansion depth).

Sources:

- [noyaml.com](https://noyaml.com/)
- [CVE-2019-11253: Kubernetes YAML vulnerability](https://github.com/kubernetes/kubernetes/issues/83253)
- [PyYAML Billion Laughs Issue](https://github.com/yaml/pyyaml/issues/235)
- [Laughter in the Wild: DoS Vulnerabilities in YAML Libraries (ResearchGate)](https://www.researchgate.net/publication/333505459_Laughter_in_the_Wild_A_Study_into_DoS_Vulnerabilities_in_YAML_Libraries)

#### 7.5 Multi-line String Complexity

There are 63 different ways to write multi-line strings in YAML. This creates ambiguity in how regex patterns (a core PCD data type) would be represented.

**Praxrr relevance**: High. PCD stores regular expressions that frequently contain special characters, backslashes, and multi-line patterns. Ensuring consistent representation in YAML would require strict conventions.

#### 7.6 Implementation Inconsistency

"Every YAML parser is a custom YAML parser" -- implementations vary in YAML version support (1.1 vs 1.2), anchor handling, and type coercion behavior.

**Praxrr relevance**: Low-to-moderate. Praxrr uses Deno, which would use a specific JavaScript YAML parser. However, PCD database authors using different editors and tools could encounter inconsistencies.

#### 7.7 Mitigation: StrictYAML

StrictYAML (Python) parses a restricted subset of YAML, treating everything as strings by default and requiring explicit schema-based type casting. It has 705+ GitHub stars and is actively maintained.

No equivalent exists for Deno/JavaScript, but the approach (disable implicit typing, require quotes for strings) could be implemented as parser configuration.

Sources:

- [StrictYAML GitHub](https://github.com/crdoconnor/strictyaml)

---

## 8. Documentation Generation

### JSON Schema Documentation Tools

**Confidence**: Medium (tools exist but the ecosystem is fragmented)

#### Primary Tools

| Tool                    | Stars | Output Formats | JSON Schema Version | Status                    |
| ----------------------- | ----- | -------------- | ------------------- | ------------------------- |
| json-schema-for-humans  | 705   | HTML, Markdown | Draft-07            | Active (v1.6.0, Feb 2026) |
| JSON Schema Static Docs | ~100  | Markdown       | Draft-07            | Active                    |
| jsonschema2md (Adobe)   | ~300  | Markdown       | Draft-07            | Maintained                |

**json-schema-for-humans** is the most mature option:

- Multiple HTML templates (interactive JS, offline, flat)
- Markdown output with TOC
- Anchor links for deep-linking
- Circular reference handling
- 443 commits, 56 contributors, 19 releases

However, all major tools target Draft-07, not Draft 2020-12. The JSON Schema documentation generation ecosystem lags behind the validation ecosystem.

#### AI-Assisted Approaches (2024-2025)

Recent developments include AI-assisted schema handling where LLMs generate human-readable mapping rules for data transformation. MetaConfigurator combines LLMs with deterministic techniques for schema creation, modification, and visualization. These are experimental.

Sources:

- [json-schema-for-humans GitHub](https://github.com/coveooss/json-schema-for-humans)
- [JSON Schema Static Docs](https://tomcollins.github.io/json-schema-static-docs/)
- [json-schema-org Discussion #693](https://github.com/orgs/json-schema-org/discussions/693)

### SQL Schema Documentation Tools

**Confidence**: High (well-established tooling)

| Tool      | Approach            | Output          | Notes                                 |
| --------- | ------------------- | --------------- | ------------------------------------- |
| SchemaSpy | Connects to live DB | HTML with ERDs  | Java-based, CI/CD friendly, 3K+ stars |
| DBML      | Own DSL             | HTML via dbdocs | Simple, readable syntax, popular      |
| tbls      | Reads DB or DDL     | Markdown, HTML  | Go-based, GitHub integration          |
| DbSchema  | GUI tool            | Visual diagrams | Commercial, free version available    |

SchemaSpy is the most mature option for SQL-based documentation:

- Automatic ERD generation
- Anomaly detection (missing indexes, orphan tables)
- CI/CD integration
- Support for 12+ database engines including SQLite
- Statistics and analysis

**DBML** is notable as a lightweight alternative -- it defines its own DSL for describing schemas that is "easier to write, read, and maintain than traditional DDL." DBML could serve as an intermediate representation.

**Key comparison**: SQL schema documentation tools can automatically generate relationship diagrams (ERDs) because foreign key relationships are explicit in DDL. JSON Schema documentation tools cannot do this because `$ref` is structural, not relational.

Sources:

- [SchemaSpy](https://schemaspy.org/)
- [Top Database Documentation Tools 2025](https://www.holistics.io/blog/top-database-documentation-tools/)
- [DBML and dbdocs](https://medium.com/techanic/generating-documentation-for-databases-from-sql-schema-using-dbdocs-dbdiagram-281ca78d57e8)

---

## Ecosystem Comparison Matrix

| Dimension                      | TRaSH-Guides            | Recyclarr                  | Configarr                  | Profilarr                         | Praxrr (Current)          |
| ------------------------------ | ----------------------- | -------------------------- | -------------------------- | --------------------------------- | ------------------------- |
| **Data Format**                | JSON                    | YAML                       | YAML                       | YAML (repo) / SQL (runtime)       | SQL ops                   |
| **Schema Validation**          | Informal                | JSON Schema                | Informal                   | Informal                          | SQL DDL                   |
| **Entity Granularity**         | One file per CF/profile | All-in-one config          | All-in-one config          | One file per entity               | One file per batch of ops |
| **Shared Regex Patterns**      | No (inline)             | No (reference by trash_id) | No (reference by trash_id) | Yes (separate entities)           | Yes (separate table)      |
| **Cross-entity Relationships** | Via trash_id refs       | Via trash_id refs          | Via trash_id refs          | Hierarchical (regex->CF->profile) | Foreign keys (26 tables)  |
| **Version Control**            | Git (individual files)  | Git (config files)         | Git (config files)         | Git (YAML + SQL internally)       | Git (SQL ops files)       |
| **Diffability**                | Good (small files)      | Good (YAML diffs)          | Good (YAML diffs)          | Good (YAML files)                 | Moderate (SQL diffs)      |
| **Human Authoring**            | Direct JSON editing     | Direct YAML editing        | Direct YAML editing        | Web UI + YAML                     | Web UI + SQL              |
| **Arr-type Scoping**           | Separate directories    | Top-level YAML keys        | Top-level YAML keys        | Unified with compilation          | Per-row `arr_type` column |

---

## Uncertainties and Gaps

1. **Profilarr internal format ambiguity**: While the Dictionarry database repository shows a YAML-file-per-entity approach with directories for `custom_formats/`, `profiles/`, and `regex_patterns/`, the exact YAML schema is not publicly documented in detail. The runtime uses SQL ops internally, creating a dual-format system similar to what Praxrr might adopt.

2. **YAML 1.2 parser support in Deno**: The specific YAML parser Deno uses and whether it defaults to 1.1 or 1.2 behavior was not verified. This affects the severity of Norway problem / coercion issues.

3. **Community size data**: Exact user counts for Recyclarr, Configarr, and Profilarr were not obtained. GitHub stars suggest Profilarr (268 stars for database repo) and Recyclarr (likely larger given TRaSH-Guides endorsement) are the most popular.

4. **JSON Schema documentation tool support for Draft 2020-12**: All major documentation generators target Draft-07, not the current 2020-12. This gap could affect adoption if Praxrr uses modern JSON Schema features.

5. **Configarr/Recyclarr fork divergence**: Configarr started as a Recyclarr v7 fork and maintains template compatibility up to v7.4.0, but the extent of divergence in 2025-2026 was not fully documented.

6. **Performance data**: No benchmarks were found comparing SQL ops ingestion vs JSON/YAML file parsing for Praxrr-scale datasets (the initial `0.rosettarr.sql` seed is ~25K lines).

---

## Search Queries Executed

1. TRaSH-Guides JSON format custom format structure trash_id 2024 2025
2. Recyclarr YAML configuration format documentation 2024 2025
3. Profilarr configuration tool Sonarr Radarr format 2024 2025
4. Configarr Sonarr Radarr configuration tool format 2024 2025
5. JSON vs YAML configuration format debate 2024 2025 developer community sentiment
6. YAML problems Norway problem implicit type coercion security issues 2024 2025
7. JSON Schema validation ecosystem maturity tooling 2024 2025
8. documentation generation from JSON Schema YAML schema tools 2024 2025
9. TOML CUE Pkl Dhall KCL configuration language comparison 2024 2025
10. YAML Norway problem "no" boolean coercion octal number pitfalls
11. Recyclarr pain points user complaints issues YAML 2024 2025
12. SQL DDL schema documentation generation tools compared JSON Schema
13. Profilarr data format custom formats quality profiles YAML JSON SQL structure wiki
14. json-schema-for-humans documentation generator alternatives 2024 2025
15. SchemaSpy DBML tbls SQL schema documentation generation tools
16. Recyclarr user experience complaints reddit discord YAML configuration difficult 2024
17. TOML configuration format adoption 2024 2025 advantages over YAML
18. Profilarr Dictionarry PCD "profilarr compliant database" format SQL ops
19. json-schema-for-humans alternatives "schema doc" "jsonschema2md" "docusaurus" documentation generator
20. Configarr vs Recyclarr comparison features differences 2024 2025
21. TRaSH-Guides JSON schema validation structure February 2026 changes quality profile groups
22. JSON Schema Draft 2020-12 features validation code generation type safety
23. StrictYAML Python safe YAML parsing no implicit typing 2024
24. JSONC JSON with comments JSON5 configuration file format adoption 2024 2025
25. Dictionarry Hub database repository SQL ops files format structure
26. "json-schema" "typescript" code generation "zod" comparison validation 2024 2025
27. YAML anchor alias security vulnerability billion laughs attack configuration
28. Recyclarr YAML configuration example custom formats quality profiles trash_ids structure
29. "JSON Schema" vs "SQL DDL" constraints expressiveness comparison data validation
30. Dictionarry database custom formats YAML files profilarr compliant database format

---

## All Sources (Deduplicated)

### TRaSH-Guides

- [TRaSH-Guides CONTRIBUTING.md](https://github.com/TRaSH-Guides/Guides/blob/master/CONTRIBUTING.md)
- [TRaSH-Guides metadata.json](https://github.com/TRaSH-Guides/Guides/blob/master/metadata.json)
- [TRaSH-Guides Collection of Custom Formats](https://trash-guides.info/Radarr/Radarr-collection-of-custom-formats/)
- [TRaSH-Guides Import Custom Formats](https://trash-guides.info/Radarr/Radarr-import-custom-formats/)

### Recyclarr

- [Recyclarr Configuration Reference](https://recyclarr.dev/reference/configuration/)
- [Recyclarr Custom Formats](https://recyclarr.dev/reference/configuration/custom-formats/)
- [Recyclarr Quality Profiles](https://recyclarr.dev/reference/configuration/quality-profiles/)
- [Recyclarr Config Examples](https://recyclarr.dev/wiki/yaml/config-examples/)
- [Recyclarr Config Templates](https://github.com/recyclarr/config-templates)
- [Recyclarr Errors & Warnings](https://recyclarr.dev/guide/troubleshooting/errors/)
- [Recyclarr TRaSH-Guides Structure](https://recyclarr.dev/reference/settings/resource-providers/trash-guides-structure/)

### Profilarr / Dictionarry

- [Profilarr GitHub](https://github.com/Dictionarry-Hub/profilarr)
- [Dictionarry Database](https://github.com/Dictionarry-Hub/database)
- [Dictionarry Official Site](https://dictionarry.dev/)
- [Profilarr Wiki: Custom Formats & Quality Profiles](https://github.com/Dictionarry-Hub/profilarr/wiki/Developing-Custom-Formats-&-Quality-Profiles)
- [Profilarr Issue #178: Import Custom Formats](https://github.com/Dictionarry-Hub/profilarr/issues/178)
- [Dumpstarr (Community PCD)](https://github.com/Dumpstarr/Dumpstarr)

### Configarr

- [Configarr Configuration File](https://configarr.de/docs/configuration/config-file/)
- [Configarr Comparison](https://configarr.de/docs/comparison/)
- [Configarr GitHub](https://github.com/raydak-labs/configarr)
- [Configarr Introduction](https://configarr.de/docs/intro/)

### JSON Schema

- [JSON Schema Official](https://json-schema.org/)
- [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12)
- [JSON Schema Release Notes 2020-12](https://json-schema.org/draft/2020-12/release-notes)
- [The State of JSON Schema 2025](https://www.apiscene.io/lifecycle/state-of-json-schema-2025/)
- [JSON Schema GSoC 2024](https://json-schema.org/blog/posts/gsoc24-wrapup)
- [Oracle: JSON Schema and Relational Databases](https://json-schema.org/blog/posts/oracle-case-study)

### Configuration Formats

- [Configuration Format Comparison (2025)](https://schoenwald.aero/posts/2025-05-03_configuration-format-comparison/)
- [Pkl Comparison](https://pkl-lang.org/main/current/introduction/comparison.html)
- [KCL vs Pkl Comparison](https://www.kcl-lang.io/blog/2024-03-22-pkl-kcl-comparison)
- [Heroku: Why Buildpacks Use TOML](https://www.heroku.com/blog/why-buildpacks-use-toml/)
- [AWS: YAML vs JSON](https://aws.amazon.com/compare/the-difference-between-yaml-and-json/)
- [SnapLogic: JSON vs YAML](https://www.snaplogic.com/blog/json-vs-yaml-whats-the-difference-and-which-one-is-right-for-your-enterprise)
- [TOML vs YAML (Medium)](https://morihosseini.medium.com/toml-vs-yaml-7ff0bb94e98f)
- [JSON5 Official](https://json5.org/)
- [JSONC vs JSON](https://www.cloudthat.com/resources/blog/jsonc-vs-json-for-modern-configuration-files)

### YAML Issues

- [The YAML Document from Hell](https://ruudvanasseldonk.com/2023/01/11/the-yaml-document-from-hell)
- [noyaml.com](https://noyaml.com/)
- [YAML: The Norway Problem (Bram.us)](https://www.bram.us/2022/01/11/yaml-the-norway-problem/)
- [StrictYAML: Why Implicit Typing Was Removed](https://hitchdev.com/strictyaml/why/implicit-typing-removed/)
- [StrictYAML GitHub](https://github.com/crdoconnor/strictyaml)
- [CVE-2019-11253: Kubernetes YAML vulnerability](https://github.com/kubernetes/kubernetes/issues/83253)
- [PyYAML Billion Laughs Issue](https://github.com/yaml/pyyaml/issues/235)

### Documentation Generation

- [json-schema-for-humans GitHub](https://github.com/coveooss/json-schema-for-humans)
- [JSON Schema Static Docs](https://tomcollins.github.io/json-schema-static-docs/)
- [json-schema-org Discussion #693](https://github.com/orgs/json-schema-org/discussions/693)
- [SchemaSpy](https://schemaspy.org/)
- [DBML and dbdocs](https://medium.com/techanic/generating-documentation-for-databases-from-sql-schema-using-dbdocs-dbdiagram-281ca78d57e8)
- [Top Database Documentation Tools 2025](https://www.holistics.io/blog/top-database-documentation-tools/)

### Validation Libraries

- [Zod GitHub](https://github.com/colinhacks/zod)
- [TypeBox vs Zod](https://betterstack.com/community/guides/scaling-nodejs/typebox-vs-zod/)
- [Best Schema Validation Tools 2024](https://debugg.ai/resources/best-schema-validation-tools-2024)
