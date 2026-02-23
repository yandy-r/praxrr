# Research: UX -- PCD Data Migration (SQL to YAML/JSON Entity Format)

## Executive Summary

This research covers the developer/maintainer experience for converting existing PCD SQL ops files
to a hybrid YAML/JSON entity format. The primary users are PCD maintainers running conversions,
developers verifying correctness, and content authors editing YAML entity files. The UX concerns
center on CLI script experience, progress reporting, error handling, diff-friendly output,
validation reporting, and YAML authoring conventions. Industry patterns from Recyclarr, Configarr,
Buildarr, Atlas, Helm, and general config-as-code tooling inform the recommendations.

**Confidence**: High -- based on direct analysis of 10+ config-as-code tools in the Arr ecosystem
and adjacent domains, plus established CLI UX literature.

## 1. User Workflows

### 1.1 PCD Maintainer Running Conversion for First Time

**Workflow steps:**

1. Invoke conversion script via `deno task` (e.g., `deno task pcd:convert` or
   `deno task pcd:migrate`).
2. Script reads SQL ops files from `packages/praxrr-db/ops/` and schema from
   `packages/praxrr-schema/`.
3. Progress is reported per entity type (tags, regular expressions, custom formats, quality
   profiles, etc.).
4. Output YAML/JSON entity files are written to a target directory.
5. Summary report shows counts: converted, skipped, failed.
6. Maintainer reviews output files and commits to version control.

**Key UX needs:**

- Zero-config happy path: running the command with no arguments should do the right thing with
  sensible defaults.
- Dry-run mode: preview what would be generated without writing files (`--dry-run`).
- Output directory control: `--output <dir>` flag with a sensible default.
- Verbose mode: `--verbose` for debugging, quiet by default but with essential summary output.

**Confidence**: High -- follows established patterns from Atlas, Flyway, Recyclarr CLI tools.

### 1.2 Developer Verifying Conversion Correctness

**Workflow steps:**

1. Run conversion to produce YAML/JSON output.
2. Run parity check command (e.g., `deno task pcd:verify` or `deno task pcd:parity`).
3. Parity check compiles SQL ops into in-memory SQLite, parses YAML entities, and compares
   row-by-row.
4. Report shows entity-level match/mismatch with field-level diff for failures.
5. Developer fixes mismatches and reruns until 100% parity.

**Key UX needs:**

- Clear pass/fail per entity with drill-down into field-level differences.
- Side-by-side or unified diff output for mismatched fields.
- Exit code reflects overall pass/fail for CI integration.
- Machine-readable output option (`--format json`) for CI pipelines.

**Confidence**: High -- modeled after Atlas migration linting and Datafold data parity validation.

### 1.3 Content Author Editing YAML Entity Files

**Workflow steps:**

1. Open YAML entity file in editor (VS Code, vim, etc.).
2. Edit fields following documented conventions (key ordering, types, naming).
3. Run validation command (e.g., `deno task pcd:validate`) to check schema conformance.
4. Commit changes; CI runs validation automatically.

**Key UX needs:**

- YAML files must be self-documenting: clear key names, inline comments where helpful.
- JSON Schema for IDE autocompletion and inline validation.
- Consistent key ordering for predictable file structure.
- Example files and templates for each entity type.

**Confidence**: High -- well-established patterns from Kubernetes, Helm, Recyclarr, Configarr.

### 1.4 CI/CD Integration for Conversion Validation

**Workflow steps:**

1. PR changes YAML entity files.
2. CI pipeline runs `deno task pcd:validate` to check schema conformance.
3. CI runs `deno task pcd:parity` to verify SQL/YAML parity (during migration period).
4. CI reports pass/fail with actionable error messages.
5. CI can optionally run `deno task pcd:compile` to verify YAML entities compile to valid SQL.

**Key UX needs:**

- Non-zero exit codes on any failure.
- GitHub Actions-compatible output (annotations, step summaries).
- Deterministic output for reproducible CI runs.
- Fast execution: validation should complete in seconds, not minutes.

**Confidence**: High -- Atlas and Recyclarr both provide strong CI integration patterns.

## 2. UI/UX Best Practices

### 2.1 CLI Tool Progress Reporting Patterns

**Industry standard (Deno context):**

Deno's `@std/cli` package provides built-in `Spinner` and `ProgressBar` components (currently
`unstable-spinner` and `unstable-progress-bar`).

**Recommended patterns:**

| Scenario                        | Pattern              | Example                                 |
| ------------------------------- | -------------------- | --------------------------------------- |
| Unknown duration (compiling)    | Spinner with message | `Compiling SQL ops...`                  |
| Known count (entity conversion) | X of Y counter       | `Converting custom formats... [42/156]` |
| Large batch with ETA            | Progress bar         | `[###-------] 27% (42/156) ETA: 3s`     |
| Multi-phase operation           | Phase labels         | `Phase 1/3: Parsing SQL...`             |

**Best practices (from Evil Martians CLI UX research):**

- The X of Y pattern should be the default for batch operations. It communicates progress without
  requiring visual progress bars.
- Throttle progress updates to 100ms intervals to prevent stdout buffer overflow and excessive
  memory usage.
- Use spinners only for operations where total count is unknown.
- After completion, replace spinner/progress with a final summary line.

**Deno-specific implementation:**

```typescript
import { Spinner } from '@std/cli/unstable-spinner';
import { ProgressBar } from '@std/cli/unstable-progress-bar';

// For unknown-duration phases
const spinner = new Spinner({ message: 'Compiling SQL ops...' });
spinner.start();
// ... work ...
spinner.stop();

// For known-count phases, prefer simple console output with carriage return
const total = entities.length;
for (let i = 0; i < total; i++) {
  Deno.stderr.writeSync(new TextEncoder().encode(`\rConverting: ${i + 1}/${total}`));
}
```

**Confidence**: High -- `@std/cli` is the official Deno standard library for CLI components; Evil
Martians patterns are widely cited in CLI UX literature.

**Sources:**

- <https://jsr.io/@std/cli/doc/unstable-spinner>
- <https://jsr.io/@std/cli/doc/unstable-progress-bar/~/ProgressBarOptions>
- <https://evilmartians.com/chronicles/cli-ux-best-practices-3-patterns-for-improving-progress-displays>
- <https://medium.com/deno-the-complete-reference/progress-indicator-for-cli-apps-in-deno-4d193a9812af>

### 2.2 Configuration-as-Code File Format Best Practices

**YAML readability conventions (from Kubernetes, Helm, Recyclarr, Configarr):**

1. **Indentation**: 2 spaces, never tabs. Consistent across all files.
2. **Key naming**: `snake_case` for all keys. Matches existing PCD schema column names.
3. **Key ordering**: Deterministic order within each entity type. Recommended approach:
   - Identity fields first (`name`, `type`, `arr_type`).
   - Core data fields next (alphabetical within category).
   - Relationship/reference fields after (`tags`, `conditions`, `qualities`).
   - Metadata last (`description`, `created_at`, `updated_at`).
4. **Boolean values**: Use only `true`/`false`, never `yes`/`no`/`on`/`off` (Helm convention to
   avoid YAML spec ambiguity).
5. **String quoting**: Quote strings that could be misinterpreted (numbers, booleans, special YAML
   characters). Use single quotes for simple strings, double quotes when escape sequences are
   needed.
6. **Comments**: Use `#` comments for non-obvious fields. Add section headers for large files.
   Comments are a key advantage of YAML over JSON.
7. **Lists**: Use block style (dashes), not flow style (brackets), for diff-friendliness.
8. **Line length**: Cap at 100 characters (matching project Prettier config).
9. **Blank lines**: One blank line between top-level sections for readability.
10. **No trailing whitespace**: Enforced by Prettier.

**File organization patterns (from Recyclarr, Configarr, Buildarr, Doctrine ORM):**

| Pattern                   | Description                            | When to Use                                                        |
| ------------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| One file per entity       | `custom-formats/AMZN.yaml`             | Large entities with many fields (custom formats, quality profiles) |
| One file per entity type  | `custom-formats.yaml`                  | Smaller entities (tags, languages)                                 |
| Directory per entity type | `custom-formats/`, `quality-profiles/` | All entity types with multiple instances                           |
| Index file per directory  | `custom-formats/index.yaml`            | When directory metadata is needed                                  |

**Recommended for Praxrr PCD:**

```
entities/
  tags.yaml                          # All tags in one file (simple entities)
  regular-expressions/
    AMZN.yaml                        # One file per regex (complex entities)
    3D.yaml
    ...
  custom-formats/
    AMZN.yaml                        # One file per CF
    DTS-HD-MA.yaml
    ...
  quality-profiles/
    1080p-Quality.yaml               # One file per QP
    2160p-Balanced.yaml
    ...
  media-management/
    radarr-naming.yaml
    sonarr-naming.yaml
    ...
```

**Confidence**: High -- one-file-per-entity pattern is used by Doctrine ORM, Drupal config
management, Kubernetes CRDs, and aligns with diff-friendly version control.

**Sources:**

- <https://recyclarr.dev/reference/configuration/>
- <https://recyclarr.dev/reference/configuration/custom-formats/>
- <https://configarr.de/docs/configuration/config-file/>
- <https://buildarr.github.io/configuration/>
- <https://helm.sh/docs/v2/chart_best_practices/conventions/>
- <https://kubernetes.io/blog/2025/11/25/configuration-good-practices/>
- <https://moldstud.com/articles/p-streamline-your-yaml-code-best-practices-for-enhanced-readability>

### 2.3 Error Message Patterns for Data Conversion Tools

**Structured error reporting (industry consensus):**

Errors should be categorized into three tiers:

1. **Fatal errors**: Cannot continue (schema file missing, output directory not writable). Exit
   immediately with clear message and non-zero exit code.
2. **Entity-level errors**: Individual entity failed to convert. Log error, continue processing
   remaining entities, include in summary.
3. **Warnings**: Non-blocking issues (deprecated field, missing optional data). Log but do not
   affect exit code.

**Error message format (from CLI error handling best practices):**

```
ERROR [custom_format:AMZN]: Failed to resolve condition reference
  condition: "AMZN Streaming"
  expected table: condition_patterns
  actual table: (not found)
  hint: Check that regular_expression "AMZN" exists in the source SQL

WARNING [quality_profile:1080p-Quality]: Field 'upgrade_score_increment' uses default value
  default: 1
  hint: Explicitly set this field if the default is intentional
```

**Key principles:**

- Include entity type and name in every error for context.
- Provide the expected vs. actual values.
- Include an actionable `hint` field suggesting remediation.
- Use consistent prefixes: `ERROR`, `WARNING`, `INFO`.
- Color-code in terminal: red for errors, yellow for warnings, no color for info.
- Support `--no-color` flag and `NO_COLOR` environment variable.

**Confidence**: High -- patterns align with Atlas migration linting (diagnostic codes + context),
Recyclarr validation output, and general CLI error handling literature.

**Sources:**

- <https://atlasgo.io/versioned/lint>
- <https://atlasgo.io/lint/analyzers>

### 2.4 Diff-Friendly Output Formatting

**Key practices for version-control-friendly YAML output:**

1. **Sorted keys**: All keys within an entity must be sorted in a deterministic order. This prevents
   meaningless diffs when regenerating files.
2. **Consistent whitespace**: Exact same indentation, blank line placement, and trailing newline in
   every generated file.
3. **One item per line**: List items on separate lines (block style), never flow style.
4. **Stable serialization**: Numbers, booleans, and strings must serialize identically across runs.
   Avoid floating-point representation differences.
5. **Trailing newline**: All files end with exactly one newline character (POSIX convention,
   enforced by most linters).
6. **No timestamps in generated output**: Do not embed generation timestamps in output files; they
   create unnecessary diffs. Record generation metadata in a separate manifest file if needed.

**Tools for YAML diffing:**

- `dyff`: Semantic YAML diff tool that understands YAML structure, retains key order, and provides
  human-readable change descriptions. Available at <https://github.com/homeport/dyff>.
- `yq sort_keys`: Can normalize YAML key ordering for comparison.
- Standard `diff` or `git diff`: Work well when keys are sorted and formatting is consistent.

**Confidence**: High -- sorted-key deterministic serialization is a well-established practice in
config-as-code tooling.

**Sources:**

- <https://github.com/homeport/dyff>
- <https://mikefarah.gitbook.io/yq/operators/sort-keys>
- <https://peterlyons.com/problog/2019/04/sorting-yaml-keys/>
- <https://www.yamldiff.com/>

## 3. Error Handling UX

### 3.1 Entity-Level Conversion Failures Without Halting the Batch

**Pattern: Collect-and-Continue**

The conversion tool should never halt on a single entity failure. Instead:

1. Catch the error at the entity boundary.
2. Record the failure with full context (entity type, name, error details).
3. Continue processing remaining entities.
4. Report all failures in the final summary.

**Implementation pattern:**

```typescript
interface ConversionResult {
  entity_type: string;
  entity_name: string;
  status: 'converted' | 'skipped' | 'failed';
  error?: string;
  hint?: string;
}

const results: ConversionResult[] = [];

for (const entity of entities) {
  try {
    const yaml = convertEntity(entity);
    writeFile(outputPath, yaml);
    results.push({ entity_type, entity_name, status: 'converted' });
  } catch (err) {
    results.push({
      entity_type,
      entity_name,
      status: 'failed',
      error: err.message,
      hint: deriveHint(err),
    });
  }
}
```

**Exit codes:**

| Code | Meaning                                       |
| ---- | --------------------------------------------- |
| 0    | All entities converted successfully           |
| 1    | One or more entities failed (partial success) |
| 2    | Fatal error (could not start conversion)      |

**Confidence**: High -- collect-and-continue is the standard pattern for batch data conversion tools
(AWS DMS, Adobe Commerce Data Migration Tool, SSIS).

### 3.2 Parity Check Failure Reporting with Actionable Details

**Report structure:**

```
=== PCD Parity Check Report ===

Source: packages/praxrr-db/ops/ (SQL, 49 files)
Target: entities/ (YAML, 312 files)

PASS  tags: 70/70 entities match
PASS  languages: 183/183 entities match
PASS  regular_expressions: 245/245 entities match
FAIL  custom_formats: 154/156 entities match (2 failures)
PASS  quality_profiles: 12/12 entities match

--- Failures ---

FAIL  [custom_format:AMZN]
  Field 'include_in_rename':
    SQL value:  1
    YAML value: 0
  Hint: Check the boolean conversion for integer fields.

FAIL  [custom_format:DTS-HD MA]
  Missing condition: "DTS-HD MA Pattern"
    Expected condition in SQL but not found in YAML output.
  Hint: Verify condition_patterns join for this custom format.

--- Summary ---

Total entities:  666
Passed:          664 (99.7%)
Failed:          2 (0.3%)

Exit code: 1
```

**Key principles:**

- Group results by entity type for scanability.
- Show pass counts even for passing categories (builds confidence).
- Drill down only into failures with field-level detail.
- Include percentage for quick assessment.
- Machine-readable option: `--format json` outputs structured JSON for CI consumption.

**Confidence**: High -- modeled after Datafold parity validation methodology and Atlas lint
reporting.

**Sources:**

- <https://www.datafold.com/data-migration-guide/validate-prove-parity>
- <https://atlasgo.io/versioned/lint>

### 3.3 Handling Partial Conversions

**Strategy: Write-All-Then-Report**

1. Convert all entities, writing successes to the output directory immediately.
2. Track failures in memory.
3. At the end, write a `conversion-report.json` file alongside the output.
4. Print summary to stderr.
5. Exit with code 1 if any failures exist.

**The conversion report file:**

```json
{
  "generated_at": "2026-02-23T10:00:00Z",
  "source": "packages/praxrr-db/ops/",
  "target": "entities/",
  "summary": {
    "total": 666,
    "converted": 664,
    "skipped": 0,
    "failed": 2
  },
  "failures": [
    {
      "entity_type": "custom_format",
      "entity_name": "AMZN",
      "error": "Failed to resolve condition reference",
      "hint": "Check condition_patterns join"
    }
  ]
}
```

**Recovery workflow:**

1. Fix the underlying issue (source SQL, converter logic, or entity definition).
2. Rerun conversion with `--only-failed` flag to reconvert only previously failed entities.
3. Or rerun full conversion (idempotent -- overwrites existing files).

**Confidence**: Medium -- the `--only-failed` retry pattern is less common but highly useful; the
report file pattern is well-established.

## 4. Performance UX

### 4.1 Progress Indicators for Large Conversions

Given the Praxrr DB currently has ~666 entities across ~50 SQL ops files, conversion should complete
in seconds. However, the progress reporting pattern should scale to larger databases.

**Recommended approach:**

```
Phase 1/3: Parsing SQL ops...
  Parsed 49 files in 0.2s

Phase 2/3: Converting entities...
  Tags:                 70/70   done
  Regular Expressions: 245/245  done
  Custom Formats:      156/156  done  (2 warnings)
  Quality Profiles:     12/12   done
  ...

Phase 3/3: Writing YAML files...
  312 files written to entities/
```

**Design decisions:**

- Use phase labels for the overall pipeline (parse, convert, write).
- Use X of Y counters per entity type within the convert phase.
- Do not use a progress bar for <1000 items -- the X of Y pattern is clearer and more informative.
- Reserve progress bars for truly large operations (>1000 items or >10 seconds).

**Confidence**: High -- X of Y is the established pattern for batch operations with known counts
under 1000 items.

### 4.2 Summary Statistics After Conversion

**Standard summary format:**

```
=== Conversion Complete ===

Entities:
  Converted:  664
  Skipped:      0
  Failed:       2
  Total:      666

Files:
  Written:    312
  Directory:  entities/

Duration:     1.4s
```

**Key principles:**

- Always show the summary, even on success (builds trust).
- Include wall-clock duration for performance tracking.
- Show file count separately from entity count (multiple entities may share a file, or one entity
  may produce multiple files).
- Align numbers for readability.

**Confidence**: High -- summary statistics are universal in batch processing tools.

### 4.3 Time Estimation for Batch Operations

For the expected scale (<1000 entities), time estimation is unnecessary. If scale increases:

- Use exponential moving average of per-entity conversion time to estimate remaining time.
- Display ETA only after processing at least 10% of entities (to avoid wildly inaccurate early
  estimates).
- Format as `ETA: ~Xs` or `ETA: ~Xm Ys` for longer operations.

**Confidence**: Medium -- time estimation adds complexity and is only valuable for operations
taking >10 seconds.

## 5. Competitive Analysis

### 5.1 Recyclarr

**Config file generation:** Recyclarr provides `recyclarr config create -t` to deploy pre-built YAML
configuration templates. Users choose a template and the tool generates a complete config file.

**YAML structure highlights:**

- Uses `trash_id` (hex hashes) as stable entity identifiers.
- Custom formats and quality profiles are organized under service type (`radarr:`, `sonarr:`) and
  instance name.
- `assign_scores_to` creates explicit entity-to-profile relationships.
- `secrets.yml` separates sensitive values from config.
- Full YAML validation on load (even unused sections must be syntactically valid).

**Migration patterns:** Recyclarr handles config file merging carefully -- sections under instance
names must be merged without duplication. This is relevant to PCD entity file merging.

**Relevance to PCD:** Recyclarr's `trash_id` as stable identifier maps well to PCD's name-based
primary keys. The per-service-type organization is analogous to PCD's `arr_type` scoping.

**Confidence**: High -- direct analysis of Recyclarr documentation.

**Sources:**

- <https://recyclarr.dev/reference/configuration/>
- <https://recyclarr.dev/reference/configuration/custom-formats/>
- <https://recyclarr.dev/wiki/yaml/config-examples/>

### 5.2 Configarr

**Config file structure:** Single `config.yml` with optional `secrets.yml`. Supports custom YAML
tags (`!env`, `!secret`, `!file`) for dynamic value injection. Feature flags per Arr type
(`sonarrEnabled`, `radarrEnabled`, etc.).

**Custom format definitions:** Allows inline custom format definitions with `trash_id`,
`trash_scores`, `name`, `specifications` including `implementation`, `negate`, `required`, and
`fields`.

**Relevance to PCD:** Configarr's inline custom format definition structure is very close to what
PCD YAML entity files should look like. The `specifications` array with typed implementations maps
to PCD's condition polymorphism.

**Confidence**: High -- direct analysis of Configarr documentation.

**Sources:**

- <https://configarr.de/docs/configuration/config-file/>

### 5.3 Notifiarr

**Config-as-code approach:** Notifiarr uses a `.conf` file (TOML-like) rather than YAML.
Configuration is primarily done through a web UI, with the config file serving as a bootstrap
mechanism. Multiple instances are configured via numbered environment variables (`DN_SONARR_1_URL`,
`DN_SONARR_2_URL`).

**Relevance to PCD:** Limited. Notifiarr's approach is UI-first, not config-as-code-first. The main
takeaway is that TOML and numbered env vars are less maintainable than structured YAML for complex
entity definitions.

**Confidence**: Medium -- Notifiarr's config approach is not directly comparable to PCD's needs.

**Sources:**

- <https://notifiarr.wiki/pages/client/configuration/>
- <https://notifiarr.wiki/pages/integrations/radarr/>

### 5.4 Buildarr

**Declarative configuration:** Buildarr uses `buildarr.yml` with a "don't touch what is not
explicitly defined" philosophy. Only configured values are synchronized -- missing keys are left
unchanged on the remote instance.

**Multi-file organization:** Uses `includes` directive with depth-first-search merging. Last-read
file values take precedence. Relative paths resolve from the defining file's parent directory.

**Relevance to PCD:** Buildarr's include/merge pattern is relevant if PCD entity files need
cross-file references or shared defaults. The "explicit over implicit" philosophy aligns with PCD's
value guard approach.

**Confidence**: High -- direct analysis of Buildarr documentation.

**Sources:**

- <https://buildarr.github.io/configuration/>

### 5.5 Database Migration Tools (Atlas, Flyway, Liquibase)

**Atlas (most relevant):**

- Schema-as-code declarative approach: define desired state, tool computes diff.
- Migration linting with 50+ automated checks, categorized by diagnostic codes (e.g., `DS103` for
  destructive changes).
- `--format` flag accepts Go templates for custom output formatting.
- `-w`/`--web` flag opens browser-based lint report.
- `atlas migrate lint` integrates with GitHub Actions, GitLab CI.
- Supports importing migration folders from Flyway, Liquibase, Goose, and golang-migrate formats.
- `--atlas:nolint` directive for selectively suppressing checks (file-level, statement-level,
  analyzer-class-level).

**Flyway:**

- Plain SQL migration scripts, numbered sequentially.
- Developer-oriented, lightweight.
- Limited built-in validation compared to Atlas.

**Liquibase:**

- Supports SQL, XML, YAML, and JSON changelog formats.
- Enterprise-oriented with extensive validation features.
- Changeset-based tracking.

**Relevance to PCD:** Atlas's format conversion (importing from other tools) and migration linting
(automated safety checks with diagnostic codes) are directly applicable to PCD's SQL-to-YAML
conversion. The `--format` templating pattern is useful for CI integration.

**Confidence**: High -- Atlas and Flyway are well-documented with clear parallels to PCD migration.

**Sources:**

- <https://atlasgo.io/atlas-vs-others>
- <https://atlasgo.io/versioned/lint>
- <https://atlasgo.io/versioned/import>
- <https://atlasgo.io/lint/analyzers>

### 5.6 Kubernetes/Helm YAML Conventions

**Key conventions applicable to PCD:**

- 2-space indentation, no tabs.
- Chart.yaml contains metadata (analogous to PCD's `pcd.json`).
- values.yaml groups related parameters under parent keys with logical hierarchy.
- `helm lint` validates chart structure before deployment.
- `helm diff` plugin previews changes before applying.
- Boolean values: use only `true`/`false`.
- Version numbers: wrap in quotes to force string parsing.
- Labels follow naming convention: `app.kubernetes.io/name`, `app.kubernetes.io/version`.

**Relevance to PCD:** Helm's conventions for YAML formatting, validation (`lint`), and preview
(`diff`) directly inform PCD entity file conventions and tooling requirements.

**Confidence**: High -- Kubernetes/Helm YAML conventions are the de facto industry standard.

**Sources:**

- <https://helm.sh/docs/v2/chart_best_practices/conventions/>
- <https://kubernetes.io/blog/2025/11/25/configuration-good-practices/>
- <https://atmosly.com/knowledge/helm-charts-in-kubernetes-definitive-guide-for-2025>

## 6. YAML Authoring Experience Recommendations

### 6.1 Entity File Structure (Custom Format Example)

```yaml
# Custom Format: AMZN
name: AMZN
description: 'Matches Amazon Prime Video releases'
include_in_rename: true

tags:
  - Streaming Service

conditions:
  - name: AMZN Streaming
    type: release_title
    arr_type: all
    negate: false
    required: false
    pattern:
      regular_expression: AMZN

tests:
  - title: 'Movie.2024.AMZN.WEB-DL.1080p.DDP5.1.H.264-GROUP'
    type: movie
    should_match: true
    description: 'Standard AMZN WEB-DL release'
  - title: 'Movie.2024.NF.WEB-DL.1080p.DDP5.1.H.264-GROUP'
    type: movie
    should_match: false
    description: 'Netflix release should not match AMZN'
```

### 6.2 Entity File Structure (Quality Profile Example)

```yaml
# Quality Profile: 1080p Quality
name: 1080p Quality
description: 'Quality-focused 1080p profile prioritizing Bluray and REMUX sources'
upgrades_allowed: true
minimum_custom_format_score: 0
upgrade_until_score: 100000
upgrade_score_increment: 1

tags:
  - 1080p
  - Quality
  - Quality Focused

languages:
  - name: English
    type: simple

qualities:
  - quality_name: Bluray-1080p
    position: 1
    enabled: true
    upgrade_until: true
  - quality_group_name: WEB 1080p
    position: 2
    enabled: true
    upgrade_until: false

quality_groups:
  - name: WEB 1080p
    members:
      - WEBDL-1080p
      - WEBRip-1080p

scoring:
  - custom_format_name: AMZN
    arr_type: all
    score: 10000
  - custom_format_name: DTS-HD MA
    arr_type: radarr
    score: 15000
```

### 6.3 Key Ordering Convention

For consistency and diff-friendliness, keys within each entity type should follow a fixed order:

**All entities:**

1. `name` (identity)
2. `description` (optional)
3. Type-specific core fields (alphabetical)
4. Relationship arrays (`tags`, `conditions`, `qualities`, `scoring`)
5. Test data (`tests`)

### 6.4 YAML Anchors and Aliases

YAML anchors (`&`) and aliases (`*`) can reduce duplication within a single file. However, they have
significant limitations:

- Anchors are scoped to a single file -- they cannot cross file boundaries.
- They reduce readability for unfamiliar users.
- They complicate diffs when the anchor definition changes.

**Recommendation:** Avoid anchors/aliases in PCD entity files. Prefer explicit duplication of short
values. Use cross-file references via entity names (which are already the PCD stable key mechanism).

**Confidence**: High -- Helm and Kubernetes documentation explicitly recommend avoiding anchors for
maintainability.

**Sources:**

- <https://www.linode.com/docs/guides/yaml-anchors-aliases-overrides-extensions/>
- <https://smcleod.net/2022/11/yaml-anchors-and-aliases/>

### 6.5 JSON Schema for Validation

Provide a JSON Schema file for each entity type to enable:

- IDE autocompletion in VS Code (via YAML extension + schema association).
- CLI validation via `deno task pcd:validate`.
- CI validation in GitHub Actions.

The schema should be published alongside the entity format specification and referenced from entity
files via a comment or `.vscode/settings.json` configuration.

**Confidence**: High -- JSON Schema for YAML validation is standard practice in Kubernetes, Helm,
and GitHub Actions.

## 7. Recommendations

### 7.1 Must Have

1. **Collect-and-continue error handling**: Never halt batch conversion on a single entity failure.
   Record all failures and report in summary.
2. **Deterministic key ordering**: All generated YAML files must have keys in a fixed, documented
   order for diff-friendly version control.
3. **Summary statistics after every operation**: Show converted/skipped/failed counts with total and
   wall-clock duration.
4. **Non-zero exit codes on failure**: Exit 0 on full success, exit 1 on partial failure, exit 2 on
   fatal error.
5. **Entity-level error messages with context**: Every error includes entity type, entity name,
   field name, expected vs. actual values, and an actionable hint.
6. **Parity check command**: A dedicated command that compiles SQL, parses YAML, and reports
   row-by-row/field-by-field comparison results.
7. **One file per entity for complex types**: Custom formats, quality profiles, regular expressions,
   and media management entities each get their own file. Simple entities (tags, languages) can
   share a file.
8. **snake_case keys matching PCD schema column names**: No translation layer between YAML key names
   and database column names.
9. **Boolean representation**: Use `true`/`false` only, never `0`/`1` in YAML output (even though
   SQLite stores integers).
10. **Dry-run mode**: `--dry-run` flag that shows what would be generated without writing files.

### 7.2 Should Have

1. **JSON output format for CI**: `--format json` flag for machine-readable output of conversion
   results and parity checks.
2. **JSON Schema files per entity type**: Enable IDE autocompletion and validation.
3. **Verbose mode**: `--verbose` flag for debugging conversion issues, showing per-field conversion
   decisions.
4. **Phase-based progress reporting**: Label each phase (parse, convert, write) with per-entity-type
   X of Y counters.
5. **Conversion report file**: Write `conversion-report.json` alongside output files for audit
   trail.
6. **Color-coded terminal output**: Red for errors, yellow for warnings, green for success. Support
   `--no-color` and `NO_COLOR` env var.
7. **Example entity files**: Ship template files for each entity type as reference documentation.
8. **Inline comments in generated YAML**: Add `#` comments for non-obvious fields (e.g.,
   `# 0 = disabled, 1 = enabled` for boolean-as-integer fields in the SQL source).

### 7.3 Nice to Have

1. **`--only-failed` retry flag**: Reconvert only entities that failed in the previous run (reads
   from `conversion-report.json`).
2. **Interactive diff review**: After parity check, offer to show side-by-side diff for each failed
   entity.
3. **Progress bars for large databases**: Use `@std/cli` ProgressBar when entity count exceeds 1000.
4. **GitHub Actions annotations**: Emit `::error::` and `::warning::` prefixed lines for GitHub
   Actions integration.
5. **`dyff` integration**: Shell out to `dyff` for semantic YAML diff in parity check reports when
   available.
6. **Watch mode**: `--watch` flag that re-validates on file changes during active editing sessions.
7. **Schema migration notes**: When the YAML format changes between versions, provide automated
   migration for entity files.

## 8. Open Questions

1. **Hybrid YAML/JSON split**: Which entity attributes should be YAML (human-edited) vs. JSON
   (machine-generated)? The custom format conditions with complex nested data (regex patterns,
   condition parameters) may benefit from JSON for precision, while top-level entity metadata
   benefits from YAML for readability.

2. **Generated vs. hand-authored files**: Should generated files be marked (e.g.,
   `# AUTO-GENERATED -- DO NOT EDIT`) to distinguish them from hand-authored files? Or should all
   entity files be treated as editable source-of-truth after initial conversion?

3. **Cross-entity references**: How should YAML entity files reference other entities? By name
   string (matching PCD's name-based FKs) or by file path? Name-based references are simpler but
   require global uniqueness validation.

4. **Version metadata**: Should entity files include a format version field (e.g.,
   `format_version: 1`) to support future schema evolution? This adds complexity but enables
   automated migration.

5. **Arr-type scoping in directory structure**: Should `arr_type`-scoped entities (e.g., Radarr-only
   custom format conditions) be expressed within the entity file or via directory structure (e.g.,
   `custom-formats/radarr/`)? In-file scoping is simpler; directory scoping is more visible.

6. **Timestamps in entity files**: Should `created_at` and `updated_at` fields be preserved in YAML
   output? They create noise in diffs but may be useful for audit. Consider omitting them from YAML
   and letting the PCD compiler set them at compile time.

## References

- <https://recyclarr.dev/reference/configuration/>
- <https://recyclarr.dev/reference/configuration/custom-formats/>
- <https://recyclarr.dev/wiki/yaml/config-examples/>
- <https://configarr.de/docs/configuration/config-file/>
- <https://buildarr.github.io/configuration/>
- <https://atlasgo.io/atlas-vs-others>
- <https://atlasgo.io/versioned/lint>
- <https://atlasgo.io/versioned/import>
- <https://atlasgo.io/lint/analyzers>
- <https://helm.sh/docs/v2/chart_best_practices/conventions/>
- <https://kubernetes.io/blog/2025/11/25/configuration-good-practices/>
- <https://jsr.io/@std/cli/doc/unstable-spinner>
- <https://jsr.io/@std/cli/doc/unstable-progress-bar/~/ProgressBarOptions>
- <https://evilmartians.com/chronicles/cli-ux-best-practices-3-patterns-for-improving-progress-displays>
- <https://www.datafold.com/data-migration-guide/validate-prove-parity>
- <https://github.com/homeport/dyff>
- <https://mikefarah.gitbook.io/yq/operators/sort-keys>
- <https://moldstud.com/articles/p-streamline-your-yaml-code-best-practices-for-enhanced-readability>
- <https://moldstud.com/articles/p-ensuring-readability-in-yaml-practices-for-long-term-maintenance-best-tips-and-strategies>
- <https://aws.amazon.com/compare/the-difference-between-yaml-and-json/>
- <https://www.linode.com/docs/guides/yaml-anchors-aliases-overrides-extensions/>
- <https://notifiarr.wiki/pages/client/configuration/>
- <https://www.nngroup.com/articles/visibility-system-status/>
