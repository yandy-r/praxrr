import type { LayoutServerLoad } from './$types';
import { appInfoQueries } from '$db/queries/appInfo.ts';
import { resolveRootLayoutData } from '$lib/server/navigation/layoutData.ts';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  return resolveRootLayoutData({
    version: appInfoQueries.getVersion(),
    pathname: url.pathname,
    user: locals.user,
    authBypass: locals.authBypass,
  });
};
