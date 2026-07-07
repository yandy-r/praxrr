import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { setupStateQueries, type WizardStep } from '$db/queries/setupState.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { assertSetupInProgress, getSetupProgress } from '$server/setup/progress.ts';
import { resolveDefaultDatabaseConfig } from '$server/setup/defaultDatabase.ts';

type ErrorResponse = {
  error: string;
};

type PatchStateBody = {
  currentStep: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * GET /api/v1/setup/state
 *
 * Wizard state, prerequisite progress, and default database auto-link info,
 * used by the setup wizard to render step progress and resume position.
 */
export const GET: RequestHandler = async () => {
  assertSetupInProgress();

  const defaultDatabaseConfig = resolveDefaultDatabaseConfig();

  return json({
    wizard: setupStateQueries.getWizardState(),
    prerequisites: getSetupProgress(),
    defaultDatabase: {
      configured: defaultDatabaseConfig.configured,
      url: defaultDatabaseConfig.url,
      alreadyLinked: databaseInstancesQueries.getAll().length > 0,
    },
  });
};

/**
 * PATCH /api/v1/setup/state
 *
 * Advance the wizard to a given step.
 *
 * Body:
 * - currentStep: target wizard step (required)
 */
export const PATCH: RequestHandler = async ({ request }) => {
  assertSetupInProgress();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' } satisfies ErrorResponse, { status: 400 });
  }

  const currentStep = isRecord(body) ? (body as PatchStateBody).currentStep : undefined;
  if (typeof currentStep !== 'string') {
    return json({ error: `Invalid step: ${String(currentStep)}` } satisfies ErrorResponse, { status: 400 });
  }

  try {
    setupStateQueries.setWizardStep(currentStep as WizardStep);
  } catch {
    return json({ error: `Invalid step: ${currentStep}` } satisfies ErrorResponse, { status: 400 });
  }

  return json({ wizard: setupStateQueries.getWizardState() });
};
