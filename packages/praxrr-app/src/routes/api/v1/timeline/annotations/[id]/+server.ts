import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { deleteAnnotation, updateAnnotation, type AnnotationAuthContext } from '$lib/server/timeline/annotations.ts';
import { TimelineHttpError } from '$lib/server/timeline/errors.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = { error: string };

function authContext(locals: App.Locals): AnnotationAuthContext {
  return {
    user: locals.user ? { id: locals.user.id, username: locals.user.username } : null,
    authBypass: locals.authBypass,
  };
}

/** Parse the `[id]` route param as a positive integer, or throw a 400. */
function parseId(raw: string | undefined): number {
  if (raw === undefined || !/^[0-9]+$/.test(raw)) {
    throw new TimelineHttpError(400, 'Invalid annotation id');
  }
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) {
    throw new TimelineHttpError(400, 'Invalid annotation id');
  }
  return id;
}

/**
 * PATCH /api/v1/timeline/annotations/{id}
 *
 * Edit a note's body. Author-gated (403 for non-authors unless in AUTH-bypass mode); 404 unknown.
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  try {
    const id = parseId(params.id);
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      throw new TimelineHttpError(400, 'Invalid JSON body');
    }
    if (typeof payload !== 'object' || payload === null) {
      throw new TimelineHttpError(400, 'Invalid request body');
    }
    const { body } = payload as Record<string, unknown>;
    const updated = updateAnnotation(id, body, authContext(locals));
    return json(updated);
  } catch (error) {
    if (error instanceof TimelineHttpError) {
      return json({ error: error.message } satisfies ErrorResponse, { status: error.status });
    }
    await logger.error('Failed to update timeline annotation', {
      source: 'TimelineAnnotationRoute',
      meta: { id: params.id, error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to update annotation' } satisfies ErrorResponse, { status: 500 });
  }
};

/**
 * DELETE /api/v1/timeline/annotations/{id}
 *
 * Delete a note. Author-gated (403 for non-authors unless in AUTH-bypass mode); 404 unknown.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
  try {
    const id = parseId(params.id);
    deleteAnnotation(id, authContext(locals));
    return json({ deleted: true });
  } catch (error) {
    if (error instanceof TimelineHttpError) {
      return json({ error: error.message } satisfies ErrorResponse, { status: error.status });
    }
    await logger.error('Failed to delete timeline annotation', {
      source: 'TimelineAnnotationRoute',
      meta: { id: params.id, error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to delete annotation' } satisfies ErrorResponse, { status: 500 });
  }
};
