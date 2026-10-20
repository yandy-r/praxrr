import { redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import { createArrInstanceFromForm } from '$arr/createInstanceAction.ts';
import type { User } from '$db/queries/users.ts';
import { loadSectionModes } from '$lib/server/disclosure/loadSectionModes.ts';
import { ARR_CONNECTION_DETAILS } from '$shared/disclosure/sectionKeys.ts';

// The shared InstanceForm requires `arrSettingsSectionModes` in create mode too.
export const load: ServerLoad = ({ locals }) => {
  // `deno test` type-checks without SvelteKit's App.Locals augmentation; narrow
  // the same way the root layout does.
  const { user } = locals as { user: User | null };
  return {
    arrSettingsSectionModes: loadSectionModes(user?.id, [ARR_CONNECTION_DETAILS]),
  };
};

export const actions = {
  default: async ({ request }) => {
    const formData = await request.formData();
    const result = await createArrInstanceFromForm(formData, { source: 'arr/new' });

    if (!result.ok) {
      return result.failure;
    }

    // Redirect to the new instance page (outside try-catch since redirect throws)
    redirect(303, `/arr/${result.id}/settings`);
  },
} satisfies Actions;
