import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import { commandPaletteRecentsQueries } from '$db/queries/commandPaletteRecents.ts';
import { validateCommandPaletteRecents } from '$shared/search/recents.ts';
import { logger } from '$logger/logger.ts';
import { checkWriteRateLimit } from '../../section-preferences/_helpers.ts';

type ErrorResponse = components['schemas']['ErrorResponse'];
type RecentsResponse = components['schemas']['CommandPaletteRecentsResponse'];

/** Rate-limit bucket shared by all recents writes of one user (cannot collide with a section key). */
const RATE_LIMIT_KEY = 'command-palette-recents';
const RATE_LIMIT_EXCEEDED_MESSAGE = 'Too many recents updates in a short period. Please retry later.';
/** Ten maximal entries serialize to well under this; anything larger is rejected before parsing. */
const MAX_BODY_BYTES = 64 * 1024;

/** Recents need a real user row: auth bypass (`null`) and API-token users (`id 0`) get 401. */
function resolveUserId(locals: App.Locals): number | null {
  const id = locals.user?.id;
  return typeof id === 'number' && id > 0 ? id : null;
}

/**
 * GET /api/v1/ui-preferences/command-palette-recents
 *
 * The signed-in user's command palette recents, most recent first; `[]` when none are stored.
 */
export const GET: RequestHandler = async ({ locals }) => {
  const userId = resolveUserId(locals);
  if (userId === null) {
    return json({ error: 'Unauthorized' } satisfies ErrorResponse, { status: 401 });
  }

  try {
    return json({ recents: commandPaletteRecentsQueries.getByUserId(userId) } satisfies RecentsResponse);
  } catch (error) {
    await logger.error('Failed to read command palette recents', {
      source: 'CommandPaletteRecentsRoute',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to read recents' } satisfies ErrorResponse, { status: 500 });
  }
};

/**
 * PUT /api/v1/ui-preferences/command-palette-recents
 *
 * Replace the signed-in user's recents (at most 10, unique keys, same-origin relative hrefs).
 */
export const PUT: RequestHandler = async ({ locals, request }) => {
  const userId = resolveUserId(locals);
  if (userId === null) {
    return json({ error: 'Unauthorized' } satisfies ErrorResponse, { status: 401 });
  }

  // Reject a declared oversized body before buffering it; the byte check below still covers
  // chunked or mis-declared bodies.
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json({ error: 'Request body too large' } satisfies ErrorResponse, { status: 400 });
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return json({ error: 'Request body too large' } satisfies ErrorResponse, { status: 400 });
    }
    body = JSON.parse(text);
  } catch {
    return json({ error: 'Invalid JSON body' } satisfies ErrorResponse, { status: 400 });
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body) || !('recents' in body)) {
    return json({ error: 'Invalid request body' } satisfies ErrorResponse, { status: 400 });
  }

  const validation = validateCommandPaletteRecents(body.recents);
  if (!validation.ok) {
    return json({ error: validation.error } satisfies ErrorResponse, { status: 400 });
  }

  const rateLimitError = checkWriteRateLimit(userId, RATE_LIMIT_KEY, RATE_LIMIT_EXCEEDED_MESSAGE);
  if (rateLimitError) {
    return json({ error: rateLimitError } satisfies ErrorResponse, { status: 429 });
  }

  try {
    commandPaletteRecentsQueries.replace(userId, validation.recents);
    return json({ recents: validation.recents } satisfies RecentsResponse);
  } catch (error) {
    await logger.error('Failed to save command palette recents', {
      source: 'CommandPaletteRecentsRoute',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to save recents' } satisfies ErrorResponse, { status: 500 });
  }
};
