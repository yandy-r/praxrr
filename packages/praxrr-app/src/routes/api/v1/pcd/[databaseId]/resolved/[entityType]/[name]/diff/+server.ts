import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import { computeLiveDiff, pcdManager } from '$pcd/index.ts';
import type { ResolvedEntityType } from '$pcd/index.ts';
// Not re-exported via `$pcd/index.ts` -- imported directly from its owning module, same
// established pattern as the list endpoint's `computeHasPendingConflict` import.
import { mapEntityTypeToSection } from '$pcd/resolved/liveDiff.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { isArrAppType } from '$shared/arr/capabilities.ts';
import type { EntityChange } from '$sync/preview/types.ts';
import type { SectionType } from '$sync/types.ts';
import { registerPreviewCreateAttempt } from '$sync/preview/limits.ts';
import { logger } from '$logger/logger.ts';
import { isKnownResolvedEntityType, mapResolvedErrorToResponse, sanitizeBigInts } from '../../../shared.ts';

type ResolvedLiveDiffResponse = components['schemas']['ResolvedLiveDiffResponse'];
type ErrorResponse = components['schemas']['ErrorResponse'];

const SOURCE = 'pcd/resolved/[entityType]/[name]/diff';

/**
 * Testable dependency seam for `computeLiveDiff`, mirroring `_serializeDependencies` /
 * `_deserializeDependencies` in `pcd/export/+server.ts` / `pcd/import/+server.ts`.
 * `computeLiveDiff` is a bare named function export -- its ESM binding cannot be
 * monkey-patched directly from a test file -- so route tests instead patch this
 * object's property via the established `patchTarget` idiom.
 */
export const _liveDiffDependencies = {
  computeLiveDiff,
};

/**
 * `EntityChange.fields[].current`/`.desired` (`$sync/preview/types.ts`) are internally
 * typed `unknown`, while the generated `EntityChange`/`FieldChange` OpenAPI schemas type
 * them as a closed JSON-value union. Same wire-boundary narrowing as the sibling named
 * endpoint's `toWirePayload`/`toWireOverrides` -- the two shapes are identical once
 * serialized to JSON.
 */
function toWireChange(change: EntityChange): ResolvedLiveDiffResponse['changes'][number] {
  return change as unknown as ResolvedLiveDiffResponse['changes'][number];
}

/**
 * How `instance`'s own per-section sync selection for `entityType` relates to
 * `databaseId`. The live diff's desired state comes from the INSTANCE's sync
 * selection, not from the `databaseId` path segment directly -- an instance can be
 * configured to sync this section from an entirely different PCD database, in which
 * case computing a diff against the path database's entity would silently compare
 * against the wrong desired state. Checked before any live diff is attempted so the
 * mismatch surfaces as a caller-input 400, not a misleading result.
 *
 * The two failure modes are deliberately distinct so the client can say exactly what
 * to fix:
 * - `not_configured`: the instance has no sync selection for this section at all.
 * - `different_database`: a selection exists but references another PCD database.
 *
 * `qualityProfiles` supports multiple selections (`customFormat` and `qualityProfile`
 * entities share the section) -- a match on ANY selection is sufficient. Every other
 * section carries at most one selection (`databaseId: null` = unconfigured).
 */
type SyncTargetCheck = 'ok' | 'not_configured' | 'different_database';

function checkInstanceSyncTarget(
  instanceId: number,
  entityType: ResolvedEntityType,
  section: SectionType,
  databaseId: number
): SyncTargetCheck {
  const compare = (selected: number | null): SyncTargetCheck => {
    if (selected === null) return 'not_configured';
    return selected === databaseId ? 'ok' : 'different_database';
  };

  switch (section) {
    case 'qualityProfiles': {
      const { selections } = arrSyncQueries.getQualityProfilesSync(instanceId);
      if (selections.length === 0) return 'not_configured';
      return selections.some((selection) => selection.databaseId === databaseId) ? 'ok' : 'different_database';
    }
    case 'delayProfiles': {
      return compare(arrSyncQueries.getDelayProfilesSync(instanceId).databaseId);
    }
    case 'mediaManagement': {
      const sync = arrSyncQueries.getMediaManagementSync(instanceId);
      if (entityType === 'naming') return compare(sync.namingDatabaseId);
      if (entityType === 'mediaSettings') return compare(sync.mediaSettingsDatabaseId);
      if (entityType === 'qualityDefinitions') return compare(sync.qualityDefinitionsDatabaseId);
      // Unreachable: mapEntityTypeToSection only maps the three subsection entity
      // types above to 'mediaManagement'. Defensive fail-fast for future mappings.
      return 'not_configured';
    }
    case 'metadataProfiles': {
      return compare(arrSyncQueries.getMetadataProfilesSync(instanceId).databaseId);
    }
  }
}

/**
 * GET /api/v1/pcd/{databaseId}/resolved/{entityType}/{name}/diff
 *
 * Computes the desired-vs-actual field diff for a single named entity on one Arr
 * instance, via the sync-preview section syncer filtered to the entity
 * (namespace-suffix aware). An empty `EntityChange.fields` array (inside the single
 * `changes` row) means the entity is in sync; this is never conflatable with a failed
 * check, which is instead reported via a non-200 status.
 *
 * Path params:
 * - databaseId: PCD database ID
 * - entityType: resolved config entity type
 * - name: entity name
 *
 * Query params:
 * - instanceId: Arr instance ID to diff resolved state against (required)
 *
 * There is no `arrType` query param here (unlike the list/named endpoints) -- the
 * target instance determines the arr type, per docs/api/v1/paths/resolved-config.yaml.
 */
export const GET: RequestHandler = async ({ locals, params, url }) => {
  // Fail closed unless authenticated OR auth is explicitly bypassed (AUTH=off / local-subnet bypass).
  if (!locals.user && !locals.authBypass) {
    return json({ error: 'Unauthorized' } satisfies ErrorResponse, { status: 401 });
  }

  // Strict digits-only: reject leading-numeric junk like "1e5"/"1abc"/" 1" outright
  // per the fail-fast, no-ambiguous-ids policy for this endpoint.
  const databaseIdParam = params.databaseId;
  if (!databaseIdParam || !/^\d+$/.test(databaseIdParam)) {
    return json({ error: 'Invalid databaseId' } satisfies ErrorResponse, { status: 400 });
  }
  const databaseId = Number.parseInt(databaseIdParam, 10);

  const cache = pcdManager.getCache(databaseId);
  if (!cache?.isBuilt()) {
    // Deliberately 400, not 404: an unknown/unbuilt database is a caller input
    // problem here, matching the sibling list/named endpoints.
    return json({ error: 'Database not found' } satisfies ErrorResponse, { status: 400 });
  }

  const entityTypeParam = params.entityType;
  if (!entityTypeParam || !isKnownResolvedEntityType(entityTypeParam)) {
    return json({ error: `Unknown entityType "${entityTypeParam}"` } satisfies ErrorResponse, { status: 400 });
  }
  const entityType = entityTypeParam;

  const name = params.name;
  if (!name) {
    return json({ error: 'Invalid name' } satisfies ErrorResponse, { status: 400 });
  }

  const instanceIdParam = url.searchParams.get('instanceId');
  if (!instanceIdParam || !/^\d+$/.test(instanceIdParam)) {
    return json({ error: 'Invalid instanceId' } satisfies ErrorResponse, { status: 400 });
  }
  const instanceId = Number.parseInt(instanceIdParam, 10);

  const instance = arrInstancesQueries.getById(instanceId);
  if (!instance) {
    return json({ error: 'Arr instance not found' } satisfies ErrorResponse, { status: 404 });
  }

  // Desired state comes from the instance's OWN per-section sync selection, which may
  // reference a different PCD database than the one in the path -- reject a mismatch
  // before any live diff is attempted (see `instanceSyncTargetsDatabase`'s doc).
  // Entity types with no sync section at all (`regularExpression`) have no selection to
  // validate and fall through to `computeLiveDiff`'s existing `unsupported` handling.
  const section = mapEntityTypeToSection(entityType);
  if (section) {
    const syncTarget = checkInstanceSyncTarget(instanceId, entityType, section, databaseId);
    if (syncTarget === 'not_configured') {
      return json(
        {
          error: `Instance "${instance.name}" has no sync configuration for this section (${section}) — configure it on the instance's Sync page`,
        } satisfies ErrorResponse,
        { status: 400 }
      );
    }
    if (syncTarget === 'different_database') {
      return json(
        {
          error: `Instance "${instance.name}" syncs this section (${section}) from a different database — switch the viewer to that database or update the instance's sync selection`,
        } satisfies ErrorResponse,
        { status: 400 }
      );
    }
  }

  const nowMs = Date.now();
  if (!registerPreviewCreateAttempt(instanceId, nowMs)) {
    return json(
      { error: 'Too many live diff requests for this instance. Please retry shortly.' } satisfies ErrorResponse,
      { status: 429 }
    );
  }

  try {
    const result = await _liveDiffDependencies.computeLiveDiff({ instance, entityType, name, nowMs });

    if (!result.found) {
      if (result.reason === 'unsupported') {
        return json(
          {
            error: `Entity type "${entityType}" is unsupported for live diff against instance "${instance.name}"`,
          } satisfies ErrorResponse,
          { status: 400 }
        );
      }

      if (result.reason === 'not_found') {
        return json({ error: `Entity "${name}" not found` } satisfies ErrorResponse, { status: 404 });
      }

      if (result.reason === 'not_configured') {
        // The preview ran successfully -- this section simply has no sync
        // configuration on the instance at all. A caller-input problem (400), not an
        // infra failure (500).
        return json(
          {
            error: `Entity type "${entityType}" is not configured for live diff against instance "${instance.name}"`,
          } satisfies ErrorResponse,
          { status: 400 }
        );
      }

      // 'unreachable' | 'timeout' | 'unauthorized' | 'invalid_response' | 'error':
      // computeLiveDiff already logged full detail server-side -- only the sanitized
      // reason is safe to log/echo here. Not an exception -- a discriminated result
      // branch -- so this stays a direct log+500, not `mapResolvedErrorToResponse`
      // (reserved for `catch` blocks below).
      await logger.error('Live diff request failed', {
        source: SOURCE,
        meta: { databaseId, entityType, name, instanceId, reason: result.reason },
      });
      return json({ error: 'Failed to compute live diff' } satisfies ErrorResponse, { status: 500 });
    }

    if (!isArrAppType(instance.type)) {
      // Should not happen: computeLiveDiff only succeeds for radarr/sonarr/lidarr
      // instances. Defensive guard to keep `arrType` strictly typed on the response.
      await logger.error('Live diff succeeded for an instance with an unrecognized arr type', {
        source: SOURCE,
        meta: { databaseId, entityType, name, instanceId },
      });
      return json({ error: 'Failed to compute live diff' } satisfies ErrorResponse, { status: 500 });
    }

    const response: ResolvedLiveDiffResponse = {
      databaseId,
      entityType,
      name,
      instanceId,
      arrType: instance.type,
      changes: [toWireChange(result.change)],
    } satisfies ResolvedLiveDiffResponse;

    return json(sanitizeBigInts(response));
  } catch (error) {
    return mapResolvedErrorToResponse(error, {
      source: SOURCE,
      logMessage: 'Failed to compute resolved config live diff',
      meta: { databaseId, entityType, name, instanceId },
      fallbackMessage: 'Failed to compute live diff',
    });
  }
};
