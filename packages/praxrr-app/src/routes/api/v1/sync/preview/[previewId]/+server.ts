import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { logger } from '$logger/logger.ts';
import { previewStore } from '$sync/preview/store.ts';

type ErrorResponse = {
  error: string;
};

function sanitizePreviewId(previewId: string | undefined): string | null {
  if (!previewId) {
    return null;
  }

  const trimmed = previewId.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export const GET: RequestHandler = async ({ params }) => {
  const previewId = sanitizePreviewId(params.previewId);
  if (!previewId) {
    return json({ error: 'previewId is required' } satisfies ErrorResponse, { status: 400 });
  }

  try {
    previewStore.cleanup();
    const snapshot = previewStore.get(previewId);
    if (!snapshot) {
      return json({ error: 'Preview not found or expired' } satisfies ErrorResponse, { status: 404 });
    }

    return json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch preview';
    await logger.error('Failed to get sync preview', {
      source: 'SyncPreview',
      meta: { previewId, error: message },
    });
    return json({ error: message } satisfies ErrorResponse, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ params }) => {
  const previewId = sanitizePreviewId(params.previewId);
  if (!previewId) {
    return json({ error: 'previewId is required' } satisfies ErrorResponse, { status: 400 });
  }

  try {
    previewStore.cleanup();
    const deleted = previewStore.delete(previewId);
    if (!deleted) {
      return json({ error: 'Preview not found or expired' } satisfies ErrorResponse, { status: 404 });
    }

    await logger.info('Deleted sync preview', {
      source: 'SyncPreview',
      meta: { previewId },
    });

    return new Response(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete preview';
    await logger.error('Failed to delete sync preview', {
      source: 'SyncPreview',
      meta: { previewId, error: message },
    });
    return json({ error: message } satisfies ErrorResponse, { status: 500 });
  }
};
