import { redirect } from '@sveltejs/kit';
import type { Actions, ServerLoad } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { setupStateQueries } from '$db/queries/setupState.ts';
import { createArrInstanceFromForm } from '$arr/createInstanceAction.ts';
import type { User } from '$db/queries/users.ts';
import { loadSectionModes } from '$lib/server/disclosure/loadSectionModes.ts';
import { ARR_CONNECTION_DETAILS } from '$shared/disclosure/sectionKeys.ts';

// Returning `instances` here so an env-reconciled instance from startup shows as
// already connected instead of asking the user to add a duplicate.
// `arrSettingsSectionModes` is required by the shared InstanceForm.
export const load: ServerLoad = ({ locals }) => {
  // `deno test` type-checks without SvelteKit's App.Locals augmentation; narrow
  // the same way the root layout does.
  const { user } = locals as { user: User | null };
  return {
    instances: arrInstancesQueries.getAll(),
    arrSettingsSectionModes: loadSectionModes(user?.id, [ARR_CONNECTION_DETAILS]),
  };
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
