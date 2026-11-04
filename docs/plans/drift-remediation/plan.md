# Plan — Drift Remediation: Reconcile, Acknowledge/Snooze, Auto-Remediation (YAN-514 / GH #409)

Status: implemented (YAN-514 / GH #409). The current contract lives in
[`sync-pipeline.md#drift-remediation`](../../site/src/content/docs/app/sync-pipeline.md#drift-remediation);
this plan is kept as the design record. Research: [`research.md`](./research.md).
Depends on YAN-446 / GH #408 (drift false positives), which ships in the same PR. Auto mode is only
safe once identical Arr state diffs as `unchanged`.

## 0. Acceptance criteria → design anchor

| AC                                                                                    | Satisfied by                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Reconcile from `/drift/[id]`, recorded in sync history, linked to the drift event  | `POST /api/v1/drift/{id}/reconcile` creates a drift-tagged reviewed preview → the existing apply route/`executeReviewedSyncJob` → `sync_history.drift_signature/drift_detected_at/remediation_trigger` and `drift_instance_status.last_remediation_*` (§3, §5) |
| 2. Ack/snooze → no notification and no health penalty until signature change / expiry | Suppression columns, pure `resolveDriftSuppression`, `shouldNotify` on the effective signature, `gatherDrift` feeds unsuppressed counts (§4)                                                                                                                   |
| 3. Auto off by default, never writes unless `drifted`, respects Canary                | `drift_remediation_policy` (absent row = `off`), `decideAutoRemediation` + a re-check in the `drift.remediate` handler, Canary hold (§6)                                                                                                                       |

## 1. Decisions (with rationale)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Why                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Drift event identity = `(arr_instance_id, drift_signature, drift_detected_at)`.** `drift_detected_at` is a new column, stamped the first time a content refresh sees the current signature. No separate event table.                                                                                                                                                                                                                                                                                             | Drift is stored as latest state (design §3). The signature already serves as the dedup/ack anchor (design §11). `drift_detected_at` tells apart an identical drift that recurs after recovery.                                                                                               |
| D2  | **Link sync history → drift by adding columns** to `sync_history` (`drift_signature`, `drift_detected_at`, `remediation_trigger`), plus a back-pointer `drift_instance_status.last_remediation_sync_history_id` (FK `ON DELETE SET NULL`).                                                                                                                                                                                                                                                                         | Columns can be queried and indexed, and they survive history retention. A JSON blob could not be filtered on `/sync-history`.                                                                                                                                                                |
| D3  | **The drift link is server-owned.** It is stored on the preview snapshot (`SyncPreviewResult.driftRemediation`) when the reconcile endpoint or auto job creates the preview. The apply route forwards it from the snapshot and never takes it from the client body.                                                                                                                                                                                                                                                | A client cannot forge a drift link or attach one to an unrelated preview. Manual reconcile reuses the existing apply route unchanged (claim, staleness, managed-delete admin scope, invalidation).                                                                                           |
| D4  | **Ack granularity: per instance (whole signature) plus per entity (entity keys).** Snooze is **per instance only**.                                                                                                                                                                                                                                                                                                                                                                                                | The Linear spec asks for "per instance and per entity". Per-entity ack is cheap: a JSON key list, reusing the signature token as the key. Per-entity snooze adds UI and state for no AC benefit.                                                                                             |
| D5  | **Ack lasts until the signature changes.** On each content refresh, `acknowledged_signature` is cleared when it ≠ the new signature, and stale entity keys are pruned. The clear uses a value-guarded SQL `WHERE`. **Snooze ignores signature changes** and lasts until `snoozed_until`.                                                                                                                                                                                                                           | This follows the spec. Clearing (rather than letting the ack "go dormant") prevents a stale ack from reviving when the same drift recurs after recovery. The value guard makes a concurrent user ack race-safe.                                                                              |
| D6  | **Stored `status` stays `drifted`.** Suppression is a derived overlay (`suppression` object in API responses). Notifications and health read **effective** counts: alerting changes minus acked keys, or zero when the instance is acked or snoozed.                                                                                                                                                                                                                                                               | The truth stays visible (dashboard, metrics, MCP unchanged). Only alerting and scoring are muted, as AC2 requires.                                                                                                                                                                           |
| D7  | **Notify dedup keys on the effective signature.** `notified_signature` stores the effective signature (hash of un-acked alerting keys).                                                                                                                                                                                                                                                                                                                                                                            | A new, un-acked entity drifting on a partially-acked instance re-alerts. Acking every entity silences alerts.                                                                                                                                                                                |
| D8  | **Policy modes:** `off` (default): no remediation behavior; drift notifications behave as today. `notify`: the `drift.detected` notification gains a "Reconcile suggested: sections X" line and a `/drift/{id}` deep link; nothing is written. `auto`: queue reviewed preview + apply for `(drifted ∩ allowed − acked)` sections. ⚠ **Needs user confirmation** (§9 Q1).                                                                                                                                           | `off` must not mute existing notifications, because default-off would silently change current behavior. `notify` is a dry-run tier to build trust before turning on `auto`.                                                                                                                  |
| D9  | **Auto never writes directly.** Every successful drift content refresh (the scheduled `drift.check` sweep, an on-demand `POST /drift/{id}`, and the handler's own re-check, all via `checkAndPersistInstance` → `queueAutoRemediationIfEligible`) only enqueues a `drift.remediate` job (`dedupeKey drift.remediate:{id}`, `upsertScheduled`, source `system`). The handler re-validates everything, creates a reviewed preview, and applies it through `applyReviewedPreview` (the same core as the apply route). | Same audit, claim, and invalidation path as a human apply. The dispatcher is single-flight, so the drift sweep is never blocked by an apply.                                                                                                                                                 |
| D10 | **Canary gating:** if `canary_settings.enabled` **and** the same-`arr_type` enabled cohort has more than one instance **and** the instance is not the resolved default canary, auto **holds**: no write; `last_remediation_status='held_canary'`; `drift.remediation.held` notification with a Reconcile link. Auto also **skips** while any `canary_rollouts` row of that `arr_type` is `canary_running \| awaiting_confirmation \| rolling_out`. ⚠ §9 Q2.                                                        | Canary is a human verification gate for fleet writes. Starting a rollout (`startRollout`) from a single-instance remediation would widen the blast radius to the whole cohort and bypass the reviewed-plan path. Holding for a human is the fail-closed reading of "respects Canary gating". |
| D11 | **Auto excludes:** acked/snoozed instances; sections that contain an acked entity; sections whose preview contains managed deletes (`sectionsIncludeManagedDelete`); sections not in `allowedSections`; version-unavailable sections. **One auto attempt per signature** (`last_auto_attempt_signature`).                                                                                                                                                                                                          | An ack means the change was intentional, so auto must not revert it. Auto never deletes. An idempotency key stops retry storms on persistent failures; a new signature re-arms auto.                                                                                                         |
| D12 | **Auto pre-apply verification:** the preview's own alerting signature over the target sections (via `aggregateDrift` + `driftSignature`) must equal the stored signature restricted to those sections. On a real mismatch the handler cancels as stale; a target section that errored makes the comparison unverifiable, so the claim is released instead.                                                                                                                                                         | This rules out "drift changed between check and remediate" writes.                                                                                                                                                                                                                           |
| D13 | **Extract preview create/apply cores** into `$sync/preview/create.ts` and `$sync/preview/apply.ts`. The two routes become thin HTTP mappers. Existing exports (`_handleSyncPreview*Request`, `SyncPreview*Dependencies`) keep their names and signatures.                                                                                                                                                                                                                                                          | The job cannot call an HTTP route. Sharing one core means reconcile, auto, and manual apply cannot diverge. Existing tests keep importing the route handlers.                                                                                                                                |
| D14 | **Auth:** `POST /drift/{id}/reconcile` → token scope `read` (dry-run: ephemeral in-memory preview, like `POST /sync/preview`). `PUT /suppression` and `PUT /remediation-policy` → `admin` (fail-closed default; changing auto mode is a write policy). Apply stays `sync:apply`. CSRF is global (`csrfGuard` in `hooks.server.ts`); no per-route work.                                                                                                                                                             | Least privilege: these are new routes, so the scopes are new policy rather than existing behavior.                                                                                                                                                                                           |
| D15 | **No feature switch.** Everything ships complete in this PR; auto defaults to `off` and requires explicit per-instance opt-in plus a non-empty `allowedSections`.                                                                                                                                                                                                                                                                                                                                                  | RELEASING.md "Unfinished work": nothing half-built is reachable.                                                                                                                                                                                                                             |
| D16 | **Reconcile section set** = sections that have `drift`/`missing` changes in the stored row (body `sections?` may narrow it, never widen it) ∩ the instance's configured, version-available sections. A 409 is returned if the row is not `drifted` or the stored content is stale (`content_checked_at` null).                                                                                                                                                                                                     | "Limited to the drifted sections". It fails fast on unknown state instead of falling back to a full sync.                                                                                                                                                                                    |

## 2. Migration

`packages/praxrr-app/src/lib/server/db/migrations/20261103_add_drift_remediation.ts`, version `20261103`.
If `main` has taken 20261103 by merge time, rebump it. Register it in **both** the static import and the
`loadMigrations()` array of `db/migrations.ts`. Update `db/schema.sql` (reference) for all three tables.
App-DB only: **no** `seedBuiltInBaseOps` change.

```sql
-- up
ALTER TABLE drift_instance_status ADD COLUMN drift_detected_at TEXT;               -- ISO; first refresh that saw current signature
ALTER TABLE drift_instance_status ADD COLUMN acknowledged_signature TEXT;          -- instance-level ack (== drift_signature when active)
ALTER TABLE drift_instance_status ADD COLUMN acknowledged_at TEXT;
ALTER TABLE drift_instance_status ADD COLUMN acknowledged_entity_keys TEXT NOT NULL DEFAULT '[]'; -- JSON string[] of driftEntityKey
ALTER TABLE drift_instance_status ADD COLUMN snoozed_until TEXT;                   -- ISO; active while > now
ALTER TABLE drift_instance_status ADD COLUMN last_remediation_trigger TEXT
  CHECK (last_remediation_trigger IN ('reconcile','auto') OR last_remediation_trigger IS NULL);
ALTER TABLE drift_instance_status ADD COLUMN last_remediation_status TEXT
  CHECK (last_remediation_status IN ('success','partial','failed','skipped','held_canary') OR last_remediation_status IS NULL);
ALTER TABLE drift_instance_status ADD COLUMN last_remediation_signature TEXT;
ALTER TABLE drift_instance_status ADD COLUMN last_remediation_at TEXT;
ALTER TABLE drift_instance_status ADD COLUMN last_remediation_sync_history_id INTEGER
  REFERENCES sync_history(id) ON DELETE SET NULL;
ALTER TABLE drift_instance_status ADD COLUMN last_auto_attempt_signature TEXT;     -- auto idempotency key

CREATE TABLE drift_remediation_policy (
  arr_instance_id  INTEGER PRIMARY KEY REFERENCES arr_instances(id) ON DELETE CASCADE,
  arr_type         TEXT NOT NULL CHECK (arr_type IN ('radarr','sonarr','lidarr')),
  mode             TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off','notify','auto')),
  allowed_sections TEXT NOT NULL DEFAULT '[]',   -- JSON SectionType[], validated per arr_type in app code
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);  -- no row == mode 'off' (default off without backfill)

ALTER TABLE sync_history ADD COLUMN drift_signature TEXT;
ALTER TABLE sync_history ADD COLUMN drift_detected_at TEXT;
ALTER TABLE sync_history ADD COLUMN remediation_trigger TEXT
  CHECK (remediation_trigger IN ('reconcile','auto') OR remediation_trigger IS NULL);
CREATE INDEX idx_sync_history_drift ON sync_history(arr_instance_id, drift_signature)
  WHERE drift_signature IS NOT NULL;

-- down: DROP INDEX idx_sync_history_drift; DROP TABLE drift_remediation_policy;
-- ALTER TABLE ... DROP COLUMN for every added column (reverse order). The column-level
-- REFERENCES on last_remediation_sync_history_id is dropped with the column (only table-level
-- FOREIGN KEY clauses block DROP COLUMN); covered by the populated down test.
```

> **Shipped:** acknowledgements are content-aware. `acknowledged_entity_keys` stores a JSON array of
> `{ key, fingerprint }` entries (not a `string[]`), and `acknowledged_signature` holds the
> `driftContentSignature` of the acknowledged content (not `drift_signature`). This supersedes the
> key-only comments in the SQL above.

Existing rows get NULL/`'[]'` values: no ack, no snooze, policy off. Existing behavior is unchanged.

## 3. Shared contracts (frozen before wave 2)

### 3.1 Types — `$sync/drift/types.ts` (Slice A1)

```ts
export type DriftRemediationMode = 'off' | 'notify' | 'auto';
export type DriftRemediationTrigger = 'reconcile' | 'auto';
export type DriftRemediationStatus =
  'success' | 'partial' | 'failed' | 'skipped' | 'held_canary';
export type DriftSuppressionState =
  'none' | 'acknowledged' | 'snoozed' | 'partially_acknowledged';

export interface DriftSuppression {
  readonly state: DriftSuppressionState;
  readonly acknowledgedSignature: string | null;
  readonly acknowledgedAt: string | null;
  readonly acknowledgedEntityKeys: readonly string[];
  readonly snoozedUntil: string | null; // only when still in the future
  /** Alerting (drift+missing) changes NOT covered by an ack/snooze. */
  readonly effectiveDrifted: number;
  readonly effectiveMissing: number;
  /** Hash over un-acked alerting keys; null when nothing alerts. */
  readonly effectiveSignature: string | null;
}

export interface DriftRemediationPolicy {
  readonly instanceId: number;
  readonly arrType: SyncPreviewArrType;
  readonly mode: DriftRemediationMode;
  readonly allowedSections: readonly SyncPreviewSection[];
  readonly updatedAt: string | null; // null => synthesized default (no row)
}

export interface DriftRemediationRecord {
  readonly trigger: DriftRemediationTrigger | null;
  readonly status: DriftRemediationStatus | null;
  readonly signature: string | null;
  readonly at: string | null;
  readonly syncHistoryId: number | null;
}

/** Server-owned link carried on a preview snapshot and into sync_history. */
export interface DriftRemediationLink {
  readonly instanceId: number;
  readonly driftSignature: string;
  readonly driftDetectedAt: string | null;
  readonly trigger: DriftRemediationTrigger;
}
```

### 3.2 Pure helpers

- `$sync/drift/check.ts` (A1): export `driftEntityKey(change: DriftEntityChange): string`, which returns
  the existing token `${section}|${entityType}|${name}|${remoteId ?? 'new'}|${action}`. Refactor
  `driftSignature` to use it; the output must stay byte-identical (existing tests must stay green). Add
  `signatureOfKeys(keys: readonly string[]): string | null` (sort, then `stableHash`; returns null when empty).
- `$sync/drift/suppression.ts` (A1, new, pure, no I/O):

  ```ts
  export const DRIFT_SNOOZE_MAX_MS = 90 * 24 * 60 * 60 * 1000;
  export function alertingKeys(changes: readonly DriftEntityChange[]): string[];
  export function resolveDriftSuppression(
    row:
      | Pick<
          DriftInstanceStatusDetail,
          | 'status'
          | 'changes'
          | 'driftSignature'
          | 'acknowledgedSignature'
          | 'acknowledgedAt'
          | 'acknowledgedEntityKeys'
          | 'snoozedUntil'
        >
      | undefined,
    nowMs: number
  ): DriftSuppression;
  /** Sections with ≥1 alerting change, minus sections containing an acked entity key. */
  export function remediableSections(
    changes: readonly DriftEntityChange[],
    ackedKeys: readonly string[]
  ): SyncPreviewSection[];
  ```

  Rules: a snooze is active iff `snoozedUntil > now`. The instance ack is active iff
  `acknowledgedSignature !== null && acknowledgedSignature === driftSignature`. An active snooze or
  instance ack gives effective counts 0 and `effectiveSignature` null. Otherwise acked keys are
  subtracted. The state is `partially_acknowledged` when some, but not all, alerting keys are acked.

  > **Shipped (supersedes the key-only rules above):** acknowledgements are content-aware. The
  > instance ack is active iff `acknowledgedSignature === driftContentSignature(changes)`, which is a
  > hash over each alerting change's `driftEntityFingerprint` (its key plus its field-level diff).
  > Per-entity acks are `{ key, fingerprint }` entries (`acknowledgedEntities`). An entry is active
  > iff the current alerting change with that key has the same fingerprint. So a further field change
  > on an already-drifted entity ends the ack even when `driftSignature` is unchanged.

### 3.3 Queries

- `$db/queries/driftStatus.ts` (A1): extend the Row/`DriftInstanceStatusDetail` with `driftDetectedAt`,
  `acknowledgedSignature`, `acknowledgedAt`, `acknowledgedEntityKeys: string[]`, `snoozedUntil`,
  `lastRemediation: DriftRemediationRecord`, `lastAutoAttemptSignature`. Add to `UpsertDriftStatusInput`
  `driftDetectedAt: string | null`, and include it in the `INSERT … ON CONFLICT` list. Suppression and
  remediation columns are **never** touched by `upsert`. New methods, all bare `db.execute` (no
  `db.transaction`, see the re-entrancy note at driftStatus.ts:130):

  ```ts
  setSuppression(instanceId: number, expectedSignature: string | null, input: {
    acknowledgedSignature: string | null; acknowledgedEntityKeys: readonly string[]; snoozedUntil: string | null;
    acknowledgedAt: string | null }): boolean;              // WHERE drift_signature IS ? (value guard) → false = 409
  clearStaleAcknowledgements(instanceId: number, currentSignature: string | null, currentKeys: readonly string[]): void;
    // acknowledged_signature = NULL WHERE acknowledged_signature IS NOT ?; entity keys ∩= currentKeys
  recordRemediation(instanceId: number, rec: { trigger; status; signature; at; syncHistoryId }): boolean;
  markAutoAttempt(instanceId: number, signature: string): boolean;   // WHERE last_auto_attempt_signature IS NOT ? → false = already attempted
  ```

- `$db/queries/driftRemediationPolicy.ts` (A1, new):
  `get(instanceId, arrType): DriftRemediationPolicy` (synthesizes `off` when there is no row),
  `upsert(input): DriftRemediationPolicy`.
- `$db/queries/syncHistory.ts` + `$sync/syncHistory/types.ts` + `record.ts` (A1): add
  `driftLink: DriftRemediationLink | null` to `SyncHistoryInput`. Persist it as
  `drift_signature`/`drift_detected_at`/`remediation_trigger`. Add `driftSignature`, `driftDetectedAt`,
  `remediationTrigger` to `SyncHistorySummary`/`SyncHistoryDetail` (`SUMMARY_COLUMNS`). Every existing
  `recordSyncHistory` caller passes `driftLink: null`, except the reviewed path in Slice C.
  `sanitizeSyncHistoryInput` passes it through.

  > **Shipped:** the Detail field is `acknowledgedEntities: DriftEntityAck[]` (`{ key, fingerprint }`),
  > not `acknowledgedEntityKeys: string[]`. Stale acks are cleared by content (fingerprint mismatch or
  > key no longer alerting), not by `drift_signature` alone. See §3.2.

### 3.4 Preview core (Slice C owns; B/D consume the signatures)

```ts
// $sync/preview/create.ts
export type CreateReviewedPreviewOutcome =
  | { kind: 'ok'; preview: SyncPreviewResult } // status ready|applied-n/a
  | { kind: 'failed'; preview: SyncPreviewResult } // stored failed snapshot (500 shape)
  | { kind: 'rejected'; status: 400 | 404 | 429; error: string };
export async function createReviewedPreview(
  input: {
    instanceId: number;
    sections?: SectionType[];
    sectionConfigs?: Partial<Record<SectionType, unknown>>;
    driftRemediation?: DriftRemediationLink;
  },
  deps?: SyncPreviewCreateDependencies
): Promise<CreateReviewedPreviewOutcome>;

// $sync/preview/apply.ts
export type ApplyReviewedPreviewOutcome =
  | {
      kind: 'applied';
      response: SyncPreviewApplyResponse;
      httpStatus: 200 | 500;
    }
  | {
      kind: 'error';
      httpStatus: 400 | 403 | 404 | 409 | 422 | 500;
      body:
        | ErrorResponse
        | SyncPreviewApplyErrorResponse
        | SyncPreviewApplyInvalidatedResponse;
    };
export async function applyReviewedPreview(
  previewId: string,
  input: {
    sections?: SectionType[];
    source: 'manual' | 'system';
    principal: AuthPrincipal | null;
  },
  deps?: SyncPreviewApplyDependencies
): Promise<ApplyReviewedPreviewOutcome>;
```

- `SyncPreviewCreateInput`/`SyncPreviewResult` gain `readonly driftRemediation: DriftRemediationLink | null`
  (store default `null`).
- `ExecuteReviewedSyncJobInput` gains `driftLink?: DriftRemediationLink`. `executeReviewedSyncJob` passes it
  to `recordHistory`. After history is recorded, **if** `driftLink` is set, it calls
  `driftStatusQueries.recordRemediation(...)` with the history id and status (`deriveSyncHistoryStatus`)
  and then `publishDriftRowUpdated(instanceId)`.

### 3.5 Remediation module (Slice D owns; Slice B calls it from persist)

```ts
// $sync/drift/remediation.ts
export type AutoRemediationDecision =
  | {
      kind: 'skip';
      reason:
        | 'mode_off'
        | 'mode_notify'
        | 'not_drifted'
        | 'stale_content'
        | 'suppressed'
        | 'already_attempted'
        | 'no_sections'
        | 'canary_rollout_active'
        | 'sync_in_progress';
    }
  | { kind: 'hold_canary'; sections: SyncPreviewSection[] }
  | {
      kind: 'remediate';
      sections: SyncPreviewSection[];
      link: DriftRemediationLink;
    };
export function decideAutoRemediation(args: {
  policy: DriftRemediationPolicy;
  row: DriftInstanceStatusDetail | undefined;
  nowMs: number;
  canary: {
    enabled: boolean;
    cohortSize: number;
    isDefaultCanary: boolean;
    activeRolloutForType: boolean;
  };
  sectionsInProgress: readonly SectionType[];
  versionAvailable: ReadonlySet<SyncPreviewSection>;
}): AutoRemediationDecision; // pure
export function queueAutoRemediationIfEligible(instance: ArrInstance): void; // never throws; only enqueues
export function suggestedReconcileSections(
  row: DriftInstanceStatusDetail,
  policy: DriftRemediationPolicy
): SyncPreviewSection[]; // for notify mode
```

### 3.6 Events

`$lib/server/events/publish.ts` (A1) adds `publishDriftRowUpdated(instanceId: number): void`. It
re-reads the row and emits the existing `drift.updated` event, so the UI refreshes after
suppression, policy, or remediation changes. The event schema is unchanged.

## 4. API (contract-first, Slice A2)

Edit `docs/api/v1/schemas/drift.yaml`, `docs/api/v1/paths/drift.yaml`, `docs/api/v1/openapi.yaml`
(path `$ref`s and schema `$ref`s), `docs/api/v1/schemas/sync.yaml` (`SyncPreviewResult.driftRemediation`,
nullable `DriftRemediationLink`), `docs/api/v1/schemas/sync-history.yaml` (`driftSignature`,
`driftDetectedAt`, `remediationTrigger` on entry/detail), and `docs/api/v1/schemas/events.yaml` (job-type
enum adds `drift.remediate`). Then `deno task bundle:api && deno task generate:api-types && deno task format`.
Errors use `$ref ../schemas/arr.yaml#/ErrorResponse`.

New schemas: `DriftRemediationMode`, `DriftRemediationTrigger`, `DriftRemediationStatus`,
`DriftSuppressionState`, `DriftSuppression`, `DriftRemediationPolicy`,
`DriftRemediationPolicyUpdateRequest`, `DriftRemediationRecord`, `DriftRemediationLink`,
`DriftSuppressionUpdateRequest`, `DriftReconcileRequest`.
Changed: `DriftEntityChange` gains `key: string` (computed in `responses.ts`, not stored).
`DriftDetailResponse` gains `suppression`, `remediationPolicy`, `lastRemediation`,
`driftSignature`, `driftDetectedAt`, `reconcilableSections: SyncPreviewSection[]`.
`DriftInstanceSummary` gains `suppression: DriftSuppressionState` and `remediationMode`.

| Method | Path                                            | Body                                                                                                                                  | Responses                                                                                                                                                                                                       | Token scope                        |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| POST   | `/api/v1/drift/{instanceId}/reconcile`          | `{ sections?: SyncPreviewSection[] }`                                                                                                 | 200 `SyncPreviewResult` (with `driftRemediation`) · 400 bad id/body/unsupported/disabled/section not drifted · 404 · 409 not `drifted` or stale content · 429 preview rate limit/capacity · 500 failed snapshot | `read` (add to `READ_POST_ROUTES`) |
| PUT    | `/api/v1/drift/{instanceId}/suppression`        | `{ expectedSignature: string \| null, acknowledgeInstance: boolean, acknowledgedEntityKeys: string[], snoozedUntil: string \| null }` | 200 `DriftDetailResponse` · 400 invalid (unknown key, snooze in the past or > 90 d, ack while not drifted) · 404 · 409 signature changed (value guard)                                                          | `admin` (fail-closed default)      |
| GET    | `/api/v1/drift/{instanceId}/remediation-policy` | —                                                                                                                                     | 200 `DriftRemediationPolicy` · 400 · 404                                                                                                                                                                        | `read`                             |
| PUT    | `/api/v1/drift/{instanceId}/remediation-policy` | `{ mode, allowedSections }`                                                                                                           | 200 `DriftRemediationPolicy` · 400 (`auto` with empty sections; a section unsupported for `arr_type` via `getUnsupportedSyncSectionReason`; duplicates) · 404                                                   | `admin`                            |

All routes follow the existing drift route guards: `parseInstanceId`, `isSyncPreviewArrType`, a body
byte cap (`PREVIEW_REQUEST_BODY_LIMIT_BYTES`), `JSON.parse` in try/catch, and `logger.error` with a
generic 500. Route files:
`routes/api/v1/drift/[instanceId]/reconcile/+server.ts`,
`routes/api/v1/drift/[instanceId]/suppression/+server.ts`, and
`routes/api/v1/drift/[instanceId]/remediation-policy/+server.ts`. Update `utils/auth/README.md` scope table.

## 5. Reconcile flow (AC1)

1. UI: the **Reconcile** button on `/drift/[id]` is shown when `status==='drifted'` and
   `reconcilableSections.length > 0`. It calls `POST /drift/{id}/reconcile`.
2. Route: it reads the drift row (409 if not drifted or `contentCheckedAt` null), computes the section
   set (D16), and builds `link = { instanceId, driftSignature, driftDetectedAt, trigger: 'reconcile' }`.
   It calls `createReviewedPreview({ instanceId, sections, driftRemediation: link })` and maps the
   outcome to HTTP.
3. UI: the drift page embeds the existing `SyncPreviewPanel`. It gets `previewState` from the response
   and a new prop `regenerateEndpoint` = `/api/v1/drift/{id}/reconcile`, so "Generate a new preview"
   stays drift-tagged. Apply goes through `POST /sync/preview/{id}/apply` as before (claim, staleness,
   managed-delete confirm modal plus admin scope, invalidation recovery).
4. Apply core: it forwards `snapshot.driftRemediation` as `driftLink` to `executeReviewedSyncJob`. The
   job writes `sync_history` with the link columns and calls `recordRemediation`, which fills
   `last_remediation_*` and the `sync_history_id` back-pointer.
5. After a successful apply, the UI calls `POST /drift/{id}` (refresh) to confirm the instance is
   `in-sync`. A 429 here is surfaced as an info alert, not an error. The detail page shows
   "Last reconcile: {status} · Sync history #{id}" with a link to `/sync-history/{id}`. The
   sync-history detail page shows "Drift remediation ({trigger}) · signature … · detected …" with a
   link back to `/drift/{instanceId}`.

## 6. Auto-remediation flow (AC3)

1. `checkAndPersistInstance` (Slice B) calls `queueAutoRemediationIfEligible(instance)` at the end of a
   successful content refresh, after the upsert and after acks are cleared. It is synchronous and never
   throws.
2. `queueAutoRemediationIfEligible` reads the policy, row, canary settings + cohort + active rollout,
   `getSectionsInProgress`, and the version-available sections (from the row's `detectedVersion` via
   `resolveSyncSectionAvailability`). If `decideAutoRemediation` returns:
   - `skip`: nothing happens (debug log).
   - `hold_canary`: `recordRemediation({trigger:'auto', status:'held_canary', signature})`, then
     `markAutoAttempt` and a `drift.remediation.held` notification. Both are once per signature.
   - `remediate`: `upsertScheduledJob({ jobType: 'drift.remediate', payload: { instanceId, driftSignature },
source: 'system', runAt: now, dedupeKey: 'drift.remediate:' + instanceId })`.
     `upsertScheduled` does not override a running job, so auto remediations never stack.
3. Handler `jobs/handlers/driftRemediate.ts`:
   1. Re-read everything and re-run `decideAutoRemediation`. It cancels (`status:'cancelled'`, with a
      `decision`) unless the result is still `remediate` **and** `row.driftSignature === payload.driftSignature`.
      This is the "never writes unless drifted" double check.
   2. `markAutoAttempt(instanceId, signature)`. If it returns false (already attempted), cancel. This
      claims the signature before any I/O.
   3. `createReviewedPreview({ instanceId, sections, driftRemediation: link })`. If it is not `ok`, nothing
      was written: release the claim (`releaseAutoAttempt`), send no notification, and return
      `cancelled` so the next drift refresh may re-enqueue.
   4. Verify (D11, D12): drop sections with managed deletes. Re-aggregate
      `aggregateDrift(preview, sections)`. If any target section errored (or none compared), the
      comparison is unverifiable: release the claim as in step 3. Otherwise require
      `driftSignature(changes)` to equal `signatureOfKeys(stored alerting keys ∩ those sections)`;
      on a real mismatch (or every section has managed deletes) record `skipped` and keep the claim.
   5. `applyReviewedPreview(preview.id, { sections, source: 'system', principal: null })`. The link is
      recorded by the reviewed executor (§3.4).
   6. Send a `drift.remediation.applied` or `drift.remediation.failed` notification with
      `arr_type`/`instanceName` and links to history and drift.
   7. `await checkAndPersistInstance(instance)` to re-verify. The `markAutoAttempt` guard prevents a loop.
4. The job is registered in all job-type registries (§7, Slice D).
5. `notify` mode: in `buildDriftNotification`, when `policy.mode==='notify'` and
   `suggestedReconcileSections` is non-empty, append the line
   `Reconcile suggested: {sections} — /drift/{id}`. Dedup is inherited from `shouldNotify`.

## 7. Slices and file ownership

Wave 1 (two agents in parallel; contracts in §3/§4 are fixed by this plan):

- **A1 — DB, types, pure core.** Owns:
  `db/migrations/20261103_add_drift_remediation.ts` (new), `db/migrations.ts`, `db/schema.sql`,
  `db/queries/driftStatus.ts`, `db/queries/driftRemediationPolicy.ts` (new), `db/queries/syncHistory.ts`,
  `sync/drift/types.ts`, `sync/drift/check.ts` (export `driftEntityKey`/`signatureOfKeys` only),
  `sync/drift/suppression.ts` (new), `sync/syncHistory/types.ts`, `sync/syncHistory/record.ts`,
  `sync/syncHistoryFailure.ts` (pass-through), `events/publish.ts` (`publishDriftRowUpdated`). Adds
  `driftLink: null` in `jobs/handlers/arrSync.ts` **only** in the non-reviewed `recordHistory` closure (one line).
  Tests: `tests/db/driftQueries.test.ts`, `tests/sync/drift/suppression.test.ts` (new),
  `tests/sync/syncHistoryRecord.test.ts`.
- **A2 — OpenAPI.** Owns: `docs/api/v1/{schemas/drift.yaml, paths/drift.yaml, openapi.yaml,
schemas/sync.yaml, schemas/sync-history.yaml, schemas/events.yaml}`, the regenerated
  `packages/praxrr-app/src/lib/api/v1.d.ts`, and `packages/praxrr-api/openapi.json`.

Wave 2 (three agents in parallel, after wave 1 lands):

- **B — Suppression wiring + health + read API.** Owns: `sync/drift/persist.ts` (`shouldNotify(prior,
next, suppression)` on the effective signature, `drift_detected_at` stamping, the
  `clearStaleAcknowledgements` call, notify-mode line, the `queueAutoRemediationIfEligible` call),
  `sync/drift/responses.ts`, `sync/drift/summary.ts`, `health/gather.ts`, `shared/health/types.ts`
  (`DriftFacts` gains `suppression: 'acknowledged'|'snoozed'|null`, `acknowledged: number`;
  `drifted`/`missing` become effective counts), `shared/health/criteria.ts` (drift criterion:
  suppressed → 100 with note "Drift acknowledged/snoozed until …"; partial → penalty on effective
  magnitude), `routes/api/v1/drift/[instanceId]/suppression/+server.ts`,
  `utils/auth/scopePolicy.ts` + `utils/auth/README.md`. Tests:
  `tests/sync/drift/persist.test.ts`, `tests/sync/drift/aggregate.test.ts` (shouldNotify),
  `tests/shared/health/criteria.test.ts`, `tests/routes/drift.test.ts` (suppression route),
  `tests/server/utils/auth/apiTokens.test.ts` (scope rows).
- **C — Preview core extraction + reconcile.** Owns: `sync/preview/create.ts` (new),
  `sync/preview/apply.ts` (new), `sync/preview/store.ts` + `sync/preview/types.ts` (`driftRemediation`
  field), `routes/api/v1/sync/preview/+server.ts`, `routes/api/v1/sync/preview/[previewId]/apply/+server.ts`
  (thin mappers, exports preserved), `jobs/handlers/arrSync.ts` (`ExecuteReviewedSyncJobInput.driftLink`
  → history + `recordRemediation`), `routes/api/v1/drift/[instanceId]/reconcile/+server.ts`. Tests:
  `tests/sync/drift/reconcile.test.ts` (new); keep `tests/base/syncPreviewRouteHardening.test.ts`,
  `bundleApiContract.test.ts`, and `tests/jobs/lidarrMetadataProfilesSync.test.ts` green without edits.
- **D — Auto-remediation + policy.** Owns: `sync/drift/remediation.ts` (new),
  `jobs/handlers/driftRemediate.ts` (new), `jobs/handlers/index.ts`, `jobs/queueTypes.ts`
  (`'drift.remediate'` + `DriftRemediateJobPayload { instanceId: number; driftSignature: string }`),
  `jobs/display.ts`, `jobs/evidence.ts`, `jobs/transparencyAudit.ts`, `shared/events/types.ts`
  (`SYNC_FAMILY_JOB_TYPES` += `drift.remediate`), `notifications/types.ts` + `shared/notifications/types.ts`
  (`drift.remediation.applied|failed|held`, category `Drift`),
  `routes/api/v1/drift/[instanceId]/remediation-policy/+server.ts`, and
  `routes/arr/[id]/sync/+page.server.ts` (treat a running `drift.remediate` job as covering its sections,
  like the canary resolver). Tests: `tests/sync/drift/remediation.test.ts` (new),
  `tests/jobs/driftRemediate.test.ts` (new). D codes against the §3.4 signatures; if C has not
  merged yet, it stubs via injected deps (handler takes
  `deps: { createReviewedPreview, applyReviewedPreview, checkAndPersistInstance, now }`).

Wave 3 (one agent each, parallel; after wave 2):

- **E — UI.** Owns: `routes/drift/[instanceId]/+page.svelte` (Reconcile + embedded `SyncPreviewPanel`;
  suppression bar with Acknowledge / Snooze 1d/7d/30d / Clear and per-row "Acknowledge" on drift/missing
  rows, acked rows de-emphasized; Remediation policy card with `DropdownSelect` mode + section checkboxes,
  auto warning copy, dirty store + save; last-remediation line), `routes/drift/+page.svelte`
  (Acknowledged/Snoozed/Auto badges), `routes/arr/[id]/sync/components/SyncPreviewPanel.svelte` (prop
  `regenerateEndpoint = '/api/v1/sync/preview'`, used only in `handleRegenerate`),
  `routes/sync-history/[id]/+page.svelte` (drift link block), `lib/client/ui/drift/driftStatus.ts`
  (suppression/remediation labels and variants). Svelte 5 without runes (`export let`, `$:`, `onclick`
  handlers), `alertStore.add`, existing `$ui` Badge/Button/Modal/DropdownSelect. The auto-mode
  enable flow uses a `Modal` confirm.
- **F — Docs.** Owns: `docs/site/src/content/docs/app/sync-pipeline.md` (drift remediation section),
  `docs/site/src/content/docs/app/notifications.md` (new types),
  `docs/plans/drift-detection/design.md` §11/§12 (mark the seams as implemented, link this plan). No
  RELEASING.md switch entry (D15).

## 8. Critical tests only

| Test                                | File                                   | Asserts                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signature change clears ack         | `tests/sync/drift/persist.test.ts`     | Ack sig-a → re-check yields sig-a: still acked, no notify, `drift_detected_at` unchanged; re-check yields sig-b: `acknowledged_signature` NULL, notify fires, `drift_detected_at` advances; recovery then identical sig-a returns: not acked and notifies. Entity keys absent from new changes are pruned.                                                                                                                                                             |
| Snooze expiry                       | `tests/sync/drift/suppression.test.ts` | `resolveDriftSuppression` with `snoozedUntil` = now+1 ms → `snoozed`, effective 0; now ≥ until → `none`; snooze survives a signature change.                                                                                                                                                                                                                                                                                                                           |
| shouldNotify respects suppression   | `tests/sync/drift/persist.test.ts`     | Acked/snoozed → false; partial ack + new un-acked entity → true; `notified_signature` stores the effective signature.                                                                                                                                                                                                                                                                                                                                                  |
| Health penalty respects suppression | `tests/shared/health/criteria.test.ts` | Acked or snoozed drifted instance → drift sub-score 100; partial ack → penalty only for effective count; expired snooze → full penalty.                                                                                                                                                                                                                                                                                                                                |
| Auto off by default                 | `tests/sync/drift/remediation.test.ts` | No policy row → `skip mode_off`; `notify` → `skip mode_notify`; `queueAutoRemediationIfEligible` enqueues nothing (job_queue row count 0).                                                                                                                                                                                                                                                                                                                             |
| Never writes unless drifted         | `tests/jobs/driftRemediate.test.ts`    | Status in-sync / error / unreachable / stale content / signature mismatch at handler time → `cancelled`; injected `applyReviewedPreview` and `createReviewedPreview` call counts == 0.                                                                                                                                                                                                                                                                                 |
| Canary path                         | `tests/sync/drift/remediation.test.ts` | Canary enabled + cohort > 1 + not default canary → `hold_canary`, `last_remediation_status='held_canary'`, no job enqueued; active rollout of same `arr_type` → skip; canary disabled or cohort == 1 → `remediate`. A Sonarr rollout never blocks Radarr (cross-Arr).                                                                                                                                                                                                  |
| Idempotency/concurrency             | `tests/jobs/driftRemediate.test.ts`    | Second run with the same signature → `already_attempted`, apply count 1; section in progress → skip; acked-entity section and managed-delete section excluded.                                                                                                                                                                                                                                                                                                         |
| Reconcile records linked history    | `tests/sync/drift/reconcile.test.ts`   | Reconcile route → preview carries `driftRemediation` (sections == drifted sections only); apply via `_handleSyncPreviewApplyRequest` with the real `executeReviewedSyncJob` + stubbed deps → `sync_history` row has `drift_signature`, `drift_detected_at`, `remediation_trigger='reconcile'`, and the drift row has `last_remediation_sync_history_id` == that id at the **exact** `instance_id`; a client-supplied `driftRemediation` in the create body is ignored. |
| Migration                           | `tests/db/driftQueries.test.ts`        | Up/down run; defaults are NULL/`'[]'`; `setSuppression` value guard returns false when the signature changed.                                                                                                                                                                                                                                                                                                                                                          |

Targeted runs only: `deno task test packages/praxrr-app/src/tests/sync/drift`,
`deno task test packages/praxrr-app/src/tests/jobs/driftRemediate.test.ts`,
`deno task test packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts`,
`deno task test packages/praxrr-app/src/tests/shared/health/criteria.test.ts`, `deno task check:server`,
`deno task check:client` (UI), then `graphify update .`.

## 9. Open questions needing user input (irreversible or behavior-defining)

1. **Meaning of `notify` mode (D8).** Assumed: `off` keeps today's drift notifications and only
   disables remediation; `notify` adds a "Reconcile suggested" line; `auto` applies. The alternative,
   where `off` also mutes `drift.detected`, would change current default behavior. Not recommended.
2. **Canary semantics (D10).** Assumed: hold for a human (no write) when Canary is enabled and the
   instance is not the default canary in a cohort larger than 1. The alternative is to start a canary
   rollout with the drifted instance as canary. That syncs the drifted instance via the non-reviewed
   `executeSyncJob` and gates a cohort-wide rollout, which is a larger blast radius. Not recommended.
3. **Schema is additive but permanent:** migration `20261103` adds 11 columns + 1 table + 3
   `sync_history` columns. Rollback is `down`, but once shipped the version number is fixed.
4. **Token scopes (D14):** suppression/policy routes require `admin`. If `sync:apply` tokens should be
   allowed to ack/snooze, that is a policy loosening and needs an explicit decision.
