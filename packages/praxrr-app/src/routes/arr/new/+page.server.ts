import { redirect } from '@sveltejs/kit';
import type { Actions } from '@sveltejs/kit';
import { createArrInstanceFromForm } from '$arr/createInstanceAction.ts';

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
