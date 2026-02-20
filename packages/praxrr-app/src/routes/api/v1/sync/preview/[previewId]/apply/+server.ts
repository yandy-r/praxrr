import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getSectionsInProgress, executeSyncJob } from '$lib/server/jobs/handlers/arrSync.ts';
import type { SectionType } from '$lib/server/sync/types.ts';
import {
  previewStore,
  PREVIEW_STATUS_READY,
  PREVIEW_STATUS_APPLIED,
  PREVIEW_STATUS_APPLYING,
  PREVIEW_STATUS_FAILED,
  evaluatePreviewStaleness,
  PREVIEW_STALE_BLOCK_MS,
} from '$lib/server/sync/preview/store.ts';

function parseSections(raw: unknown): SectionType[] | null | undefined {
  if (raw === undefined) {
    return undefined;
  }

  if (!Array.isArray(raw)) {
    return null;
  }

  const sections: SectionType[] = [];
  for (const value of raw) {
    if (value === 'qualityProfiles' || value === 'delayProfiles' || value === 'mediaManagement' || value === 'metadataProfiles') {
      if (!sections.includes(value)) {
        sections.push(value);
      }
    } else {
      return null;
    }
  }

  return sections.length > 0 ? sections : [];
}

function staleWarningMessage(previewAgeMs: number): string {
  const minutes = Math.floor(previewAgeMs / (60 * 1000));
  if (minutes >= 60) {
    return `Preview is ${Math.round(minutes / 60)} hour(s) old.`;
  }
  return `Preview is ${minutes} minute(s) old.`;
}

export const POST: RequestHandler = async ({ params, request }) => {
  const previewId = params.previewId;
  if (!previewId) {
    return json({ error: 'previewId is required' }, { status: 400 });
  }

  const snapshot = previewStore.get(previewId);
  if (!snapshot) {
    return json({ error: 'Preview not found' }, { status: 404 });
  }

  if (snapshot.status !== PREVIEW_STATUS_READY) {
    return json({ error: `Invalid preview state: ${snapshot.status}` }, { status: 409 });
  }

  let requestBody: { sections?: unknown };
  try {
    requestBody = (await request.json()) as { sections?: unknown };
  } catch {
    requestBody = {};
  }

  const requestedSections = parseSections(requestBody.sections);
  if (requestedSections === null) {
    return json({ error: 'sections must be an array of valid sync sections' }, { status: 400 });
  }

  const sectionsToApply = requestedSections === undefined ? [...snapshot.sections] : requestedSections;
  if (sectionsToApply.length === 0) {
    return json({ error: 'No sections selected for apply' }, { status: 400 });
  }
  const unsupportedSections = sectionsToApply.filter((section) => !snapshot.sections.includes(section));
  if (unsupportedSections.length > 0) {
    return json({ error: `Invalid sections for this preview: ${unsupportedSections.join(', ')}` }, { status: 400 });
  }

  const nowMs = Date.now();
  const staleness = evaluatePreviewStaleness(snapshot, nowMs);
  if (staleness.shouldBlock) {
    const staleMinutes = Math.round(PREVIEW_STALE_BLOCK_MS / 60000);
    return json(
      {
        error: `Preview is older than ${staleMinutes} minutes. Regenerate before applying.`,
        staleWarning: staleWarningMessage(staleness.ageMs),
      },
      { status: 422 }
    );
  }

  const inProgressSections = getSectionsInProgress(snapshot.instanceId);
  const blockingSections = sectionsToApply.filter((section) => inProgressSections.includes(section));
  if (blockingSections.length > 0) {
    return json(
      { error: `Cannot apply while sync is running for: ${blockingSections.join(', ')}` },
      { status: 409 }
    );
  }

  const applyingSnapshot = previewStore.transition(previewId, PREVIEW_STATUS_APPLYING, nowMs);
  if (!applyingSnapshot) {
    return json(
      { error: `Cannot transition preview from ${snapshot.status} to ${PREVIEW_STATUS_APPLYING}` },
      { status: 409 }
    );
  }

  try {
    const result = await executeSyncJob(snapshot.instanceId, sectionsToApply, 'manual');
    const output = result.output ?? '';
    const success = result.status === 'success' || result.status === 'skipped';

    if (success) {
      previewStore.transition(previewId, PREVIEW_STATUS_APPLIED, Date.now());
      return json({
        success: true,
        results: {
          status: result.status,
          output,
        },
        staleWarning: staleness.shouldWarn ? staleWarningMessage(staleness.ageMs) : null,
      });
    }

    previewStore.updateResult(previewId, {
      status: PREVIEW_STATUS_FAILED,
      error: result.error || `Sync job failed with status ${result.status}`,
    });
    return json(
      {
        success: false,
        results: {
          status: result.status,
          output,
          error: result.error,
        },
        staleWarning: staleness.shouldWarn ? staleWarningMessage(staleness.ageMs) : null,
      },
      { status: 500 }
    );
  } catch (error) {
    previewStore.updateResult(previewId, {
      status: PREVIEW_STATUS_FAILED,
      error: error instanceof Error ? error.message : 'Unknown error while applying preview',
    });

    return json(
      {
        error: error instanceof Error ? error.message : 'Unknown error while applying preview',
        staleWarning: staleness.shouldWarn ? staleWarningMessage(staleness.ageMs) : null,
      },
      { status: 500 }
    );
  }
};
