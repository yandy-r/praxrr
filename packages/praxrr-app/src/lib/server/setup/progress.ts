import { error, type RequestEvent } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { arrSyncQueries } from '$db/queries/arrSync.ts';
import { setupStateQueries } from '$db/queries/setupState.ts';
import { isPublicPath } from '$auth/middleware.ts';

/**
 * Setup prerequisite progress, derived from real entity state (never from the
 * startup `default_database_linked` flag, which is set on every boot). Used by
 * the wizard layout and the `GET /api/v1/setup/state` endpoint to render
 * prerequisite checkmarks and resolve the resume step.
 */
export interface SetupProgress {
  hasArrInstance: boolean;
  hasDatabase: boolean;
  hasProfileSelections: boolean;
}

/**
 * The primary connected instance for the wizard: prefer an enabled instance
 * (the common case for a freshly-connected one), falling back to the first
 * instance if none is enabled yet. Shared by every `/setup/*` step that needs
 * "the instance this wizard run is about."
 */
export function resolvePrimaryInstance() {
  return arrInstancesQueries.getEnabled()[0] ?? arrInstancesQueries.getAll()[0];
}

/**
 * Compute setup progress from existing queries. Synchronous — mirrors the
 * better-sqlite3-style synchronous query layer used elsewhere — so it is safe
 * to call directly from `hooks.server.ts` without adding async to the request
 * pipeline.
 */
export function getSetupProgress(): SetupProgress {
  const instances = arrInstancesQueries.getAll();
  const databases = databaseInstancesQueries.getAll();
  const hasProfileSelections = instances.some(
    (instance) => arrSyncQueries.getQualityProfilesSync(instance.id).selections.length > 0
  );

  return {
    hasArrInstance: instances.length > 0,
    hasDatabase: databases.length > 0,
    hasProfileSelections,
  };
}

/**
 * Paths the wizard redirect gate must never touch: API calls (they 401 on their
 * own and must never be redirected), auth/public paths, SvelteKit internal
 * assets, and the wizard itself (avoid a redirect loop).
 */
function isGateExemptPath(pathname: string): boolean {
  return (
    pathname.startsWith('/api') ||
    pathname.startsWith('/setup') ||
    pathname.startsWith('/_app') ||
    pathname === '/favicon.ico' ||
    isPublicPath(pathname)
  );
}

/**
 * Decide whether a page navigation should be redirected for the setup wizard.
 *
 * - Forward gate: a first-run deployment (`wizardShouldRun()`) browsing outside
 *   `/setup` is sent to `/setup` (which resumes at the current step).
 * - Reverse gate: a completed/dismissed deployment browsing `/setup/*` is sent
 *   back to `/`.
 *
 * Gates page navigations only — never `/api/*`, public paths, or assets, and
 * only GET requests. Gating is keyed on the dedicated `wizard_completed` /
 * `wizard_dismissed_at` flags, independent of auth mode (so it works under
 * `AUTH=off`), never on `existsLocal()`.
 *
 * @returns the redirect target, or `null` when no redirect applies.
 */
export function resolveWizardRedirect(event: RequestEvent): string | null {
  if (event.request.method !== 'GET') return null;

  const { pathname } = event.url;
  if (isGateExemptPath(pathname)) return null;

  // Reverse gate is handled inside the `/setup` layout (exempted above); here we
  // only apply the forward gate for non-`/setup` page navigations.
  if (setupStateQueries.wizardShouldRun()) {
    return '/setup';
  }

  return null;
}

/**
 * Guard for every `/api/v1/setup/*` handler. Call as the FIRST statement of the
 * handler. Throws 403 once the wizard is completed or dismissed so the setup
 * API surface locks itself down and cannot be driven after setup is finished.
 *
 * Authorization here is a setup-lifecycle check; per-request authentication is
 * enforced separately by the auth middleware in `hooks.server.ts` (API paths
 * 401 when auth is required). This guard must never be replaced by a
 * `PUBLIC_PATHS` entry.
 */
export function assertSetupInProgress(): void {
  if (!setupStateQueries.wizardShouldRun()) {
    throw error(403, 'Setup has already been completed');
  }
}
