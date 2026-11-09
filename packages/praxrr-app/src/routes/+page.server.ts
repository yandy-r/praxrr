import type { ServerLoad } from '@sveltejs/kit';
import { buildHomeDashboard } from '$lib/server/dashboard/index.ts';

/**
 * Home dashboard (YAN-589). `buildHomeDashboard` isolates each data source and never throws, so
 * `/` always renders — failed sources degrade to empty/null sections.
 */
export const load: ServerLoad = async (event) => {
  // Lets the client re-run this load via `invalidate('app:home-dashboard')`.
  event.depends('app:home-dashboard');
  return { dashboard: await buildHomeDashboard(event) };
};
