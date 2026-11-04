import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { driftStatusQueries, type SetDriftSuppressionInput } from '$db/queries/driftStatus.ts';
import { publishDriftRowUpdated } from '$lib/server/events/publish.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import { PREVIEW_REQUEST_BODY_LIMIT_BYTES } from '$sync/preview/limits.ts';
import {
  DRIFT_SNOOZE_MAX_MS,
  alertingKeys,
  driftContentSignature,
  entityAcksFor,
  resolveDriftSuppression,
} from '$sync/drift/suppression.ts';
import type { DriftSuppression } from '$sync/drift/types.ts';
import { toDriftDetail } from '$sync/drift/responses.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = { error: string };

/** Validated `DriftSuppressionUpdateRequest`. */
interface SuppressionUpdate {
  expectedSignature: string | null;
  acknowledgeInstance: boolean;
  acknowledgedEntityKeys: string[];
  snoozedUntil: string | null;
}

const SOURCE = 'DriftSuppressionRoute';

function parseInstanceId(raw: string | undefined): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

function badRequest(error: string): Response {
  return json({ error } satisfies ErrorResponse, { status: 400 });
}

/**
 * Notification dedup carry for a NARROWING ack (plan D7: re-alert only for a NEW un-acked entity).
 * When the change only adds acknowledgements (every previously active ack stays active) and leaves
 * something still alerting, the remaining un-acked set was already covered by the prior alert, so
 * the stored notified signature moves from the pre-change to the post-change effective signature
 * (the query applies it only if the user was in fact notified about the pre-change set). Clearing
 * or shrinking an ack returns `null`, so the re-exposed entities alert again on the next refresh.
 */
function resolveNotifiedCarry(
  before: DriftSuppression,
  after: DriftSuppression
): SetDriftSuppressionInput['carryNotified'] {
  if (before.effectiveSignature === null || after.effectiveSignature === null) {
    return null;
  }
  if (before.effectiveSignature === after.effectiveSignature) {
    return null;
  }
  const nowAcked = new Set(after.acknowledgedEntityKeys);
  const narrowing = before.acknowledgedEntityKeys.every((key) => nowAcked.has(key));
  return narrowing ? { from: before.effectiveSignature, to: after.effectiveSignature } : null;
}

/** Strict runtime validation of the request body; returns an error message on failure. */
function parseUpdate(body: unknown): SuppressionUpdate | string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return 'Body must be a JSON object';
  }
  const input = body as Record<string, unknown>;
  const { expectedSignature, acknowledgeInstance, acknowledgedEntityKeys, snoozedUntil } = input;
  if (expectedSignature !== null && typeof expectedSignature !== 'string') {
    return 'expectedSignature must be a string or null';
  }
  if (typeof acknowledgeInstance !== 'boolean') {
    return 'acknowledgeInstance must be a boolean';
  }
  if (!Array.isArray(acknowledgedEntityKeys) || !acknowledgedEntityKeys.every((key) => typeof key === 'string')) {
    return 'acknowledgedEntityKeys must be an array of strings';
  }
  if (snoozedUntil !== null && typeof snoozedUntil !== 'string') {
    return 'snoozedUntil must be an ISO date-time string or null';
  }
  return {
    expectedSignature,
    acknowledgeInstance,
    acknowledgedEntityKeys: [...new Set(acknowledgedEntityKeys as string[])],
    snoozedUntil,
  };
}

/**
 * PUT /api/v1/drift/{instanceId}/suppression
 *
 * Replaces the instance's acknowledgement + snooze state. Value-guarded on the drift signature the
 * client reviewed: a changed signature returns 409 (both before validation and atomically in the
 * UPDATE). Acknowledgements require a `drifted` row and may only name current alerting entity
 * keys; a snooze must lie in the future and at most 90 days ahead. Suppression never rewrites the
 * stored drift status — it only mutes notifications and the health penalty. Token scope: `admin`.
 */
export const PUT: RequestHandler = async ({ params, request }) => {
  const instanceId = parseInstanceId(params.instanceId);
  if (instanceId === null) {
    return badRequest('Invalid instance id');
  }

  const instance = arrInstancesQueries.getById(instanceId);
  if (!instance) {
    return json({ error: 'Instance not found' } satisfies ErrorResponse, { status: 404 });
  }
  if (!isSyncPreviewArrType(instance.type)) {
    return badRequest(`Unsupported instance type: ${instance.type}`);
  }

  const contentLength = Number.parseInt(request.headers.get('content-length') ?? '', 10);
  if (Number.isInteger(contentLength) && contentLength > PREVIEW_REQUEST_BODY_LIMIT_BYTES) {
    return badRequest(`Request body exceeds ${PREVIEW_REQUEST_BODY_LIMIT_BYTES} bytes`);
  }

  let rawBody: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > PREVIEW_REQUEST_BODY_LIMIT_BYTES) {
      return badRequest(`Request body exceeds ${PREVIEW_REQUEST_BODY_LIMIT_BYTES} bytes`);
    }
    rawBody = JSON.parse(text);
  } catch {
    return badRequest('Invalid JSON body');
  }

  const update = parseUpdate(rawBody);
  if (typeof update === 'string') {
    return badRequest(update);
  }

  try {
    const row = driftStatusQueries.getById(instanceId);
    if (!row) {
      return badRequest('Drift has not been checked for this instance');
    }
    if (row.driftSignature !== update.expectedSignature) {
      return json({ error: 'Drift changed since it was reviewed; reload and retry' } satisfies ErrorResponse, {
        status: 409,
      });
    }

    const nowMs = Date.now();
    const before = resolveDriftSuppression(row, nowMs);
    const storedKeys = new Set(before.acknowledgedEntityKeys);
    // Existing (still content-matching) acks may be resent at any status, e.g. while snoozing an
    // instance that is currently unreachable; only GROWING the ack set requires live drift.
    const growsAck =
      (update.acknowledgeInstance && before.acknowledgedSignature === null) ||
      update.acknowledgedEntityKeys.some((key) => !storedKeys.has(key));
    if (growsAck && (row.status !== 'drifted' || row.driftSignature === null)) {
      return badRequest('Drift can only be acknowledged while the instance is drifted');
    }
    const currentKeys = new Set(alertingKeys(row.changes));
    const unknownKeys = update.acknowledgedEntityKeys.filter((key) => !currentKeys.has(key));
    if (unknownKeys.length > 0) {
      return badRequest(`Unknown drift entity keys: ${unknownKeys.join(', ')}`);
    }

    let snoozedUntil: string | null = null;
    if (update.snoozedUntil !== null) {
      const untilMs = Date.parse(update.snoozedUntil);
      if (!Number.isFinite(untilMs)) {
        return badRequest('snoozedUntil must be an ISO date-time string or null');
      }
      if (untilMs <= nowMs) {
        return badRequest('snoozedUntil must be in the future');
      }
      if (untilMs - nowMs > DRIFT_SNOOZE_MAX_MS) {
        return badRequest('snoozedUntil must be at most 90 days ahead');
      }
      snoozedUntil = new Date(untilMs).toISOString();
    }

    // Acks are fingerprinted server-side against the stored content the user reviewed (value-
    // guarded by `expectedSignature`), so a later field change on the same entity is not covered.
    const acknowledgedSignature = update.acknowledgeInstance ? driftContentSignature(row.changes) : null;
    const acknowledgedEntities = entityAcksFor(row.changes, update.acknowledgedEntityKeys);
    const acknowledging = acknowledgedSignature !== null || acknowledgedEntities.length > 0;
    // Keep the original ack time while the acknowledged set is unchanged; restamp on any change.
    const ackUnchanged =
      row.acknowledgedAt !== null &&
      before.acknowledgedSignature === acknowledgedSignature &&
      storedKeys.size === acknowledgedEntities.length &&
      acknowledgedEntities.every((ack) => storedKeys.has(ack.key));
    const acknowledgedAt = acknowledging ? (ackUnchanged ? row.acknowledgedAt : new Date(nowMs).toISOString()) : null;

    const nextSuppression = { acknowledgedSignature, acknowledgedEntities, snoozedUntil, acknowledgedAt };
    const after = resolveDriftSuppression({ ...row, ...nextSuppression }, nowMs);
    const applied = driftStatusQueries.setSuppression(instanceId, update.expectedSignature, {
      ...nextSuppression,
      carryNotified: resolveNotifiedCarry(before, after),
    });
    if (!applied) {
      return json({ error: 'Drift changed since it was reviewed; reload and retry' } satisfies ErrorResponse, {
        status: 409,
      });
    }

    publishDriftRowUpdated(instanceId);
    return json(toDriftDetail(instance, driftStatusQueries.getById(instanceId), nowMs));
  } catch (error) {
    await logger.error('Failed to update drift suppression', {
      source: SOURCE,
      meta: { instanceId, error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to update drift suppression' } satisfies ErrorResponse, { status: 500 });
  }
};
