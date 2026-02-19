# Task Structure Analysis: lidarr-first-class-defaults

## Executive Summary

The implementation requires two parallel workstreams -- cleanup of four legacy v1 seed files and
creation of new first-class Lidarr entities across ~13 database table concerns -- organized into
three phases. The entity dependency chain creates a strict sequential backbone, but independent
concerns (file deletion, profile creation vs CF creation) can run in parallel. Optimal granularity
is one SQL concern per task, targeting 1-3 files each.

## Recommended Phase Structure

### Phase 1: Cleanup and Foundation

**Purpose**: Remove legacy v1 Lidarr seeds and establish new entity foundations. **Suggested
Tasks**:

1. Delete legacy v1 files (ops/50, 51, 53, 54)
2. Create new Lidarr custom formats (`Lidarr - FLAC (Praxrr)`, `Lidarr - AAC (Praxrr)`,
   `Lidarr - Opus (Praxrr)`)
3. Create new Lidarr quality profiles (3 tiers) **Parallelization**: All 3 tasks are independent.

### Phase 2: Wiring and Dependencies

**Purpose**: Wire conditions, patterns, groups, scores, and rankings to the foundation entities.
**Suggested Tasks**:

1. Seed custom format conditions and condition patterns
2. Seed quality groups and quality group members
3. Seed quality profile languages, custom format scores, and quality rankings **Dependencies**:
   Phase 1 CFs needed for conditions/scores; Phase 1 profiles needed for groups/rankings.
   **Parallelization**: Tasks 1 and 2 can run in parallel.

### Phase 3: Verification

**Purpose**: Validate completeness and correctness. **Suggested Tasks**:

1. Idempotency verification
2. Entity completeness audit
3. Name convention grep check **Parallelization**: All 3 can run in parallel.

## Dependency Analysis

### Independent Tasks (Can Run in Parallel)

- Delete legacy files -- no dependencies on new entities
- Create CFs and create profiles -- independent of each other
- All Phase 3 verification tasks

### Sequential Dependencies

- CFs must exist before conditions reference them
- CFs must exist before profile-CF score mappings
- Profiles must exist before quality groups/members
- Profiles must exist before profile-CF score mappings
- Conditions must exist before condition_patterns link them to regex

### Potential Bottlenecks

- Entity naming finalization -- every downstream task depends on frozen names
- File numbering coordination -- new ops files need sequential non-conflicting numbers

## File-to-Task Mapping

### Files to Delete

| File                                              | Phase | Notes                          |
| ------------------------------------------------- | ----- | ------------------------------ |
| `ops/50.seed-lidarr-custom-formats.sql`           | 1     | CFs exist in rosettarr; no-op  |
| `ops/51.seed-lidarr-quality-profiles.sql`         | 1     | Replaced by 3 new tiers        |
| `ops/53.seed-lidarr-profile-format-scores.sql`    | 1     | Replaced by new score mappings |
| `ops/54.seed-lidarr-custom-format-conditions.sql` | 1     | Replaced by new conditions     |

### Files to Create

| File                                          | Phase | Dependencies                         |
| --------------------------------------------- | ----- | ------------------------------------ |
| `ops/55.seed-lidarr-first-class-defaults.sql` | 1-2   | All new entities in dependency order |

### Files to Retain

| File                                         | Reason                                                |
| -------------------------------------------- | ----------------------------------------------------- |
| `ops/52.seed-lidarr-quality-definitions.sql` | 38 Lidarr quality_api_mappings still needed           |
| `ops/0.rosettarr.sql`                        | Shared AAC/FLAC/Opus CFs, regex, conditions untouched |

## Implementation Strategy Recommendations

- **Single file approach**: One `ops/55.seed-lidarr-first-class-defaults.sql` containing all new
  entities in dependency order. Simpler to review and maintain than multiple files.
- **Bottom-up order**: Foundation entities (CFs, profiles) first, then dependent junction tables
  (conditions, scores, groups).
- **Pattern replication**: Copy SQL patterns exactly from reference files (ops/53 for scores, ops/54
  for conditions).
- **Naming enforcement**: Run `grep -r 'Lidarr -' ops/ | grep -v '(Praxrr)'` before marking any task
  complete.
- **Minimum CF set first**: Use FLAC/AAC/Opus (existing regex). Defer ALAC/MP3 expansions.
