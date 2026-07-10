import type {
  CanaryArrType,
  CanaryInstanceResult,
  CanaryOutcomeStatus,
  CanaryPartialPolicy,
  CanaryRemainingPreviewEvidence,
  CanaryRolloutDetail,
  CanaryRolloutRow,
  CanaryRolloutStatus,
  CanaryRolloutSummary,
  CanaryTarget,
  CanaryTrigger,
} from '$lib/server/sync/canary/types.ts';
import { buildPreviewFailure } from '$sync/preview/failureReason.ts';
import type { GeneratePreviewResult } from '$sync/preview/orchestrator.ts';
import type {
  DelayProfilesPreview,
  EntityChange,
  MediaManagementPreview,
  MetadataProfilesPreview,
  QualityProfilesPreview,
  SyncPreviewFailureCode,
  SyncPreviewFailureReason,
  SyncPreviewSectionOutcome,
  SyncPreviewSummary,
} from '$sync/preview/types.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import type { SectionType } from '$sync/types.ts';
import { db } from '../db.ts';

/**
 * Queries for `canary_rollouts` (issue #19). A rollout is scoped to exactly one
 * `arr_type` (no sibling fallback) and moves through a guarded lifecycle:
 * `canary_running` -> (`awaiting_confirmation` | `aborted` | `failed`) ->
 * `rolling_out` -> (`completed` | `failed` | `aborted`).
 *
 * Every state transition is a value-guarded UPDATE (status and/or `state_token`)
 * so a stale caller cannot double-proceed or resurrect a terminal row. Guarded
 * mutators return `db.execute(...) > 0`. Mirrors the raw-SQL query-module shape of
 * `pcdRollbacks.ts` / `syncHistory.ts`.
 */

/** Fields required to open a rollout in `canary_running` state. */
export interface InsertCanaryRolloutInput {
  arrType: CanaryArrType;
  canaryInstanceId: number | null;
  canaryInstanceName: string;
  sections: SectionType[] | null;
  maxBatchSize: number;
  partialPolicy: CanaryPartialPolicy;
  remainingTargets: CanaryTarget[];
  trigger: CanaryTrigger;
  startedAt: string;
  stateToken: string;
}

/**
 * Fields recorded once the canary sync classifies. `status` is the gate decision
 * (`awaiting_confirmation` to hold, or terminal `aborted`/`failed`); `nextToken`
 * re-issues `state_token` so the token captured before the canary ran can no
 * longer authorize a proceed. `finishedAt` is set only on a terminal transition.
 */
export interface RecordCanaryOutcomeInput {
  status: CanaryRolloutStatus;
  canaryStatus: CanaryOutcomeStatus;
  canaryOutput: string | null;
  canaryError: string | null;
  canarySyncHistoryId: number | null;
  remainingPreview: CanaryRemainingPreviewEvidence | null;
  nextToken: string;
  finishedAt: string | null;
}

function parseJsonArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

const SECTION_TYPES: readonly SectionType[] = [
  'qualityProfiles',
  'delayProfiles',
  'mediaManagement',
  'metadataProfiles',
];

const FAILURE_CODES: readonly SyncPreviewFailureCode[] = [
  'unreachable',
  'timeout',
  'unauthorized',
  'notFound',
  'rejected',
  'serverError',
  'sectionErrors',
  'executionFailed',
  'stale',
  'internalError',
];

interface DecodedTargets {
  targets: CanaryTarget[];
  valid: boolean;
}

interface PreviewDecodeResult {
  previews: GeneratePreviewResult[];
  hasSectionFailures: boolean;
}

interface EvidenceContextRow {
  arr_type: string;
  remaining_targets: string;
  started_at: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSectionType(value: unknown): value is SectionType {
  return typeof value === 'string' && SECTION_TYPES.includes(value as SectionType);
}

function isFailureCode(value: unknown): value is SyncPreviewFailureCode {
  return typeof value === 'string' && FAILURE_CODES.includes(value as SyncPreviewFailureCode);
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function fallbackTimestamp(value: string): string {
  return isValidTimestamp(value) ? value : '1970-01-01T00:00:00.000Z';
}

function canonicalFailure(value: unknown, arrType: CanaryArrType): SyncPreviewFailureReason | null {
  if (!isRecord(value) || !isFailureCode(value.code)) {
    return null;
  }
  return buildPreviewFailure(value.code, arrType);
}

/** Decode the authorizing target cohort without the display-only malformed-to-empty fallback. */
function decodeRemainingTargets(raw: string, arrType: string): DecodedTargets {
  if (!isSyncPreviewArrType(arrType)) {
    return { targets: [], valid: false };
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { targets: [], valid: false };
    }

    const targets: CanaryTarget[] = [];
    const ids = new Set<number>();
    for (const value of parsed) {
      if (
        !isRecord(value) ||
        !Number.isSafeInteger(value.instanceId) ||
        (value.instanceId as number) <= 0 ||
        typeof value.instanceName !== 'string' ||
        value.instanceName.length === 0 ||
        ids.has(value.instanceId as number)
      ) {
        return { targets: [], valid: false };
      }
      const target = {
        instanceId: value.instanceId as number,
        instanceName: value.instanceName,
      };
      ids.add(target.instanceId);
      targets.push(target);
    }
    return { targets, valid: true };
  } catch {
    return { targets: [], valid: false };
  }
}

function decodeFieldChange(value: unknown): EntityChange['fields'][number] | null {
  if (
    !isRecord(value) ||
    typeof value.field !== 'string' ||
    (value.type !== 'added' && value.type !== 'changed' && value.type !== 'removed')
  ) {
    return null;
  }
  return {
    field: value.field,
    type: value.type,
    current: value.current,
    desired: value.desired,
  };
}

function decodeEntityChange(value: unknown): EntityChange | null {
  if (
    !isRecord(value) ||
    typeof value.entityType !== 'string' ||
    typeof value.name !== 'string' ||
    (value.action !== 'create' &&
      value.action !== 'update' &&
      value.action !== 'delete' &&
      value.action !== 'unchanged') ||
    (value.remoteId !== null && !Number.isSafeInteger(value.remoteId)) ||
    !Array.isArray(value.fields)
  ) {
    return null;
  }
  const fields = value.fields.map(decodeFieldChange);
  if (fields.some((field) => field === null)) {
    return null;
  }
  return {
    entityType: value.entityType,
    name: value.name,
    action: value.action,
    remoteId: value.remoteId as number | null,
    fields: fields as EntityChange['fields'],
  };
}

function decodeEntities(value: unknown): EntityChange[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const entities = value.map(decodeEntityChange);
  return entities.some((entity) => entity === null) ? null : (entities as EntityChange[]);
}

function decodeNullableEntity(value: unknown): EntityChange | null | undefined {
  return value === null ? null : (decodeEntityChange(value) ?? undefined);
}

function decodeQualityProfiles(value: unknown): QualityProfilesPreview | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || value.section !== 'qualityProfiles') return undefined;
  const customFormats = decodeEntities(value.customFormats);
  const qualityProfiles = decodeEntities(value.qualityProfiles);
  return customFormats && qualityProfiles ? { section: 'qualityProfiles', customFormats, qualityProfiles } : undefined;
}

function decodeDelayProfiles(value: unknown): DelayProfilesPreview | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || value.section !== 'delayProfiles') return undefined;
  const profile = decodeNullableEntity(value.profile);
  return profile !== undefined ? { section: 'delayProfiles', profile } : undefined;
}

function decodeMediaManagement(value: unknown): MediaManagementPreview | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || value.section !== 'mediaManagement') return undefined;
  const naming = decodeNullableEntity(value.naming);
  const qualityDefinitions = decodeEntities(value.qualityDefinitions);
  const mediaSettings = decodeNullableEntity(value.mediaSettings);
  return naming !== undefined && qualityDefinitions && mediaSettings !== undefined
    ? { section: 'mediaManagement', naming, qualityDefinitions, mediaSettings }
    : undefined;
}

function decodeMetadataProfiles(value: unknown): MetadataProfilesPreview | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || value.section !== 'metadataProfiles') return undefined;
  const profile = decodeNullableEntity(value.profile);
  return profile !== undefined ? { section: 'metadataProfiles', profile } : undefined;
}

function decodeSummary(value: unknown): SyncPreviewSummary | null {
  if (!isRecord(value)) return null;
  const keys = ['totalCreates', 'totalUpdates', 'totalDeletes', 'totalUnchanged'] as const;
  if (keys.some((key) => !Number.isSafeInteger(value[key]) || (value[key] as number) < 0)) return null;
  return {
    totalCreates: value.totalCreates as number,
    totalUpdates: value.totalUpdates as number,
    totalDeletes: value.totalDeletes as number,
    totalUnchanged: value.totalUnchanged as number,
  };
}

function decodeSectionOutcomes(
  value: unknown,
  arrType: CanaryArrType,
  sections: readonly SectionType[]
): SyncPreviewSectionOutcome[] | null {
  if (!Array.isArray(value) || value.length !== sections.length) return null;
  const outcomes: SyncPreviewSectionOutcome[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const outcome = value[index];
    if (!isRecord(outcome) || outcome.section !== sections[index] || typeof outcome.skipped !== 'boolean') return null;
    const failure = outcome.failure === null ? null : canonicalFailure(outcome.failure, arrType);
    if (outcome.failure !== null && failure === null) return null;
    outcomes.push({
      section: outcome.section as SectionType,
      failure,
      skipped: outcome.skipped,
    });
  }
  return outcomes;
}

function decodePreview(
  value: unknown,
  arrType: CanaryArrType,
  targetsById: ReadonlyMap<number, CanaryTarget>
): { preview: GeneratePreviewResult; hasSectionFailure: boolean } | null {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.instanceId) ||
    typeof value.instanceName !== 'string' ||
    value.arrType !== arrType ||
    value.status !== 'ready' ||
    !Number.isSafeInteger(value.createdAtMs) ||
    (value.createdAtMs as number) < 0 ||
    !Array.isArray(value.sections)
  ) {
    return null;
  }

  const target = targetsById.get(value.instanceId as number);
  if (!target || target.instanceName !== value.instanceName) return null;
  const sections = value.sections.filter(isSectionType);
  if (sections.length !== value.sections.length || new Set(sections).size !== sections.length) return null;
  const sectionOutcomes = decodeSectionOutcomes(value.sectionOutcomes, arrType, sections);
  const qualityProfiles = decodeQualityProfiles(value.qualityProfiles);
  const delayProfiles = decodeDelayProfiles(value.delayProfiles);
  const mediaManagement = decodeMediaManagement(value.mediaManagement);
  const metadataProfiles = decodeMetadataProfiles(value.metadataProfiles);
  const summary = decodeSummary(value.summary);
  if (
    !sectionOutcomes ||
    qualityProfiles === undefined ||
    delayProfiles === undefined ||
    mediaManagement === undefined ||
    metadataProfiles === undefined ||
    !summary
  ) {
    return null;
  }

  const payloads: Record<SectionType, unknown> = {
    qualityProfiles,
    delayProfiles,
    mediaManagement,
    metadataProfiles,
  };
  for (const section of SECTION_TYPES) {
    const outcome = sectionOutcomes.find((candidate) => candidate.section === section);
    const payload = payloads[section];
    if ((!outcome || outcome.skipped || outcome.failure !== null) !== (payload === null)) return null;
  }

  return {
    preview: {
      instanceId: value.instanceId as number,
      instanceName: value.instanceName,
      arrType,
      status: 'ready',
      createdAtMs: value.createdAtMs as number,
      sections,
      sectionOutcomes,
      qualityProfiles,
      delayProfiles,
      mediaManagement,
      metadataProfiles,
      summary,
    },
    hasSectionFailure: sectionOutcomes.some((outcome) => outcome.failure !== null),
  };
}

function decodePreviews(
  value: unknown,
  arrType: CanaryArrType,
  targets: readonly CanaryTarget[]
): PreviewDecodeResult | null {
  if (!Array.isArray(value)) return null;
  const targetsById = new Map(targets.map((target) => [target.instanceId, target]));
  const ids = new Set<number>();
  const previews: GeneratePreviewResult[] = [];
  let hasSectionFailures = false;
  for (const rawPreview of value) {
    const decoded = decodePreview(rawPreview, arrType, targetsById);
    if (!decoded || ids.has(decoded.preview.instanceId)) return null;
    ids.add(decoded.preview.instanceId);
    previews.push(decoded.preview);
    hasSectionFailures ||= decoded.hasSectionFailure;
  }
  return { previews, hasSectionFailures };
}

function hasExactTargets(previews: readonly GeneratePreviewResult[], targets: readonly CanaryTarget[]): boolean {
  return (
    previews.length === targets.length &&
    previews.every((preview) => targets.some((t) => t.instanceId === preview.instanceId))
  );
}

function unavailableEvidence(
  arrType: CanaryArrType,
  generatedAt: string,
  code: SyncPreviewFailureCode = 'internalError',
  partialPreviews: GeneratePreviewResult[] = []
): CanaryRemainingPreviewEvidence {
  return {
    version: 1,
    availability: 'unavailable',
    generatedAt: fallbackTimestamp(generatedAt),
    failure: buildPreviewFailure(code, arrType),
    partialPreviews,
  };
}

function decodeRemainingPreview(
  raw: string | null,
  arrTypeValue: string,
  targets: DecodedTargets,
  fallbackGeneratedAt: string
): CanaryRemainingPreviewEvidence {
  if (!isSyncPreviewArrType(arrTypeValue) || !targets.valid || raw === null) {
    return unavailableEvidence(isSyncPreviewArrType(arrTypeValue) ? arrTypeValue : 'radarr', fallbackGeneratedAt);
  }
  const arrType = arrTypeValue;

  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1 || !isValidTimestamp(value.generatedAt)) {
      return unavailableEvidence(arrType, fallbackGeneratedAt);
    }

    if (value.availability === 'available') {
      const decoded = decodePreviews(value.previews, arrType, targets.targets);
      if (!decoded || !hasExactTargets(decoded.previews, targets.targets)) {
        return unavailableEvidence(arrType, value.generatedAt);
      }
      if (decoded.hasSectionFailures) {
        return unavailableEvidence(arrType, value.generatedAt, 'sectionErrors', decoded.previews);
      }
      return {
        version: 1,
        availability: 'available',
        generatedAt: value.generatedAt,
        previews: decoded.previews,
      };
    }

    if (value.availability === 'unavailable') {
      const failure = canonicalFailure(value.failure, arrType);
      const decoded = decodePreviews(value.partialPreviews, arrType, targets.targets);
      if (!failure || !decoded) return unavailableEvidence(arrType, value.generatedAt);
      return {
        version: 1,
        availability: 'unavailable',
        generatedAt: value.generatedAt,
        failure,
        partialPreviews: decoded.previews,
      };
    }

    return unavailableEvidence(arrType, value.generatedAt);
  } catch {
    return unavailableEvidence(arrType, fallbackGeneratedAt);
  }
}

const SUMMARY_COLUMNS = `id, arr_type, status, canary_instance_id, canary_instance_name, canary_status,
	max_batch_size, partial_policy, remaining_targets, rollout_results, trigger,
	started_at, finished_at, created_at, updated_at`;

/**
 * List-row projection. Heavy blobs and `state_token` are NOT exposed;
 * `remainingCount`/`completedCount` derive from the array lengths.
 */
function rowToSummary(row: CanaryRolloutRow): CanaryRolloutSummary {
  const remainingTargets = decodeRemainingTargets(row.remaining_targets, row.arr_type);
  return {
    id: row.id,
    arrType: row.arr_type as CanaryArrType,
    status: row.status as CanaryRolloutStatus,
    canaryInstanceId: row.canary_instance_id,
    canaryInstanceName: row.canary_instance_name,
    canaryStatus: (row.canary_status as CanaryOutcomeStatus | null) ?? null,
    maxBatchSize: row.max_batch_size,
    partialPolicy: row.partial_policy as CanaryPartialPolicy,
    remainingCount: remainingTargets.targets.length,
    completedCount: parseJsonArray<CanaryInstanceResult>(row.rollout_results).length,
    trigger: row.trigger as CanaryTrigger,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Full detail — decoded blobs and the current `state_token`. */
function rowToDetail(row: CanaryRolloutRow): CanaryRolloutDetail {
  const remainingTargets = decodeRemainingTargets(row.remaining_targets, row.arr_type);
  return {
    id: row.id,
    arrType: row.arr_type as CanaryArrType,
    status: row.status as CanaryRolloutStatus,
    canaryInstanceId: row.canary_instance_id,
    canaryInstanceName: row.canary_instance_name,
    canaryStatus: (row.canary_status as CanaryOutcomeStatus | null) ?? null,
    canarySyncHistoryId: row.canary_sync_history_id,
    sections: row.sections ? parseJsonArray<SectionType>(row.sections) : null,
    maxBatchSize: row.max_batch_size,
    partialPolicy: row.partial_policy as CanaryPartialPolicy,
    canaryOutput: row.canary_output,
    canaryError: row.canary_error,
    remainingTargets: remainingTargets.targets,
    remainingPreview: decodeRemainingPreview(
      row.remaining_preview_evidence,
      row.arr_type,
      remainingTargets,
      row.started_at
    ),
    batchCursor: row.batch_cursor,
    rolloutResults: parseJsonArray<CanaryInstanceResult>(row.rollout_results),
    trigger: row.trigger as CanaryTrigger,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    stateToken: row.state_token,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const canaryRolloutQueries = {
  /** Open a rollout in `canary_running` state. Returns the new row id. */
  insert(input: InsertCanaryRolloutInput): number {
    db.execute(
      `INSERT INTO canary_rollouts (
				arr_type, status, canary_instance_id, canary_instance_name, sections,
				max_batch_size, partial_policy, remaining_targets, trigger, started_at, state_token
			) VALUES (?, 'canary_running', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.arrType,
      input.canaryInstanceId,
      input.canaryInstanceName,
      input.sections ? JSON.stringify(input.sections) : null,
      input.maxBatchSize,
      input.partialPolicy,
      JSON.stringify(input.remainingTargets),
      input.trigger,
      input.startedAt,
      input.stateToken
    );
    const row = db.queryFirst<{ id: number }>('SELECT last_insert_rowid() AS id');
    return row?.id ?? 0;
  },

  /** Full detail for a single rollout, or undefined if unknown. */
  getById(id: number): CanaryRolloutDetail | undefined {
    const row = db.queryFirst<CanaryRolloutRow>('SELECT * FROM canary_rollouts WHERE id = ?', id);
    return row ? rowToDetail(row) : undefined;
  },

  /** Paginated list of summaries, newest first (stable id tiebreak). */
  listRecent(limit: number, offset: number): CanaryRolloutSummary[] {
    const rows = db.query<CanaryRolloutRow>(
      `SELECT ${SUMMARY_COLUMNS} FROM canary_rollouts
			ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?`,
      limit,
      offset
    );
    return rows.map(rowToSummary);
  },

  /**
   * Record the classified canary outcome and apply the gate decision. Guarded to
   * `canary_running` so a re-run cannot overwrite an already-decided rollout;
   * re-issues `state_token` to `nextToken`.
   */
  recordCanaryOutcome(id: number, input: RecordCanaryOutcomeInput): boolean {
    const context = db.queryFirst<EvidenceContextRow>(
      'SELECT arr_type, remaining_targets, started_at FROM canary_rollouts WHERE id = ?',
      id
    );
    if (!context) return false;
    const targets = decodeRemainingTargets(context.remaining_targets, context.arr_type);
    const remainingPreview = decodeRemainingPreview(
      input.remainingPreview === null ? null : JSON.stringify(input.remainingPreview),
      context.arr_type,
      targets,
      context.started_at
    );
    return (
      db.execute(
        `UPDATE canary_rollouts SET
					status = ?, canary_status = ?, canary_output = ?, canary_error = ?,
					canary_sync_history_id = ?, remaining_preview_evidence = ?, state_token = ?, finished_at = ?,
					updated_at = CURRENT_TIMESTAMP
				WHERE id = ? AND status = 'canary_running'`,
        input.status,
        input.canaryStatus,
        input.canaryOutput,
        input.canaryError,
        input.canarySyncHistoryId,
        JSON.stringify(remainingPreview),
        input.nextToken,
        input.finishedAt,
        id
      ) > 0
    );
  },

  /**
   * Transition the gate to `rolling_out`. Value-guarded on both the current
   * `awaiting_confirmation` state and the caller's `expectedToken` (the real
   * double-proceed guard); re-issues `state_token` to `nextToken`.
   */
  markRollingOut(id: number, expectedToken: string, nextToken: string): boolean {
    return (
      db.execute(
        `UPDATE canary_rollouts SET
					status = 'rolling_out', state_token = ?, updated_at = CURRENT_TIMESTAMP
				WHERE id = ? AND status = 'awaiting_confirmation' AND state_token = ?`,
        nextToken,
        id,
        expectedToken
      ) > 0
    );
  },

  /** Advance the batch cursor and persist accumulated results. Guarded to `rolling_out`. */
  recordBatchProgress(id: number, batchCursor: number, rolloutResults: CanaryInstanceResult[]): boolean {
    return (
      db.execute(
        `UPDATE canary_rollouts SET
					batch_cursor = ?, rollout_results = ?, updated_at = CURRENT_TIMESTAMP
				WHERE id = ? AND status = 'rolling_out'`,
        batchCursor,
        JSON.stringify(rolloutResults),
        id
      ) > 0
    );
  },

  /** Terminal transition of the rollout run. Guarded to `rolling_out`. */
  finishRollout(id: number, status: 'completed' | 'failed', finishedAt: string): boolean {
    return (
      db.execute(
        `UPDATE canary_rollouts SET
					status = ?, finished_at = ?, updated_at = CURRENT_TIMESTAMP
				WHERE id = ? AND status = 'rolling_out'`,
        status,
        finishedAt,
        id
      ) > 0
    );
  },

  /**
   * Abort at the gate. Value-guarded on `awaiting_confirmation` and the caller's
   * `expectedToken` so a stale gate view cannot abort a rollout that already
   * proceeded.
   */
  abort(id: number, expectedToken: string, finishedAt: string): boolean {
    return (
      db.execute(
        `UPDATE canary_rollouts SET
					status = 'aborted', finished_at = ?, updated_at = CURRENT_TIMESTAMP
				WHERE id = ? AND status = 'awaiting_confirmation' AND state_token = ?`,
        finishedAt,
        id,
        expectedToken
      ) > 0
    );
  },
};
