import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { createAnnotation, listAnnotations, type AnnotationAuthContext } from '$lib/server/timeline/annotations.ts';
import { TimelineHttpError } from '$lib/server/timeline/errors.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = { error: string };

function authContext(locals: App.Locals): AnnotationAuthContext {
  return {
    user: locals.user ? { id: locals.user.id, username: locals.user.username } : null,
    authBypass: locals.authBypass,
  };
}

/**
 * GET /api/v1/timeline/annotations?source=&eventId=
 *
 * Lists the annotation thread for one event (oldest first). Reachable for orphaned events too
 * (a note whose source event was pruned), which never surface in the merged feed.
 */
export const GET: RequestHandler = async ({ url }) => {
  const source = url.searchParams.get('source');
  const eventIdRaw = url.searchParams.get('eventId');
  const eventId = eventIdRaw === null ? undefined : Number(eventIdRaw);

  try {
    return json(listAnnotations(source, eventId));
  } catch (error) {
    if (error instanceof TimelineHttpError) {
      return json({ error: error.message } satisfies ErrorResponse, { status: error.status });
    }
    await logger.error('Failed to list timeline annotations', {
      source: 'TimelineAnnotationsRoute',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to list annotations' } satisfies ErrorResponse, { status: 500 });
  }
};

/**
 * POST /api/v1/timeline/annotations
 *
 * Attaches a note to a timeline event. Requires an authenticated user (or AUTH-bypass); the event
 * must exist (404 otherwise, so a note is never born dangling).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' } satisfies ErrorResponse, { status: 400 });
  }
  if (typeof payload !== 'object' || payload === null) {
    return json({ error: 'Invalid request body' } satisfies ErrorResponse, { status: 400 });
  }
  const { source, eventId, body } = payload as Record<string, unknown>;

  try {
    const annotation = createAnnotation({ source, eventId, body }, authContext(locals));
    return json(annotation, { status: 201 });
  } catch (error) {
    if (error instanceof TimelineHttpError) {
      return json({ error: error.message } satisfies ErrorResponse, { status: error.status });
    }
    await logger.error('Failed to create timeline annotation', {
      source: 'TimelineAnnotationsRoute',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to create annotation' } satisfies ErrorResponse, { status: 500 });
  }
};
