import type { User } from '$db/queries/users.ts';
import type { NavShell } from '$shared/navigation/types.ts';
import { resolveSetupChecklist, type SetupChecklist } from '$server/setup/progress.ts';
import { attachNavBadges } from './badges.ts';
import { resolveNavShell } from './resolver.ts';

/** Root layout payload without the app shell (auth pages, unauthenticated requests). */
interface ShellLessLayoutData {
  version: string;
  navShell?: undefined;
  setupChecklist?: undefined;
  recentsBackend?: undefined;
}

/** Root layout payload for an authenticated user or a bypass session: shell fields come together. */
interface ShellLayoutData {
  version: string;
  navShell: NavShell;
  setupChecklist: SetupChecklist | null;
  /**
   * Where the command palette keeps recents: `api` for a real signed-in user (id > 0), `local`
   * (`localStorage`) for auth-bypass sessions, which the per-user recents API rejects.
   */
  recentsBackend: 'api' | 'local';
}

export type RootLayoutData = ShellLessLayoutData | ShellLayoutData;

interface ResolveRootLayoutDataInput {
  version: string;
  pathname: string;
  user: User | null;
  authBypass: boolean;
}

/**
 * Build data for the root layout, including resolved navigation shell and the
 * post-skip "Finish setup" checklist (only alongside the nav shell).
 *
 * @param input - Input including version, path, auth context, and user.
 * @returns The layout payload consumed by the root layout data hook.
 */
export function resolveRootLayoutData({
  version,
  pathname,
  user,
  authBypass,
}: ResolveRootLayoutDataInput): RootLayoutData {
  const resolvedUser: User | null =
    user ??
    (authBypass
      ? {
          id: 0,
          username: 'auth-bypass',
          password_hash: '',
          created_at: '',
          updated_at: '',
        }
      : null);

  if ((!resolvedUser && !authBypass) || pathname.startsWith('/auth/')) {
    return { version };
  }

  return {
    version,
    navShell: attachNavBadges(resolveNavShell({ user: resolvedUser })),
    setupChecklist: resolveSetupChecklist(pathname),
    recentsBackend: user && user.id > 0 ? 'api' : 'local',
  };
}
