import { redirect } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';

export const load: ServerLoad = ({ params }) => {
  // Redirect to the sync tab by default
  redirect(302, `/arr/${params.id}/sync`);
};
