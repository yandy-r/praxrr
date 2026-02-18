import type { LayoutServerLoad } from './$types';
import { appInfoQueries } from '$db/queries/appInfo.ts';
import { resolveRootLayoutData } from '$lib/server/navigation/layoutData.ts';
import type { User } from '$db/queries/users.ts';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  const typedLocals = locals as {
    user: User | null;
    authBypass: boolean;
  };

  return resolveRootLayoutData({
    version: appInfoQueries.getVersion(),
    pathname: url.pathname,
    user: typedLocals.user,
    authBypass: typedLocals.authBypass,
  });
};
