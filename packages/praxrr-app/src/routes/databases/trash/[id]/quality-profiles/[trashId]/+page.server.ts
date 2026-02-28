import { redirect } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';

export const load: ServerLoad = ({ params }) => {
  redirect(302, `/databases/trash/${params.id}/quality-profiles/${params.trashId}/general`);
};
