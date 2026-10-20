import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { setupStateQueries } from '$db/queries/setupState.ts';
import { getSetupProgress, resolveResumeStep } from '$server/setup/progress.ts';

/**
 * POST /api/v1/setup/resume
 *
 * Reopens the setup wizard after it was skipped (or completed): clears the
 * dismissal, completion, and checklist-dismissal flags and points the wizard
 * at the first step whose prerequisite is still unmet. The client then
 * navigates to `/setup`, which redirects to that step.
 *
 * Deliberately skips `assertSetupInProgress()`: this endpoint exists precisely
 * to restart a wizard that is no longer running, and it is idempotent — a
 * repeat call recomputes the same step from the same entity state.
 */
export const POST: RequestHandler = async () => {
  const progress = getSetupProgress();
  setupStateQueries.reopenWizard(resolveResumeStep(progress));
  return json({ wizard: setupStateQueries.getWizardState(), progress });
};
