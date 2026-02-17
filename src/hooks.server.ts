// Auto-spawn parser binary for standalone builds (must run before config import)
await import('$lib/server/utils/parser/spawn.ts');

import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { config } from '$config';
import { printBanner, getServerInfo, logContainerConfig } from '$logger/startup.ts';
import { logSettings } from '$logger/settings.ts';
import { logger } from '$logger/logger.ts';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { initializeJobs } from '$jobs/init.ts';
import { pcdManager } from '$pcd/index.ts';
import { getAuthState, isPublicPath, maybeExtendSession, cleanupExpiredSessions } from '$auth/middleware.ts';
import { getClientIp } from '$auth/network.ts';
import { setupStateQueries } from '$db/queries/setupState.ts';

// Initialize configuration on server startup
await config.init();

// Initialize database
await db.initialize();

// Run database migrations
await runMigrations();

// Load log settings from database (must be after migrations)
logSettings.load();

// Log container config (if running in Docker)
await logContainerConfig();

// Initialize PCD caches (must be after migrations and log settings)
await pcdManager.initialize();

// Auto-link default database on first startup (only once)
if (!setupStateQueries.isDefaultDatabaseLinked()) {
  try {
    await pcdManager.link({
      name: 'Profilarr-DB',
      repositoryUrl: 'https://github.com/yandy-r/profilarr-db',
      branch: 'v2',
      syncStrategy: 60,
      autoPull: true,
      personalAccessToken: undefined,
    });

    setupStateQueries.markDefaultDatabaseLinked();

    await logger.info('Default database auto-linked', {
      source: 'Setup',
      meta: { database: 'yandy-r' },
    });
  } catch (error) {
    // Don't fail startup, but mark as attempted so we don't retry every startup
    setupStateQueries.markDefaultDatabaseLinked();

    await logger.warn('Failed to auto-link default database', {
      source: 'Setup',
      meta: { error: String(error) },
    });
  }
}

// Initialize and start job queue
await initializeJobs();

// Clean expired sessions on startup
const expiredCount = cleanupExpiredSessions();
if (expiredCount > 0) {
  await logger.info(`Cleaned up ${expiredCount} expired session${expiredCount === 1 ? '' : 's'}`, {
    source: 'Auth:Session',
    meta: { count: expiredCount },
  });
}

// Log server ready
await logger.info('Server ready', {
  source: 'Startup',
  meta: getServerInfo(),
});

// Print startup banner with URL
printBanner();

/**
 * Auth middleware
 * Handles authentication, authorization, and session management
 */
export const handle: Handle = async ({ event, resolve }) => {
  const auth = getAuthState(event);

  // First-run setup flow (applies to all auth modes except AUTH=off)
  if (auth.needsSetup) {
    if (event.url.pathname === '/auth/setup') {
      return resolve(event);
    }
    throw redirect(303, '/auth/setup');
  }

  // AUTH=off or AUTH=local with local IP - skip auth after setup
  if (auth.skipAuth) {
    return resolve(event);
  }

  // Block setup page after user exists
  if (event.url.pathname === '/auth/setup') {
    throw redirect(303, '/');
  }

  // Public paths don't need auth
  if (isPublicPath(event.url.pathname)) {
    return resolve(event);
  }

  // Not authenticated - redirect or return 401
  if (!auth.user) {
    if (event.url.pathname.startsWith('/api')) {
      const ip = getClientIp(event);
      void logger.warn('Unauthorized API access', {
        source: 'Auth',
        meta: { ip, endpoint: event.url.pathname, method: event.request.method },
      });
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw redirect(303, '/auth/login');
  }

  // Sliding expiration: extend session if past halfway point
  if (auth.session) {
    maybeExtendSession(auth.session);
  }

  // Authenticated - attach user to locals for use in routes
  event.locals.user = auth.user;
  event.locals.session = auth.session;

  return resolve(event);
};
