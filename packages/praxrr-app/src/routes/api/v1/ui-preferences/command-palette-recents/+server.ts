import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import { commandPaletteRecentsQueries } from '$db/queries/commandPaletteRecents.ts';
import { validateCommandPaletteRecents } from '$shared/search/recents.ts';
import { logger } from '$logger/logger.ts';
import { checkWriteRateLimit, detectConcurrencyConflict } from '../../section-preferences/_helpers.ts';

type ErrorResponse = components['schemas']['ErrorResponse'];
type RecentsResponse = components['schemas']['CommandPaletteRecentsResponse'];

/** Rate-limit bucket shared by all recents writes of one user (cannot collide with a section key). */
const RATE_LIMIT_KEY = 'command-palette-recents';
const RATE_LIMIT_EXCEEDED_MESSAGE = 'Too many recents updates in a short period. Please retry later.';
/** Ten maximal entries serialize to well under this; anything larger is rejected before parsing. */
const MAX_BODY_BYTES = 64 * 1024;
/** Upper bound for the opaque `expectedUpdatedAt` token (an ISO timestamp is 24 characters). */
const MAX_TOKEN_LENGTH = 64;
const CONCURRENT_UPDATE_MESSAGE = 'Recents updated concurrently';

/** Recents need a real user row: auth bypass (`null`) and API-token users (`id 0`) get 401. */
function resolveUserId(locals: App.Locals): number | null {
  const id = locals.user?.id;
  return typeof id === 'number' && id > 0 ? id : null;
}

/** `undefined` when omitted, `null` for "no row yet", otherwise the token; throws on any other value. */
function parseExpectedUpdatedAt(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null) return raw;
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_TOKEN_LENGTH) {
    throw new Error(`expectedUpdatedAt must be null or a non-empty string (max ${MAX_TOKEN_LENGTH} characters)`);
  }
  return raw;
}

/**
 * GET /api/v1/ui-preferences/command-palette-recents
 *
 * The signed-in user's command palette recents, most recent first; `[]` when none are stored.
 * `updatedAt` is the concurrency token for the next PUT (`null` when nothing is stored).
 */
export const GET: RequestHandler = async ({ locals }) => {
  const userId = resolveUserId(locals);
  if (userId === null) {
    return json({ error: 'Unauthorized' } satisfies ErrorResponse, { status: 401 });
  }

  try {
    const stored = commandPaletteRecentsQueries.getByUserId(userId);
    return json({ recents: stored.recents, updatedAt: stored.updatedAt } satisfies RecentsResponse);
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
 * With `expectedUpdatedAt`, the write only applies if the stored token still matches (`null`:
 * only if nothing is stored yet); otherwise 409.
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

  let expectedUpdatedAt: string | null | undefined;
  try {
    expectedUpdatedAt = parseExpectedUpdatedAt('expectedUpdatedAt' in body ? body.expectedUpdatedAt : undefined);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid request body' } satisfies ErrorResponse, {
      status: 400,
    });
  }

  const rateLimitError = checkWriteRateLimit(userId, RATE_LIMIT_KEY, RATE_LIMIT_EXCEEDED_MESSAGE);
  if (rateLimitError) {
    return json({ error: rateLimitError } satisfies ErrorResponse, { status: 429 });
  }

  try {
    const { updatedAt: storedUpdatedAt } = commandPaletteRecentsQueries.getByUserId(userId);
    // `null` means "I read an empty store"; a row written since (another tab, or the previous
    // user of this browser) is a conflict too.
    const conflict =
      expectedUpdatedAt === null && storedUpdatedAt !== null
        ? CONCURRENT_UPDATE_MESSAGE
        : detectConcurrencyConflict(
            storedUpdatedAt === null ? undefined : { updatedAt: storedUpdatedAt },
            expectedUpdatedAt,
            'recents'
          );
    if (conflict) {
      return json({ error: conflict } satisfies ErrorResponse, { status: 409 });
    }

    // The guarded write re-checks the token atomically, covering a write between read and replace.
    const updatedAt = commandPaletteRecentsQueries.replace(userId, validation.recents, expectedUpdatedAt);
    if (updatedAt === null) {
      return json({ error: CONCURRENT_UPDATE_MESSAGE } satisfies ErrorResponse, { status: 409 });
    }
    return json({ recents: validation.recents, updatedAt } satisfies RecentsResponse);
  } catch (error) {
    await logger.error('Failed to save command palette recents', {
      source: 'CommandPaletteRecentsRoute',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to save recents' } satisfies ErrorResponse, { status: 500 });
  }
};
