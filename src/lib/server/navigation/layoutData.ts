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
  if ((!user && !authBypass) || pathname.startsWith('/auth/')) {
    return { version };
  }

  return {
    version,
    navShell: resolveNavShell({ user }),
  };
}
