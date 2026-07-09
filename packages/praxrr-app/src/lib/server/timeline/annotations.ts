/**
 * Annotation write service (issue #27): auth gating, body validation, and create-time
 * event-existence checks. Throws {@link TimelineHttpError} with the exact status a route returns.
 *
 * Auth: any authenticated user (or AUTH-bypass request) may add a note; edit/delete are gated to
 * the original author (author_user_id) unless the request is in AUTH-bypass mode. Notes created
 * under AUTH=off carry a null author and are only editable/deletable in bypass mode.
 */

import { timelineAnnotationQueries } from '$db/queries/timelineAnnotations.ts';
import { timelineFeedQueries } from '$db/queries/timelineFeed.ts';
import { TimelineHttpError } from './errors.ts';
import type { TimelineAnnotation, TimelineSource } from './types.ts';

/** Sources currently allowed to be annotated (matches the migration CHECK). */
const ACTIVE_SOURCES: readonly TimelineSource[] = ['sync', 'canary', 'snapshot', 'rollback'];
const MAX_BODY_LENGTH = 4000;

export interface AnnotationAuthContext {
  user: { id: number; username: string } | null;
  authBypass: boolean;
}

function requireWriter(auth: AnnotationAuthContext): void {
  if (!auth.user && !auth.authBypass) {
    throw new TimelineHttpError(401, 'Authentication required to add annotations');
  }
}

function requireAuthor(annotation: TimelineAnnotation, auth: AnnotationAuthContext): void {
  if (!auth.user && !auth.authBypass) {
    throw new TimelineHttpError(401, 'Authentication required');
  }
  if (auth.authBypass) return;
  if (annotation.authorUserId !== null && auth.user && annotation.authorUserId === auth.user.id) return;
  throw new TimelineHttpError(403, 'Only the author can modify this annotation');
}

function validateSource(source: unknown): TimelineSource {
  if (typeof source !== 'string' || !(ACTIVE_SOURCES as readonly string[]).includes(source)) {
    throw new TimelineHttpError(400, 'Invalid annotation source');
  }
  return source as TimelineSource;
}

function validateEventId(eventId: unknown): number {
  if (typeof eventId !== 'number' || !Number.isInteger(eventId) || eventId < 1) {
    throw new TimelineHttpError(400, 'Invalid eventId');
  }
  return eventId;
}

function validateBody(body: unknown): string {
  if (typeof body !== 'string') {
    throw new TimelineHttpError(400, 'body must be a string');
  }
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new TimelineHttpError(400, 'body must not be empty');
  }
  if (trimmed.length > MAX_BODY_LENGTH) {
    throw new TimelineHttpError(400, `body must not exceed ${MAX_BODY_LENGTH} characters`);
  }
  return trimmed;
}

export function createAnnotation(
  input: { source: unknown; eventId: unknown; body: unknown },
  auth: AnnotationAuthContext
): TimelineAnnotation {
  requireWriter(auth);
  const source = validateSource(input.source);
  const eventId = validateEventId(input.eventId);
  const body = validateBody(input.body);

  if (!timelineFeedQueries.eventExists(source, eventId)) {
    throw new TimelineHttpError(404, 'Timeline event not found');
  }

  return timelineAnnotationQueries.create({
    eventSource: source,
    eventId,
    body,
    authorUserId: auth.user?.id ?? null,
    authorName: auth.user?.username ?? null,
  });
}

export function updateAnnotation(id: number, body: unknown, auth: AnnotationAuthContext): TimelineAnnotation {
  const existing = timelineAnnotationQueries.getById(id);
  if (!existing) {
    throw new TimelineHttpError(404, 'Annotation not found');
  }
  requireAuthor(existing, auth);
  const clean = validateBody(body);
  const updated = timelineAnnotationQueries.update(id, clean);
  if (!updated) {
    throw new TimelineHttpError(404, 'Annotation not found');
  }
  return updated;
}

export function deleteAnnotation(id: number, auth: AnnotationAuthContext): void {
  const existing = timelineAnnotationQueries.getById(id);
  if (!existing) {
    throw new TimelineHttpError(404, 'Annotation not found');
  }
  requireAuthor(existing, auth);
  timelineAnnotationQueries.remove(id);
}

export function listAnnotations(source: unknown, eventId: unknown): TimelineAnnotation[] {
  const validSource = validateSource(source);
  const validEventId = validateEventId(eventId);
  return timelineAnnotationQueries.listForEvent(validSource, validEventId);
}
