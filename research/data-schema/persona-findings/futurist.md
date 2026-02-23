# Futurist Persona: Future Implications and Opportunities for PCD Data Format Migration

## Executive Summary

The question of migrating Praxrr's PCD ingestion layer from SQL ops to JSON/YAML is not just a format preference -- it is a strategic positioning decision that will determine Praxrr's interoperability ceiling, community growth trajectory, and ecosystem influence for the next 3-5 years. The media server automation ecosystem is converging on JSON as the lingua franca for config data, with YAML as the human-authoring layer. Meanwhile, SQL retains unique advantages for schema definition and relational integrity. The strongest future position is a **hybrid model**: SQL schema DDL retained, JSON/YAML data ingestion added as the primary authoring and distribution format, with SQL ops generated at compile time.

**Confidence**: High -- based on ecosystem trajectory analysis across TRaSH-Guides, Recyclarr, Configarr, Profilarr/Dictionarry, and broader config-as-data industry trends.

---

## 1. TRaSH-Guides Interoperability

### Current State

TRaSH-Guides stores custom formats as individual JSON files in `docs/json/{radarr,sonarr}/cf/` directories ([TRaSH-Guides Radarr CF Collection](https://trash-guides.info/Radarr/Radarr-collection-of-custom-formats/)). Each file contains:

- `trash_id` -- a stable hex hash identifier
- `trash_scores` -- scoring metadata per profile variant
- `name`, `specifications[]`, `includeCustomFormatWhenRenaming`
- Direct compatibility with Radarr/Sonarr import APIs

TRaSH-Guides made significant structural changes in February 2026, affecting CF group semantics and quality profile ordering ([TRaSH-Guides Breaking Changes](https://trash-guides.info/)).

### What Automated Import Would Look Like

If Praxrr consumed JSON natively, a TRaSH-Guides import pipeline would follow this architecture:

```
TRaSH JSON (per-CF files)
    |
    v
[Adapter/Transformer]
    |-- Map trash_id -> Praxrr entity stable key
    |-- Decompose specifications[] -> Praxrr conditions + regular_expressions
    |-- Map trash_scores -> quality_profile_custom_formats scores
    |-- Resolve naming: kebab-case filenames -> entity names
    |
    v
Praxrr JSON/YAML (portable format)
    |
    v
[SQL Ops Compiler]  <-- existing Kysely pipeline
    |
    v
pcd_ops (INSERT/UPDATE statements)
```

**Key transformation challenges:**

- TRaSH specifications embed regex patterns inline; Praxrr separates `regular_expressions` as shared entities with tags
- TRaSH uses numeric condition implementation IDs; Praxrr uses named condition types
- TRaSH scores are per-profile-variant; Praxrr scores are per-arr-type per quality profile
- TRaSH custom formats are Radarr-first or Sonarr-first; Praxrr entities are arr-agnostic with arr-type qualifiers

### Bidirectional Sync Potential

A bidirectional sync would be architecturally possible but pragmatically limited:

- **Import (TRaSH -> Praxrr)**: Feasible with a well-defined adapter. The `trash_id` serves as a stable foreign key. Praxrr could maintain a `trash_id` mapping table to track provenance and detect upstream changes.
- **Export (Praxrr -> TRaSH)**: Requires flattening Praxrr's normalized structure back into TRaSH's denormalized per-CF files. Loss of Praxrr-specific features (shared regex entities, cross-arr scoring) is inevitable.
- **True bidirectional sync**: Would require a shared schema or protocol, which does not exist and is unlikely to emerge given the different design philosophies.

**Confidence**: Medium -- TRaSH-Guides' February 2026 structural changes demonstrate the format evolves independently, making tight coupling risky.

### Recommendation

Build a one-way import adapter (TRaSH -> Praxrr) rather than bidirectional sync. The import could be triggered via API endpoint or CLI command, producing Praxrr-native JSON/YAML entities that go through the standard ingestion pipeline. This positions Praxrr as a superset of TRaSH rather than a peer.

---

## 2. Community Contribution Barrier Analysis

### Current Barrier: SQL Authoring

Contributors to praxrr-db must currently write SQL operations that:

- Correctly reference foreign keys and entity names
- Use value guards for updates/deletes (old-value checks)
- Follow the append-only ops model with proper sequencing
- Understand the PCD schema DDL (30+ tables with complex relationships)

This is a significant barrier. Most media server enthusiasts are not SQL-fluent. They are comfortable with JSON (from TRaSH-Guides manual import) and YAML (from Recyclarr/Configarr).

### Projected Barrier Reduction with JSON/YAML

If praxrr-db accepted JSON/YAML contributions:

```yaml
# Example: contributing a new custom format
entity_type: custom_format
name: 'DTS-HD MA'
description: 'DTS-HD Master Audio lossless codec'
include_in_rename: false
tags:
  - audio
  - lossless
conditions:
  - name: 'DTS-HD MA'
    implementation: ReleaseTitleSpecification
    negate: false
    required: false
    fields:
      value: "\\bDTS[-. ]?HD(?:[-. ]?(?:MA|Master Audio))?\\b"
tests:
  - title: 'Movie.2024.DTS-HD.MA.1080p.BluRay'
    type: movie
    should_match: true
```

**Advantages:**

- Familiar syntax for TRaSH-Guides users (JSON) and Recyclarr users (YAML)
- No need to understand SQL, foreign keys, or value guards
- IDE-assisted authoring with JSON Schema validation
- Self-documenting structure (field names explain themselves)
- PR reviews become semantic reviews rather than SQL syntax reviews

**Quantitative estimate**: Contributor pool could expand 5-10x. The intersection of "media server enthusiasts who understand quality profiles" and "people who can write SQL" is small. The intersection with "people who can edit JSON/YAML" is nearly universal.

**Confidence**: High -- based on Recyclarr's community growth after adopting YAML, and Configarr's adoption trajectory after offering YAML config.

### Migration Path for Existing Contributors

Existing SQL-comfortable contributors would not lose capability. The JSON/YAML format compiles down to the same SQL ops, so power users could still inspect or modify at the SQL level. The system would support both input paths.

---

## 3. API-First Distribution

### Current Distribution Model

praxrr-db is distributed as a Git repository containing SQL ops files. Consumers must:

1. Clone/pull the repository
2. Parse SQL files in order
3. Execute them against an in-memory SQLite database

This is functional but requires a SQL execution environment.

### API-First Architecture Vision

If praxrr-db data were in JSON/YAML, it could be served without any SQL processing:

```
+------------------+     +-------------------+     +------------------+
|   praxrr-db      |     |   API Gateway     |     |    Consumers     |
|   (Git repo)     |---->|   (static/CDN)    |---->|  - Praxrr app    |
|                  |     |                   |     |  - Recyclarr     |
|  /entities/      |     |  GET /cf/{name}   |     |  - Configarr     |
|    cf/*.json     |     |  GET /qp/{name}   |     |  - Custom tools  |
|    qp/*.yaml     |     |  GET /all         |     |  - LLM agents    |
|  /schema/        |     |  GET /schema      |     +------------------+
|    pcd.schema.json     |                   |
+------------------+     +-------------------+
```

**Implementation options:**

1. **GitHub Pages / Static Site**: JSON files served directly from repository via GitHub Pages or Cloudflare Pages. Zero infrastructure cost. Works today with raw.githubusercontent.com but with rate limits.

2. **REST API on GitHub Actions**: A CI/CD pipeline that compiles YAML sources to JSON, validates against schema, and deploys to a CDN endpoint. Automatic on every push.

3. **npm/JSR Package**: Publish praxrr-db as a versioned package containing typed JSON data. Consumers install a specific version and get compile-time type safety.

4. **OCI Artifact**: Package the database as an OCI (container) artifact, enabling `docker pull`-style distribution with content-addressable storage and delta updates.

### What This Enables

- **Third-party tools can consume Praxrr configs without running Praxrr**: A Recyclarr plugin, a Configarr integration, or a standalone CLI tool could fetch entity definitions via HTTP.
- **Versioned API with semver guarantees**: Breaking changes to entity structure get major version bumps.
- **Offline-first with cache**: HTTP ETags and conditional requests enable efficient polling without re-downloading unchanged data.
- **Cross-language consumption**: JSON is universally parseable. No need for SQLite bindings or Kysely.

**Confidence**: High -- this pattern is well-established (npm registry, Docker Hub, Helm charts, Terraform registry all follow this model).

---

## 4. Documentation Generation Pipeline

### Architecture

With JSON Schema + JSON/YAML data, a documentation generation pipeline becomes straightforward:

```
JSON Schema (pcd.schema.json)
    +
Entity Data (JSON/YAML files)
    |
    v
[Generator Pipeline]
    |
    +---> Human-readable entity docs (Markdown/HTML)
    |       - Per-CF pages with conditions, scores, tests
    |       - Per-QP pages with qualities, scores, cutoffs
    |       - Regex reference with regex101 links
    |
    +---> Searchable index (Algolia/MeiliSearch/Pagefind)
    |       - Full-text search across all entities
    |       - Filter by tag, arr_type, entity_type
    |       - Fuzzy matching for entity names
    |
    +---> Comparison tables
    |       - Side-by-side quality profile comparison
    |       - CF score matrices (which profiles score which CFs)
    |       - Arr compatibility matrix
    |
    +---> Changelog from git diffs
            - Structured diff: "Added condition X to CF Y"
            - Score change tracking: "CF Z score changed from 100 to 150 in QP W"
            - New entity announcements
            - Breaking change detection
```

### Specific Deliverables

**1. Auto-Generated Custom Format Documentation**

```markdown
# Custom Format: DTS-HD MA

**Tags**: audio, lossless
**Include in Rename**: No

## Conditions

| Name      | Type                      | Required | Negate | Pattern            |
| --------- | ------------------------- | -------- | ------ | ------------------ |
| DTS-HD MA | ReleaseTitleSpecification | No       | No     | `\bDTS[-. ]?HD...` |

## Quality Profile Scores

| Quality Profile   | Radarr Score | Sonarr Score |
| ----------------- | ------------ | ------------ |
| HD Bluray + Web   | 100          | 100          |
| Remux + Web 2160p | 100          | -            |

## Test Cases

- [PASS] Movie.2024.DTS-HD.MA.1080p.BluRay
```

**2. Semantic Changelogs**

With JSON/YAML diffs, changelogs become semantic rather than textual:

```
## v2.5.0 (2026-03-15)

### New Custom Formats
- Added "AV1" (tags: video, next-gen)
- Added "Dolby Vision Profile 8" (tags: video, hdr)

### Score Changes
- "DTS-HD MA" score increased from 80 to 100 in "HD Bluray + Web" (Radarr)
- "x265 (HD)" penalty reduced from -100 to -50 in all profiles

### Condition Updates
- "Scene" CF: Updated regex pattern (improved false-positive rejection)
```

This is vastly more useful than raw SQL diffs like:

```sql
- UPDATE quality_profile_custom_formats SET score = 80 WHERE ...
+ UPDATE quality_profile_custom_formats SET score = 100 WHERE ...
```

**3. Change Impact Analysis**

JSON/YAML diffs can be programmatically analyzed to determine impact:

- Which Arr instances would be affected by this change?
- How many quality profiles reference the modified custom format?
- Does this change introduce a new entity dependency?

**Confidence**: High -- tools like dyff ([dyff](https://github.com/homeport/dyff)), graphtage ([graphtage](https://github.com/trailofbits/graphtage)), and jd ([jd](https://github.com/josephburnett/jd)) already provide structured JSON/YAML diffing with git integration.

---

## 5. Multi-Format Ingestion

### The Question

Could Praxrr support multiple ingestion formats simultaneously?

```
JSON (TRaSH-Guides compat)  ---+
                                |
YAML (human authoring)     ----+--> [Unified Ingestion Layer] --> SQL Ops
                                |
SQL (power users)          ----+
```

### Analysis

**Pros:**

- Maximum flexibility for different contributor personas
- TRaSH-Guides JSON can be imported without conversion
- YAML is the best format for human authoring (comments, readability)
- SQL remains available for complex/edge-case operations

**Cons:**

- Triple validation surface (three parsers, three schema validators)
- Semantic equivalence testing across formats is non-trivial
- Documentation must cover all three formats
- Bug surface increases with each format

### Recommendation: Prioritized, Not Parallel

Rather than supporting all three simultaneously as first-class citizens:

1. **Primary format: YAML** -- for authoring, contributions, and human consumption
2. **Secondary format: JSON** -- for API distribution, TRaSH import, and machine consumption
3. **Internal format: SQL ops** -- generated by the system, not authored by humans
4. **Legacy support: SQL import** -- for backward compatibility with existing praxrr-db ops

YAML and JSON are trivially interconvertible (YAML is a superset of JSON), so supporting both is nearly free. The key architectural decision is making SQL ops a **compile target** rather than an **authoring format**.

**Confidence**: Medium -- the complexity cost of three fully equal formats is real, but the prioritized model mitigates it.

---

## 6. AI/LLM Integration Opportunities

### Current LLM Capabilities with Structured Data

Modern LLMs have fundamentally different capabilities with JSON versus SQL:

- **JSON generation accuracy**: With constrained decoding (JSON Schema-guided), LLMs produce valid JSON at near-100% rates. Libraries like Outlines, XGrammar, and llguidance enforce schema compliance token-by-token with ~50 microsecond overhead ([Constrained Decoding](https://medium.com/@emrekaratas-ai/structured-output-generation-in-llms-json-schema-and-grammar-based-decoding-6a5c58b698a6)).
- **SQL generation accuracy**: Even GPT-4o achieves only ~52% execution accuracy on complex queries. O1-Preview reaches ~87% on real-world tasks, but this is for SELECT queries -- INSERT/UPDATE with value guards and foreign key awareness is harder ([LLM SQL Generation](https://promethium.ai/guides/llm-ai-models-text-to-sql/)).
- **JSON Schema as specification**: JSON Schema serves as both a validation contract and an LLM instruction set. An LLM given a JSON Schema can generate conforming instances reliably.

### Concrete Opportunities

**1. AI-Assisted Custom Format Creation**

```
User: "Create a custom format that detects Dolby Vision Profile 5 in release titles"

LLM (with JSON Schema constraint):
{
  "entity_type": "custom_format",
  "name": "DV (Profile 5)",
  "description": "Dolby Vision Profile 5 (dual-layer)",
  "tags": ["video", "hdr", "dolby-vision"],
  "conditions": [{
    "name": "DV Profile 5",
    "implementation": "ReleaseTitleSpecification",
    "fields": {
      "value": "\\b(?:DV|DoVi|Dolby[. ]?Vision).*(?:P5|Profile[. ]?5)\\b"
    }
  }]
}
```

This is dramatically easier for an LLM to generate correctly than the equivalent SQL:

```sql
INSERT INTO custom_formats (name, description, include_in_rename) VALUES (...);
INSERT INTO custom_format_tags (custom_format_name, tag_name) VALUES (...);
INSERT INTO custom_format_conditions (...) VALUES (...);
```

**2. Natural Language Quality Profile Configuration**

Users could describe their desired quality profile in plain language:

> "I want a profile for 4K movies that prefers Remux over Web-DL, with a minimum score of 100, and penalizes x265 HD encodes"

An LLM could generate the complete JSON/YAML entity definition, validated against schema before ingestion.

**3. Automated TRaSH-Guides Tracking**

An LLM agent could:

- Monitor TRaSH-Guides repository for changes
- Understand the semantic intent of changes
- Generate Praxrr-compatible JSON/YAML adaptations
- Open pull requests to praxrr-db with human-readable descriptions

**4. Config Explanation and Recommendation**

Given Praxrr config data in JSON/YAML, an LLM can:

- Explain what a custom format does in plain language
- Recommend score adjustments based on user preferences
- Identify potential conflicts between custom formats
- Suggest quality profile configurations based on hardware capabilities

**Confidence**: High -- JSON Schema constrained decoding is production-ready in 2025-2026 ([JSON Schema for LLM Tools](https://blog.promptlayer.com/how-json-schema-works-for-structured-outputs-and-tool-integration/)), and the media server domain is well within LLM knowledge boundaries.

---

## 7. Schema Evolution Comparison

### Current: SQL DDL Approach

```sql
-- Adding a new column
ALTER TABLE custom_formats ADD COLUMN arr_type VARCHAR(20);

-- Adding a new table
CREATE TABLE custom_format_groups (
    id INTEGER PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    ...
);
```

**Pros:**

- SQL DDL is the canonical way to define relational schemas
- ALTER TABLE semantics are well-defined
- Foreign key constraints enforce integrity at the schema level
- SQLite handles migrations natively

**Cons:**

- Schema changes require migration SQL that must be applied in order
- Backward compatibility must be manually managed
- No built-in versioning protocol
- Consumers must re-execute all ops after schema changes

### Future: JSON Schema Approach

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://praxrr.dev/schemas/pcd/v2",
  "type": "object",
  "properties": {
    "custom_format": {
      "type": "object",
      "properties": {
        "name": { "type": "string", "maxLength": 100 },
        "arr_type": { "type": "string", "enum": ["radarr", "sonarr", "lidarr"] },
        ...
      },
      "required": ["name"]
    }
  }
}
```

**Pros:**

- Native versioning via `$id` URI
- Additive changes are automatically backward-compatible (new optional fields)
- Rich validation vocabulary (patterns, enums, conditional schemas)
- Tooling ecosystem: validators, generators, documentation tools
- Schema evolution follows established patterns: expand-contract, backward/forward compatibility ([Schema Evolution Strategies](https://app.studyraid.com/en/read/12384/399934/schema-versioning-strategies))

**Cons:**

- Cannot express relational constraints (foreign keys, uniqueness across entities)
- No native migration mechanism (must use external versioning)
- Cross-entity validation requires custom logic
- JSON Schema Draft 2020-12 is complex; contributors may find it harder to read than SQL DDL

### Practical Schema Evolution Strategy

JSON Schema is better for **data format evolution** (adding fields, changing constraints). SQL DDL is better for **structural evolution** (new tables, new relationships, integrity constraints).

The hybrid approach:

- **SQL DDL**: Continues to define the PCD cache schema (the in-memory SQLite structure)
- **JSON Schema**: Defines the ingestion format (what contributors write)
- **Compiler**: Validates JSON/YAML data against JSON Schema, then generates SQL ops that conform to the DDL schema

Schema version bumps would follow semver:

- **Patch**: New optional fields with defaults
- **Minor**: New entity types or new required fields with migration path
- **Major**: Breaking changes to existing entity structure

**Confidence**: High -- this mirrors the established Confluent Schema Registry pattern ([Confluent Schema Evolution](https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html)).

---

## 8. Ecosystem Convergence Analysis

### Current Landscape (2026)

| Tool                    | Config Format       | Schema                           | Distribution               | Community  |
| ----------------------- | ------------------- | -------------------------------- | -------------------------- | ---------- |
| TRaSH-Guides            | JSON (per-CF files) | Implicit (metadata.schema.json)  | Git repo + web             | Very large |
| Recyclarr               | YAML (config files) | JSON Schema (config-schema.json) | CLI binary + Git templates | Large      |
| Configarr               | YAML (config file)  | Custom YAML tags                 | Docker/K8s                 | Growing    |
| Profilarr/Praxrr        | SQL ops             | SQL DDL                          | Git repo (PCD)             | Emerging   |
| Profilarr (Dictionarry) | SQL ops + Web UI    | SQL DDL                          | Git repo (PCD)             | Growing    |

### Convergence Trajectory

1. **JSON is the interchange format**: TRaSH-Guides established JSON as the common language. Every tool in the ecosystem either consumes or produces TRaSH-compatible JSON. This will not change.

2. **YAML is the authoring format**: Recyclarr and Configarr proved that YAML is what users want to write. Comments, readability, and IDE support make it the preferred human interface.

3. **SQL is the execution format**: Under the hood, Arr applications use SQL databases. The PCD approach of compiling to SQL ops is technically sound -- it just should not be the user-facing layer.

4. **Web UIs are replacing config files**: Profilarr's visual dashboard and Praxrr's web UI represent the next wave. Users increasingly want to click rather than edit files. But the underlying data still needs a portable, versionable format.

5. **API-first distribution is coming**: The current Git-clone-and-parse model works but does not scale. A REST/GraphQL API or package registry for config data is inevitable.

### Where Praxrr Should Position Itself

Praxrr's competitive advantage is its **relational data model** -- shared regex entities, cross-arr scoring, value guards for conflict detection, and the append-only ops audit trail. No other tool has this sophistication.

The risk is that this sophistication is locked behind a SQL authoring barrier. The opportunity is to **keep the relational power while opening the door** with JSON/YAML ingestion.

**Strategic position**: Praxrr as the "compiler" for the ecosystem -- accepting data from any format (TRaSH JSON, Recyclarr YAML, Praxrr YAML, raw SQL) and compiling it into validated, conflict-checked, optimized SQL ops.

**Confidence**: High -- ecosystem analysis based on active repositories, community engagement metrics, and tool adoption patterns across TRaSH-Guides ([TRaSH-Guides](https://trash-guides.info/)), Recyclarr ([Recyclarr](https://recyclarr.dev/)), Configarr ([Configarr](https://configarr.de/)), and Profilarr ([Profilarr](https://github.com/Dictionarry-Hub/profilarr)).

---

## 9. The Hybrid Model: SQL Schema + JSON/YAML Data

### Architecture

```
+-------------------------------------------+
|           AUTHORING LAYER                 |
|                                           |
|   YAML files    JSON files    Web UI      |
|   (human)       (machine)     (visual)    |
+------|--------------|-----------|--------+
       |              |           |
       v              v           v
+-------------------------------------------+
|        INGESTION & VALIDATION LAYER       |
|                                           |
|   JSON Schema validation                  |
|   Entity relationship validation          |
|   Cross-entity dependency resolution      |
|   Value guard generation                  |
+-------------------------------------------+
       |
       v
+-------------------------------------------+
|           COMPILATION LAYER               |
|                                           |
|   JSON/YAML -> Kysely queries -> SQL ops  |
|   Metadata generation                     |
|   Content hashing                         |
|   Conflict detection                      |
+-------------------------------------------+
       |
       v
+-------------------------------------------+
|           STORAGE LAYER                   |
|                                           |
|   pcd_ops table (append-only SQL ops)     |
|   In-memory SQLite cache (compiled view)  |
|   Git repository (distributed storage)    |
+-------------------------------------------+
       |
       v
+-------------------------------------------+
|           DISTRIBUTION LAYER              |
|                                           |
|   Git repo (ops/*.sql)                    |
|   JSON API (entities/*.json)              |
|   YAML export (for human consumption)     |
|   SQL ops export (for backward compat)    |
+-------------------------------------------+
```

### Why This Is the Best of Both Worlds

1. **SQL DDL stays as the schema definition**: The PCD schema (`0.schema.sql`) continues to define tables, foreign keys, constraints, and triggers. SQL is the natural and correct language for this. No change needed.

2. **JSON/YAML becomes the data authoring format**: Contributors write entity definitions in YAML (or JSON). The system validates them against JSON Schema, resolves dependencies, and compiles to SQL ops. The SQL is generated, not authored.

3. **The portable types already exist**: Praxrr's `portable.ts` already defines `PortableCustomFormat`, `PortableQualityProfile`, etc. -- JSON-friendly representations with no database IDs or timestamps. These are the JSON/YAML schema, waiting to be formalized.

4. **The serializer/deserializer already exists**: `serialize.ts` reads from PCD cache and produces portable JSON. `deserialize.ts` takes portable JSON and produces SQL ops. The ingestion layer is the natural extension: read YAML/JSON files and feed them through the same deserializer.

5. **The writer pipeline is format-agnostic**: `writer.ts` accepts `CompiledQuery[]` from Kysely. Whether those queries are generated from parsed YAML or from UI interactions does not matter. The validation, conflict detection, and history tracking work the same way.

### What Changes

| Component                | Current                   | Proposed                                                      |
| ------------------------ | ------------------------- | ------------------------------------------------------------- |
| praxrr-db repo structure | `ops/*.sql`               | `entities/{cf,qp,dp,re,...}/*.yaml` + `ops/*.sql` (generated) |
| Contributor workflow     | Write SQL ops             | Write YAML entity files                                       |
| Schema definition        | `0.schema.sql`            | `0.schema.sql` (unchanged)                                    |
| Validation               | SQL execution in sandbox  | JSON Schema + SQL execution                                   |
| Distribution             | Git clone + SQL replay    | Git clone + JSON API + SQL replay                             |
| Import pipeline          | Parse SQL files           | Parse YAML/JSON files -> generate SQL                         |
| Export pipeline          | Write SQL file + git push | Write YAML/JSON + SQL file + git push                         |

### What Does Not Change

- The append-only ops model
- The in-memory SQLite cache compilation
- The value guard conflict detection system
- The user ops / base ops layer separation
- The Kysely query builder pipeline
- The Arr sync engine

**Confidence**: High -- this is an incremental evolution, not a rewrite. The existing portable types and serialize/deserialize infrastructure are the foundation.

---

## 10. Implementation Roadmap (Forward-Looking)

### Phase 1: Schema Formalization (Low Risk)

- Formalize `portable.ts` types as JSON Schema definitions
- Publish `pcd.schema.json` alongside the SQL DDL schema
- Enable IDE validation for any JSON/YAML files matching the schema
- No runtime changes; purely additive

### Phase 2: YAML Ingestion Layer (Medium Risk)

- Build a YAML/JSON file reader that produces `PortableEntity` objects
- Route through existing `deserialize.ts` -> Kysely -> SQL ops pipeline
- Add YAML entity files to praxrr-db alongside existing SQL ops
- Dual-format period: SQL ops continue to work, YAML is optional

### Phase 3: API Distribution (Medium Risk)

- CI/CD pipeline compiles YAML entities to JSON API artifacts
- Publish to GitHub Pages or CDN
- npm/JSR package for typed consumption
- praxrr-db becomes consumable without Git clone

### Phase 4: TRaSH-Guides Import Adapter (Medium Risk)

- Adapter maps TRaSH JSON -> Praxrr portable format
- One-click import in Praxrr UI
- trash_id mapping table for ongoing tracking
- Change detection for upstream TRaSH updates

### Phase 5: AI-Assisted Authoring (Lower Priority)

- JSON Schema-constrained LLM generation for new entities
- Natural language -> entity definition pipeline
- Automated TRaSH-Guides tracking agent
- Config recommendation engine

---

## Uncertainties and Gaps

1. **TRaSH-Guides stability**: The February 2026 breaking changes demonstrate that TRaSH-Guides' format evolves independently. Any tight coupling carries maintenance risk. The adapter approach (Section 1) mitigates this, but ongoing adaptation effort is non-zero.

2. **Profilarr/Praxrr ecosystem dynamics**: Profilarr uses the PCD format and references "Profilarr Compliant Databases." The relationship between Praxrr and Profilarr is unclear from public sources. If they share a PCD specification, format changes must be coordinated. If they diverge, each can evolve independently.

3. **YAML comment preservation**: YAML supports comments, which are valuable for human authoring but lost during JSON round-trips. If praxrr-db stores YAML with comments, the YAML -> JSON -> YAML pipeline must preserve them (libraries like `yaml` for Node.js can do this, but it requires care).

4. **Schema migration for existing praxrr-db repositories**: Existing PCD repositories contain only SQL ops. Migrating them to include YAML entity files requires either a one-time conversion tool or a gradual dual-format period.

5. **Relational validation in JSON Schema**: JSON Schema cannot express cross-entity constraints (e.g., "this custom format name must exist in the custom_formats collection"). This validation must happen in the compilation layer, not the schema layer.

---

## Search Queries Executed

1. `TRaSH-Guides JSON format custom formats Radarr Sonarr 2025 2026`
2. `Recyclarr YAML configuration format schema 2025 2026`
3. `Configarr media server configuration tool JSON YAML 2025 2026`
4. `JSON Schema config-as-data pattern infrastructure configuration management trends 2025 2026`
5. `LLM AI code generation JSON vs SQL structured data generation validation 2025`
6. `TRaSH-Guides API endpoint JSON custom formats programmatic access`
7. `TRaSH-Guides GitHub repository JSON structure custom formats directory layout`
8. `Profilarr custom formats quality profiles Radarr Sonarr web UI 2025 2026`
9. `Profilarr Praxrr relationship "PCD" "Praxrr Compliant Database" configuration database`
10. `config as code JSON Schema evolution versioning migration strategies 2025`
11. `media server automation standardization Arr ecosystem config format future Prowlarr Lidarr 2025 2026`
12. `JSON Schema LLM constrained decoding structured output generation tools 2025 2026`
13. `"hybrid SQL JSON" schema data configuration "best of both worlds" pattern`
14. `git diff JSON YAML versus SQL readability changelog generation structured diff tools`
15. `Recyclarr JSON Schema config validation schema file GitHub 2025`

---

## Sources

- [TRaSH-Guides Custom Formats Collection](https://trash-guides.info/Radarr/Radarr-collection-of-custom-formats/)
- [TRaSH-Guides Import Custom Formats](https://trash-guides.info/Radarr/Radarr-import-custom-formats/)
- [TRaSH-Guides metadata.schema.json](https://github.com/TRaSH-Guides/Guides/blob/master/metadata.schema.json)
- [TRaSH-Guides metadata.json](https://github.com/TRaSH-Guides/Guides/blob/master/metadata.json)
- [TRaSH-Guides CONTRIBUTING.md](https://github.com/TRaSH-Guides/Guides/blob/master/CONTRIBUTING.md)
- [Recyclarr Custom Formats Reference](https://recyclarr.dev/reference/configuration/custom-formats/)
- [Recyclarr Configuration Reference](https://recyclarr.dev/wiki/yaml/config-reference/)
- [Recyclarr Schema Validation](https://recyclarr.dev/guide/schema-validation/)
- [Recyclarr Config Templates](https://github.com/recyclarr/config-templates)
- [Configarr - Configuration Management Simplified](https://configarr.de/)
- [Configarr Configuration File](https://configarr.de/docs/configuration/config-file/)
- [Configarr GitHub](https://github.com/raydak-labs/configarr)
- [Profilarr GitHub](https://github.com/Dictionarry-Hub/profilarr)
- [Profilarr Wiki - Developing Custom Formats](https://github.com/Dictionarry-Hub/profilarr/wiki/Developing-Custom-Formats-&-Quality-Profiles)
- [Dictionarry Database GitHub](https://github.com/Dictionarry-Hub/database)
- [JSON Schema Official Site](https://json-schema.org/)
- [Confluent Schema Evolution](https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html)
- [Schema Versioning Strategies](https://app.studyraid.com/en/read/12384/399934/schema-versioning-strategies)
- [JSON Schema for LLM Structured Outputs](https://blog.promptlayer.com/how-json-schema-works-for-structured-outputs-and-tool-integration/)
- [Structured Output in LLMs - JSON Schema and Grammar-Based Decoding](https://medium.com/@emrekaratas-ai/structured-output-generation-in-llms-json-schema-and-grammar-based-decoding-6a5c58b698a6)
- [LLM SQL Generation - Text-to-SQL Strategies](https://promethium.ai/guides/llm-ai-models-text-to-sql/)
- [dyff - YAML diff tool](https://github.com/homeport/dyff)
- [graphtage - Semantic diff utility](https://github.com/trailofbits/graphtage)
- [jd - JSON diff and patch](https://github.com/josephburnett/jd)
- [Recyclarr TRaSH-Guides Structure](https://recyclarr.dev/reference/settings/resource-providers/trash-guides-structure/)
- [Servarr Wiki](https://wiki.servarr.com/)
- [JSON-Based Dynamic Configuration Management (IETF)](https://www.ietf.org/archive/id/draft-abaris-json-dcm-00.html)
- [Oracle Bridging JSON Schema and Relational Databases](https://json-schema.org/blog/posts/oracle-case-study)
