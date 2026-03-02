# Progressive Disclosure Requirements

## Task 1.1 Locking

The feature is blocked from schema/API work until the acceptance criteria below are approved.

## Acceptance Criteria Checklist

- [ ] `Show Advanced` and `Hide Advanced` are explicit text actions.
- [x] Default UI mode for every section starts in `basic`.
- [ ] Advanced content is visually and structurally separated from basic content.
- [ ] Button state is deterministic and mirrored by ARIA (`aria-expanded`, semantic labels).
- [x] Persistence is per-user and per-section.
- [x] Persistence is read/write-capable only for authenticated sessions.
- [x] No anonymous durable persistence writes are allowed; unauthenticated views always use safe defaults.
- [ ] Unknown keys are rejected before persistence.
- [ ] Duplicate or missing ownership for a section key is treated as a validation failure.
- [ ] Every section key follows one deterministic `route-family:route-section:ui-section` naming format.

## Deterministic Section-Key Format

- Regex (required): `^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$`
- Canonical section keys:
  - `media-management:media-settings:naming`
  - `media-management:media-settings:folder-management`
  - `media-management:media-settings:importing`
  - `quality-profiles:general:custom-format-scoring`
  - `quality-profiles:general:upgrade-settings`
  - `custom-formats:general:conditions`
  - `custom-formats:general:scoring`
  - `custom-formats:general:negation-and-groups`
- Invalid examples:
  - `Media-Management:media-settings:naming` (uppercase segment)
  - `media-management::naming` (empty segment)
  - `media-management-media-settings-naming` (missing separators)
  - `media-management:media-settings:naming:` (trailing separator)
- Ownership mapping (exactly one route family + one UI section owner per key):
  - `media-management:media-settings:naming` → route family `media-management`, section owner `media settings naming section`
  - `media-management:media-settings:folder-management` → route family `media-management`, section owner `media settings folder-management section`
  - `media-management:media-settings:importing` → route family `media-management`, section owner `media settings importing section`
  - `quality-profiles:general:custom-format-scoring` → route family `quality-profiles`, section owner `quality profile custom-format scoring section`
  - `quality-profiles:general:upgrade-settings` → route family `quality-profiles`, section owner `quality profile upgrade-settings section`
  - `custom-formats:general:conditions` → route family `custom-formats`, section owner `custom format conditions section`
  - `custom-formats:general:scoring` → route family `custom-formats`, section owner `custom format scoring section`
  - `custom-formats:general:negation-and-groups` → route family `custom-formats`, section owner `custom format negation and group section`
