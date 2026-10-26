import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sessionsQueries } from '$db/queries/sessions.ts';
import { usersQueries } from '$db/queries/users.ts';
import { clearSessionCookie } from '$auth/sessionCookie.ts';
import { logger } from '$logger/logger.ts';

/**
 * GET /auth/logout
 *
 * Clear the current session cookie and remove the matching session from storage.
 * Redirects the user to the login page afterward.
 */
export const GET: RequestHandler = async (event) => {
  const { cookies } = event;
  const sessionToken = cookies.get('session');

  if (sessionToken) {
    // Get session info before deleting for logging
    const session = sessionsQueries.getByToken(sessionToken);
    if (session) {
      const user = usersQueries.getById(session.user_id);
      await logger.info(`User '${user?.username ?? 'unknown'}' logged out`, {
        source: 'Auth:Session',
        meta: { userId: session.user_id, username: user?.username },
      });
    }
    sessionsQueries.deleteByToken(sessionToken);
  }

  clearSessionCookie(event, cookies);

  throw redirect(303, '/auth/login');
};
