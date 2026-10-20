import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { setupStateQueries } from '$db/queries/setupState.ts';

/**
 * POST /api/v1/setup/checklist/dismiss
 *
 * Permanently hides the post-skip "Finish setup" checklist. Idempotent: the
 * first dismissal timestamp is kept on repeat calls. Like `/skip` and
 * `/complete`, it skips `assertSetupInProgress()` because the checklist only
 * exists once the wizard is no longer running.
 */
export const POST: RequestHandler = async () => {
  setupStateQueries.markChecklistDismissed();
  return json({ checklistDismissed: setupStateQueries.isChecklistDismissed() });
};
