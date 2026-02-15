import type { LayoutServerLoad } from './$types';
import { appInfoQueries } from '$db/queries/appInfo.ts';

export const load: LayoutServerLoad = async () => {
  return {
    version: appInfoQueries.getVersion(),
  };
};
