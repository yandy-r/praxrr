import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { setupStateQueries } from '$db/queries/setupState.ts';
import { createArrInstanceFromForm } from '$arr/createInstanceAction.ts';

// Returning here so an env-reconciled instance from startup shows as already
// connected instead of asking the user to add a duplicate.
export const load: PageServerLoad = () => {
  return { instances: arrInstancesQueries.getAll() };
};

export const actions = {
  default: async ({ request }) => {
    const formData = await request.formData();
    const result = await createArrInstanceFromForm(formData, { source: 'setup/connect-arr' });

    if (!result.ok) {
      return result.failure;
    }

    // Advance the wizard instead of arr/new's redirect to the instance's own
    // settings page (outside try-catch since redirect throws).
    setupStateQueries.setWizardStep('link-database');
    redirect(303, '/setup/link-database');
  },
} satisfies Actions;
