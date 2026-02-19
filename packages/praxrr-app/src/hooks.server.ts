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
import { reconcileEnvInstances } from '$arr/envInstances.ts';
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
  const defaultDatabaseUrlFromEnv = Deno.env.get('PRAXRR_DEFAULT_DB_URL');
  const defaultDatabaseUrl =
    defaultDatabaseUrlFromEnv === undefined ? 'https://github.com/yandy-r/praxrr-db' : defaultDatabaseUrlFromEnv.trim();
  const defaultDatabaseBranch = Deno.env.get('PRAXRR_DEFAULT_DB_BRANCH')?.trim() || 'v2';
  const defaultDatabaseName = Deno.env.get('PRAXRR_DEFAULT_DB_NAME')?.trim() || 'Praxrr-DB';
  const defaultDatabaseToken = Deno.env.get('PRAXRR_DEFAULT_DB_TOKEN')?.trim() || undefined;
  const defaultDatabaseGitUserName = Deno.env.get('PRAXRR_DEFAULT_DB_GIT_USERNAME')?.trim() || undefined;
  const defaultDatabaseGitUserEmail = Deno.env.get('PRAXRR_DEFAULT_DB_GIT_EMAIL')?.trim() || undefined;
  const hasCompleteGitIdentity = !!defaultDatabaseGitUserName && !!defaultDatabaseGitUserEmail;
  const hasPartialGitIdentity =
    (!!defaultDatabaseGitUserName || !!defaultDatabaseGitUserEmail) && !hasCompleteGitIdentity;

  if (hasPartialGitIdentity) {
    await logger.warn('Default database git identity is incomplete; skipping git author configuration', {
      source: 'Setup',
    });
  }

  if (!defaultDatabaseUrl) {
    setupStateQueries.markDefaultDatabaseLinked();
    await logger.info('Default database auto-link disabled', {
      source: 'Setup',
      meta: { reason: 'PRAXRR_DEFAULT_DB_URL is empty' },
    });
  } else {
    try {
      await pcdManager.link({
        name: defaultDatabaseName,
        repositoryUrl: defaultDatabaseUrl,
        branch: defaultDatabaseBranch,
        syncStrategy: 60,
        autoPull: true,
        personalAccessToken: defaultDatabaseToken,
        gitUserName: hasCompleteGitIdentity ? defaultDatabaseGitUserName : undefined,
        gitUserEmail: hasCompleteGitIdentity ? defaultDatabaseGitUserEmail : undefined,
      });

      setupStateQueries.markDefaultDatabaseLinked();

      await logger.info('Default database auto-linked', {
        source: 'Setup',
        meta: { name: defaultDatabaseName, url: defaultDatabaseUrl, branch: defaultDatabaseBranch },
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
}

try {
  const reconcileResult = await reconcileEnvInstances();
  await logger.info('Environment instance reconciliation completed', {
    source: 'Setup',
    meta: {
      created: reconcileResult.created,
      updated: reconcileResult.updated,
      disabled: reconcileResult.disabled,
      skippedConflictUi: reconcileResult.skippedConflictUi,
      skippedDuplicateEnvKey: reconcileResult.skippedDuplicateEnvKey,
      validationSuccesses: reconcileResult.validationSuccesses,
      validationFailures: reconcileResult.validationFailures,
      errors: reconcileResult.errors,
    },
  });
} catch (error) {
  await logger.warn('Environment instance reconciliation failed', {
    source: 'Setup',
    meta: { error: String(error) },
  });
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
  event.locals.user = auth.user;
  event.locals.session = auth.session;
  event.locals.authBypass = auth.skipAuth;

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
  return resolve(event);
};
