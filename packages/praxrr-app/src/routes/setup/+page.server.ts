import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { setupStateQueries } from '$db/queries/setupState.ts';

// Resume the wizard at its current step. Never rendered directly.
export const load: PageServerLoad = () => {
  const { currentStep } = setupStateQueries.getWizardState();
  throw redirect(303, `/setup/${currentStep}`);
};
