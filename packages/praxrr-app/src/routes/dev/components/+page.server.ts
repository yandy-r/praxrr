import { redirect } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';

export const load: ServerLoad = async () => {
  if (import.meta.env.VITE_CHANNEL !== 'dev') {
    throw redirect(302, '/');
  }
};
