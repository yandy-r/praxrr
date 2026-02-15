import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
  const { database } = await parent();

  // Dev databases go to changes, others go to commits
  if (database.personal_access_token) {
    redirect(302, `/databases/${params.id}/changes`);
  } else {
    redirect(302, `/databases/${params.id}/commits`);
  }
};
