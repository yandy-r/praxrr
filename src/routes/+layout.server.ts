import type { LayoutServerLoad } from './$types';
import { appInfoQueries } from '$db/queries/appInfo.ts';
import { resolveNavShell } from '$lib/server/navigation/resolver.ts';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  const version = appInfoQueries.getVersion();

  if (!locals.user || url.pathname.startsWith('/auth/')) {
    return {
      version,
    };
  }

  return {
    version,
    navShell: resolveNavShell({ user: locals.user }),
  };
};
