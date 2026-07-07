import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { setupStateQueries } from '$db/queries/setupState.ts';

/**
 * POST /api/v1/setup/skip
 *
 * Marks the setup wizard dismissed. Terminal and idempotent by design: unlike
 * `GET`/`PATCH /state`, this deliberately skips `assertSetupInProgress()` so a
 * repeat call (e.g. a retried request) succeeds instead of 403ing once the
 * wizard is already dismissed.
 */
export const POST: RequestHandler = async () => {
  setupStateQueries.markWizardDismissed();
  return json({ wizard: setupStateQueries.getWizardState() });
};
