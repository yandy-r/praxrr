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
