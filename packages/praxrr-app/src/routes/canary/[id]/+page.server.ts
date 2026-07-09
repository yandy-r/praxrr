import { error } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';
import { canaryRolloutQueries } from '$db/queries/canaryRollouts.ts';
import { syncHistoryQueries } from '$db/queries/syncHistory.ts';

/**
 * Canary rollout detail load (issue #19).
 *
 * Server-loads the rollout state-machine row (`canaryRolloutQueries.getById`) and, when the
 * canary recorded a `sync_history` audit row, its full diagnostics — decoded section results
 * plus the captured entity diff — via `syncHistoryQueries.getById`. Both are read server-side
 * so the verification gate re-renders authoritative state after `invalidateAll()` on
 * proceed/abort. An invalid id resolves to 400 and an unknown rollout to 404, mirroring the
 * server-loading detail routes (`quality-profiles/[databaseId]`).
 */
export const load: ServerLoad = ({ params }) => {
  const raw = params.id;

  // Strict digits-only: reject leading-numeric junk like "1e5"/"1abc"/" 1" outright.
  if (!raw || !/^\d+$/.test(raw)) {
    throw error(400, 'Invalid canary rollout id');
  }

  const rollout = canaryRolloutQueries.getById(Number.parseInt(raw, 10));
  if (!rollout) {
    throw error(404, 'Canary rollout not found');
  }

  const diagnostics =
    rollout.canarySyncHistoryId !== null ? (syncHistoryQueries.getById(rollout.canarySyncHistoryId) ?? null) : null;

  return { rollout, diagnostics };
};
