import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { setupStateQueries } from '$db/queries/setupState.ts';
import { getSetupProgress } from '$server/setup/progress.ts';

/**
 * Reverse gate for the wizard: once setup is completed or dismissed, `/setup/*`
 * is off-limits and sends the user back to `/`. The forward gate (first-run
 * deployments getting routed *into* `/setup`) lives in `hooks.server.ts` via
 * `resolveWizardRedirect`.
 */
export const load: LayoutServerLoad = () => {
  const wizard = setupStateQueries.getWizardState();

  if (wizard.completed || wizard.dismissedAt !== null) {
    throw redirect(303, '/');
  }

  return { wizard, progress: getSetupProgress() };
};
