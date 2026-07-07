import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { setupStateQueries } from '$db/queries/setupState.ts';

/**
 * POST /api/v1/setup/complete
 *
 * Marks the setup wizard completed. Terminal and idempotent by design: unlike
 * `GET`/`PATCH /state`, this deliberately skips `assertSetupInProgress()` so a
 * repeat call (e.g. a retried request) succeeds instead of 403ing once the
 * wizard is already completed.
 */
export const POST: RequestHandler = async () => {
  setupStateQueries.markWizardCompleted();
  return json({ wizard: setupStateQueries.getWizardState() });
};
