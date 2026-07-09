# External API Research: Transparent Automation Engine

## Executive Summary

The remaining issue #21 work does not require a new SaaS API or SDK. Praxrr
already has the authoritative inputs needed for sync-preview narration, Quality
Goals rationale, and resolved-config layer explanations. The safest
implementation is to render those existing typed records through the versioned
`$shared/narration` engine and keep the upstream Arr boundary unchanged.

The critical constraint is post-apply truthfulness. `SyncPreviewResult`
describes intended changes, while the apply route currently returns only job/run
output and `SyncResult` has counts plus optional failed profile names. It does
not report actual per-entity outcomes. The UI must not narrate preview intent as
completed work. Run- and section-level narration can ship now; actual per-entity
narration needs a linked follow-up that extends the sync result/history
contract.

Resolved Config has a similar boundary: it can truthfully identify `base`,
`user`, and `resolved` views, but it cannot currently attribute every final
field to a particular op or database default. Ship layer-level provenance now
and create an op-lineage follow-up for per-field/default attribution.

## Primary APIs

### Praxrr APIs to extend or consume

| API                                                           | Existing authoritative data                                                                                                       | Integration recommendation                                                                                                                                                                                           |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/sync/preview`                                   | `arrType`, requested sections, `SyncPreviewSummary`, section outcomes, and section-specific `EntityChange`/`FieldChange` records  | Generate narration from the returned records. Do not re-diff or re-tally. The route limits creation to 6 requests per instance per 60 seconds, caps the store at 200 snapshots, and limits request bodies to 64 KiB. |
| `GET /api/v1/sync/preview/{previewId}`                        | Stable preview snapshot with status, expiry, errors, summary, and entity diffs                                                    | Render summary by default and entity/field rationale on expand. Surface section errors separately from successful sections.                                                                                          |
| `POST /api/v1/sync/preview/{previewId}/apply`                 | Current implementation returns job status/output and a stale warning                                                              | Correct the OpenAPI response contract before adding typed result narration. Narrate only facts the response proves.                                                                                                  |
| `POST /api/v1/goals/preview` and `/apply`                     | `GoalPlan.decisions[].reason` already contains `code`, `category`, `ruleId`, base score, axis contributions, and ceiling relation | Reuse this machine-readable rationale for user narration and emit a sanitized structured decision event after successful apply. No new scoring or explanation model is needed.                                       |
| `GET /api/v1/pcd/{databaseId}/resolved/{entityType}[/{name}]` | Layer-specific `base`, `user`, or `resolved` state; user overrides are base-versus-resolved `FieldChange` values                  | Add honest layer-level provenance and contextual copy. Do not claim per-field op/default origin without new lineage data.                                                                                            |
| Sync History detail API                                       | Trigger, status, section results, expected pre-sync changes, counts, failures, and duration                                       | Reuse it for durable run/section narration. Its `changes` are captured before writes and remain intended changes, not proof of entity success.                                                                       |

Praxrr authentication remains the existing SvelteKit session/auth-bypass
middleware. These additions must not introduce a second authentication
mechanism. Pricing is not applicable: all APIs above are local application APIs.

### Upstream Arr APIs

Praxrr preview, drift, resolved-live-diff, and sync code talks to self-hosted
Arr instances with an API key. The official OpenAPI contracts support
`X-Api-Key` header authentication and, less safely, an `apikey` query parameter.
Praxrr should continue using the header so credentials do not enter URLs or
access logs.

- [Radarr official OpenAPI](https://github.com/Radarr/Radarr/blob/develop/src/Radarr.Api.V3/openapi.json)
  documents `/api/v3` custom-format, quality-profile, quality-definition,
  delay-profile, naming, and media-management resources.
- [Sonarr official OpenAPI](https://github.com/Sonarr/Sonarr/blob/v5-develop/src/Sonarr.Api.V3/openapi.json)
  documents the corresponding `/api/v3` resources, but Sonarr semantics must
  still be validated independently.
- [Lidarr official OpenAPI](https://github.com/Lidarr/Lidarr/blob/develop/src/Lidarr.Api.V1/openapi.json)
  uses `/api/v1`, has metadata-profile resources, and does not expose the same
  custom-format surface.

The upstream schemas publish no general request quota, pricing tier, or `429`
response contract. They are GPL self-hosted applications, so there is no API
fee. Praxrr must still retain its own timeouts, concurrency limits, rate-limit
handling, and sanitized failure mapping because proxies and instances can reject
or throttle requests even when the OpenAPI document is silent.

## Libraries and SDKs

No dependency should be added.

- Use the existing Arr clients and their explicit `arrType` dispatch.
- Use existing generated Praxrr OpenAPI types at the route boundary.
- Extend the pure `$shared/narration` package and reuse `NarrationBlock.svelte`.
- Use the existing structured logger and `sanitizeLogMeta`; do not add an
  observability SDK merely to record Quality Goals rationale.
- Use existing `EntityChange`, `FieldChange`, `GoalReason`, and resolved-layer
  types. Parallel explanation-only DTOs would create contract drift.

OpenTelemetry's
[Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/) is
a useful naming precedent: identify the event class and keep structured
attributes separate from the human message. Praxrr can follow that shape with
its current logger without adopting OpenTelemetry.

## Integration Patterns

### 1. Narrate records; never recompute decisions

```ts
const summaryLine = narrateSyncSummary(
  preview.summary,
  preview.sectionOutcomes,
  level
);
const entityLines = preview.qualityProfiles?.customFormats.map((change) =>
  narrateEntityChange(change, preview.arrType, 'qualityProfiles', level)
);
```

The server remains authoritative for diffing. The narration engine only converts
typed facts to versioned wording. Summary counts must be read from
`SyncPreviewSummary`, not reconstructed from visible or filtered entity arrays.

### 2. Preserve plan/apply truthfulness

Terraform's official
[`plan`](https://developer.hashicorp.com/terraform/cli/commands/plan) and
[`apply`](https://developer.hashicorp.com/terraform/cli/commands/apply)
documentation distinguishes applying a saved plan from generating a new plan at
apply time. Praxrr should make the same distinction explicit. The current
preview apply endpoint selects sections and re-enters the normal sync job; it
does not return actual per-entity results from execution.

Therefore:

- Preview narration says “Praxrr plans to update …”.
- Run/section result narration says “Quality Profiles completed; 12 items
  synced” only when that section result exists.
- Per-entity completion wording is forbidden until execution returns a stable
  entity identifier, attempted action, terminal status, and sanitized failure
  reason for each entity.
- If preview-only `sectionConfigs` can differ from saved sync configuration,
  apply must either carry and validate the same configuration/token or clearly
  say it is applying current saved settings.

### 3. Record Quality Goals rationale as one structured decision event

The goal engine already produces the decision record. After `updateScoring`
succeeds, emit one sanitized event from that same `GoalPlan`; do not
reverse-engineer rationale from the written scores.

```ts
await logger.info('Quality goal applied', {
  source: 'QualityGoals',
  meta: {
    eventName: 'quality_goal.applied',
    engineVersion: plan.engineVersion,
    databaseId: request.databaseId,
    profileName: request.profileName,
    arrType: plan.arrType,
    presetId: request.presetId,
    coverage: plan.coverage,
    thresholds: plan.thresholds,
    decisions: plan.decisions.map(({ customFormatName, score, reason }) => ({
      customFormatName,
      score,
      reason,
    })),
  },
});
```

The
[OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
recommends recording when, where, who, and what while excluding or sanitizing
sensitive data. Never log Arr API keys, authorization headers, raw request
bodies, tokens, credentials, or unbounded upstream payloads. Keep
`sanitizeLogMeta` in the write path and test nested decision arrays.

### 4. Represent provenance at the precision the data supports

The current contract supports these truthful statements:

- `base`: schema + base + tweaks replay, with user ops omitted.
- `user`: field-level difference between base replay and final resolved replay.
- `resolved`: schema + base + tweaks + user, matching desired sync state.
- `hasPendingConflict`: the result is not unambiguous while a value-guard
  conflict is pending.

It does **not** support “this exact field came from op X” or “database default
supplied this value.” The existing `NarrationProvenance` union is a rendering
seam, not evidence. Treat database-default and per-field op attribution as a
follow-up requiring lineage captured during replay (op ID, layer, field path,
and default source), with a migration/versioning decision.

### 5. Make the automation audit a contract, not a prose-only spot check

Use the registered `JobType` union as the inventory source. For each job and
each user-triggered automation route, verify four fields:

1. Inputs: target, trigger/source, selected sections/options, and
   engine/template version.
2. Decisions: skipped/selected branches and stable reason codes.
3. Outputs: terminal status, counts, durable result link, and
   actual-versus-planned distinction.
4. Failures: sanitized user-facing reason plus private diagnostic logging.

The first audit must cover Arr sync (all section jobs), upgrade, rename, startup
pull, PCD sync, TRaSH Guide sync, drift, canary rollout, config-health
snapshots, backups, and cleanup jobs. Cleanup jobs can be terse, but they still
need inputs, counts, terminal status, and a failure reason. Encode the audit as
a typed/static matrix with a test asserting every registered `JobType` has an
entry, so new automation cannot silently bypass transparency review.

## Constraints and Gotchas

1. **Apply response contract drift.** `docs/api/v1/paths/sync.yaml` documents
   apply success as `SyncPreviewResult`, while the route returns
   `{ success, results, staleWarning }`. Fix the contract first; do not cast
   around it in the UI.
2. **No actual per-entity outcomes.** `SyncResult` exposes `success`,
   `itemsSynced`, `error`, and optional `failedProfiles`; sync history stores
   per-section outcomes and pre-sync expected changes. Neither proves which
   individual create/update/delete succeeded.
3. **Preview is not necessarily a saved executable plan.** Apply re-runs
   selected sections. Wording such as “exactly these operations were applied” is
   unsafe unless execution is bound to the stored preview inputs and result
   identities.
4. **Cross-Arr schemas differ.** Keep all labels, field mappings, endpoints, and
   supported sections keyed by explicit `arrType`. Literal fallback is safer
   than borrowing a sibling app's term.
5. **Partial preview is valid data.** `sectionOutcomes` can contain errors or
   skips while other sections have useful diffs. Narration must preserve that
   distinction rather than collapse the preview into one generic failure.
6. **Error detail has two audiences.** UI/API narration uses closed sanitized
   reason codes and recovery advice; server logs may hold diagnostic detail
   after secret sanitization.
7. **Provenance is currently layer-wide.** `tweaks` is folded into base, and
   schema/database defaults are not traced per field. Do not infer precision
   from a diff.
8. **Contextual explanations need one source.** Existing server-authored
   metadata such as Quality Goals axis descriptions should be reused in settings
   and results. Avoid duplicate client copy that can drift from engine behavior.
9. **Template and engine versions are different.** Keep narration template
   version, Quality Goals engine version, and API schema version separate in
   logs and responses.

## Open Questions

1. Should preview apply become a true saved-plan execution contract, or should
   UI wording explicitly describe it as a fresh sync constrained to the
   previewed sections?
2. What minimum per-entity result shape will unblock post-apply narration:
   entity type/name, requested action, terminal status, remote ID, and sanitized
   reason?
3. Should the apply response embed run/section results directly or return a
   sync-history ID for a single durable source of truth?
4. Is layer-level provenance sufficient to close issue #21 now, with
   op/field/default lineage moved to a linked issue with explicit acceptance
   criteria?
5. Which automated operations are deliberately internal-only cleanup tasks, and
   where should their transparency evidence live: job history, logs, or a
   user-facing operations page?
