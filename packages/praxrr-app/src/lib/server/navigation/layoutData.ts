import type { User } from '$db/queries/users.ts';
import type { NavShell } from '$shared/navigation/types.ts';
import { resolveNavShell } from './resolver.ts';

export interface RootLayoutData {
  version: string;
  navShell?: NavShell;
}

interface ResolveRootLayoutDataInput {
  version: string;
  pathname: string;
  user: User | null;
  authBypass: boolean;
}

/**
 * Resolves the root layout data for the current request, including the navigation shell
 * when the user is authenticated (or auth is bypassed) and the path is not an auth route.
 *
 * @param input - Request context including version, pathname, user, and auth bypass flag
 * @returns Root layout data with optional navigation shell
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
    navShell: resolveNavShell({ user: resolvedUser }),
  };
}
