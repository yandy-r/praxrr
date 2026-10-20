import { assertEquals } from '@std/assert';
import { GET as stateGET, PATCH as statePATCH } from '../../routes/api/v1/setup/state/+server.ts';
import { POST as completePost } from '../../routes/api/v1/setup/complete/+server.ts';
import { POST as skipPost } from '../../routes/api/v1/setup/skip/+server.ts';
import { POST as resumePost } from '../../routes/api/v1/setup/resume/+server.ts';
import { POST as checklistDismissPost } from '../../routes/api/v1/setup/checklist/dismiss/+server.ts';
import { POST as testConnectionPost } from '../../routes/api/v1/setup/test-connection/+server.ts';
import { setupStateQueries, type WizardStep } from '$db/queries/setupState.ts';
import { arrInstancesQueries, type ArrInstance } from '$db/queries/arrInstances.ts';
import { databaseInstancesQueries, type DatabaseInstance } from '$db/queries/databaseInstances.ts';
import { arrSyncQueries, type QualityProfilesSyncData } from '$db/queries/arrSync.ts';
import type { SetupProgress } from '$server/setup/progress.ts';
import { DEFAULT_RATE_LIMIT_MAX_REQUESTS, resetRateLimitForTests } from '$utils/rateLimit.ts';
import { BaseArrClient } from '$arr/base.ts';

type Restore = () => void;

interface FakeWizardState {
  completed: boolean;
  dismissedAt: string | null;
  currentStep: WizardStep;
  checklistDismissedAt: string | null;
}

const WIZARD_STEPS: WizardStep[] = [
  'welcome',
  'connect-arr',
  'link-database',
  'select-profiles',
  'preview-sync',
  'done',
];

function patchTarget<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
  restores: Restore[]
): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

function restoreAll(restores: Restore[]): void {
  for (const restore of restores.reverse()) {
    restore();
  }
}

/**
 * Replace `setupStateQueries` with an in-memory model so these route tests
 * never need a real database. Mirrors the shape/behavior of the real queries,
 * including throwing on an invalid step.
 */
function installFakeSetupState(restores: Restore[], overrides: Partial<FakeWizardState> = {}): FakeWizardState {
  const state: FakeWizardState = {
    completed: false,
    dismissedAt: null,
    currentStep: 'welcome',
    checklistDismissedAt: null,
    ...overrides,
  };

  patchTarget(
    setupStateQueries,
    'getWizardState',
    () => ({ completed: state.completed, dismissedAt: state.dismissedAt, currentStep: state.currentStep }),
    restores
  );
  patchTarget(setupStateQueries, 'wizardShouldRun', () => !state.completed && state.dismissedAt === null, restores);
  patchTarget(
    setupStateQueries,
    'setWizardStep',
    (step: WizardStep) => {
      if (!WIZARD_STEPS.includes(step)) {
        throw new Error(`Invalid wizard step: ${step}`);
      }
      state.currentStep = step;
      return true;
    },
    restores
  );
  patchTarget(
    setupStateQueries,
    'markWizardCompleted',
    () => {
      state.completed = true;
      return true;
    },
    restores
  );
  patchTarget(
    setupStateQueries,
    'markWizardDismissed',
    () => {
      state.dismissedAt = new Date().toISOString();
      return true;
    },
    restores
  );
  patchTarget(
    setupStateQueries,
    'reopenWizard',
    (step: WizardStep) => {
      if (!WIZARD_STEPS.includes(step)) {
        throw new Error(`Invalid wizard step: ${step}`);
      }
      state.completed = false;
      state.dismissedAt = null;
      state.checklistDismissedAt = null;
      state.currentStep = step;
      return true;
    },
    restores
  );
  patchTarget(setupStateQueries, 'isChecklistDismissed', () => state.checklistDismissedAt !== null, restores);
  patchTarget(
    setupStateQueries,
    'markChecklistDismissed',
    () => {
      state.checklistDismissedAt ??= new Date().toISOString();
      return true;
    },
    restores
  );

  return state;
}

function withDefaultDatabaseUrl(url: string | undefined, restores: Restore[]): void {
  const original = Deno.env.get('PRAXRR_DEFAULT_DB_URL');
  if (url === undefined) {
    Deno.env.delete('PRAXRR_DEFAULT_DB_URL');
  } else {
    Deno.env.set('PRAXRR_DEFAULT_DB_URL', url);
  }
  restores.push(() => {
    if (original === undefined) {
      Deno.env.delete('PRAXRR_DEFAULT_DB_URL');
    } else {
      Deno.env.set('PRAXRR_DEFAULT_DB_URL', original);
    }
  });
}

function buildPatchRequest(body: unknown): Parameters<typeof statePATCH>[0] {
  return {
    request: new Request('http://localhost/api/v1/setup/state', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as Parameters<typeof statePATCH>[0];
}

function buildTestConnectionRequest(body: unknown, clientAddress: string): Parameters<typeof testConnectionPost>[0] {
  return {
    request: new Request('http://localhost/api/v1/setup/test-connection', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    getClientAddress: () => clientAddress,
  } as unknown as Parameters<typeof testConnectionPost>[0];
}

Deno.test('GET /api/v1/setup/state returns wizard, prerequisites, and default database info', async () => {
  const restores: Restore[] = [];
  installFakeSetupState(restores, { currentStep: 'connect-arr' });
  patchTarget(arrInstancesQueries, 'getAll', () => [], restores);
  patchTarget(databaseInstancesQueries, 'getAll', () => [], restores);
  withDefaultDatabaseUrl('https://example.com/pcd.git', restores);

  try {
    const response = await stateGET({} as Parameters<typeof stateGET>[0]);
    assertEquals(response.status, 200);
    assertEquals(response.headers.get('Access-Control-Allow-Origin'), null);

    const body = (await response.json()) as {
      wizard: { currentStep: WizardStep };
      prerequisites: { hasArrInstance: boolean; hasDatabase: boolean; hasProfileSelections: boolean };
      defaultDatabase: { configured: boolean; url: string | null; alreadyLinked: boolean };
    };
    assertEquals(body.wizard.currentStep, 'connect-arr');
    assertEquals(body.prerequisites, {
      hasArrInstance: false,
      hasDatabase: false,
      hasProfileSelections: false,
    });
    assertEquals(body.defaultDatabase, {
      configured: true,
      url: 'https://example.com/pcd.git',
      alreadyLinked: false,
    });
  } finally {
    restoreAll(restores);
  }
});

Deno.test('PATCH /api/v1/setup/state rejects an invalid step with 400', async () => {
  const restores: Restore[] = [];
  installFakeSetupState(restores);

  try {
    const response = await statePATCH(buildPatchRequest({ currentStep: 'not-a-step' }));
    assertEquals(response.status, 400);
  } finally {
    restoreAll(restores);
  }
});

Deno.test('PATCH /api/v1/setup/state advances the wizard to a valid step', async () => {
  const restores: Restore[] = [];
  const state = installFakeSetupState(restores);

  try {
    const response = await statePATCH(buildPatchRequest({ currentStep: 'link-database' }));
    assertEquals(response.status, 200);

    const body = (await response.json()) as { wizard: { currentStep: WizardStep } };
    assertEquals(body.wizard.currentStep, 'link-database');
    assertEquals(state.currentStep, 'link-database');
  } finally {
    restoreAll(restores);
  }
});

Deno.test('POST /api/v1/setup/complete marks the wizard completed and is idempotent', async () => {
  const restores: Restore[] = [];
  installFakeSetupState(restores);

  try {
    const first = await completePost({} as Parameters<typeof completePost>[0]);
    assertEquals(first.status, 200);

    const second = await completePost({} as Parameters<typeof completePost>[0]);
    assertEquals(second.status, 200);

    const body = (await second.json()) as { wizard: { completed: boolean } };
    assertEquals(body.wizard.completed, true);
  } finally {
    restoreAll(restores);
  }
});

Deno.test('POST /api/v1/setup/skip marks the wizard dismissed and is idempotent', async () => {
  const restores: Restore[] = [];
  installFakeSetupState(restores);

  try {
    const first = await skipPost({} as Parameters<typeof skipPost>[0]);
    assertEquals(first.status, 200);

    const second = await skipPost({} as Parameters<typeof skipPost>[0]);
    assertEquals(second.status, 200);

    const body = (await second.json()) as { wizard: { dismissedAt: string | null } };
    assertEquals(typeof body.wizard.dismissedAt, 'string');
  } finally {
    restoreAll(restores);
  }
});

/**
 * Stub the entity queries behind `getSetupProgress()` so each resume test can
 * pick which prerequisites are met without a real database.
 */
function installFakeProgress(restores: Restore[], progress: SetupProgress): void {
  // Only `id` is read by getSetupProgress/resolvePrimaryInstance; the rest of
  // the row shape is irrelevant to these tests.
  const instances = (progress.hasArrInstance ? [{ id: 7 }] : []) as unknown as ArrInstance[];
  const databases = (progress.hasDatabase ? [{ id: 1 }] : []) as unknown as DatabaseInstance[];
  const profileSync = {
    selections: progress.hasProfileSelections ? [{ databaseId: 1, profileName: 'HD' }] : [],
  } as unknown as QualityProfilesSyncData;
  patchTarget(arrInstancesQueries, 'getAll', () => instances, restores);
  patchTarget(databaseInstancesQueries, 'getAll', () => databases, restores);
  patchTarget(arrSyncQueries, 'getQualityProfilesSync', () => profileSync, restores);
}

const RESUME_CASES: { progress: SetupProgress; step: WizardStep }[] = [
  { progress: { hasArrInstance: false, hasDatabase: false, hasProfileSelections: false }, step: 'connect-arr' },
  { progress: { hasArrInstance: false, hasDatabase: true, hasProfileSelections: false }, step: 'connect-arr' },
  { progress: { hasArrInstance: true, hasDatabase: false, hasProfileSelections: false }, step: 'link-database' },
  { progress: { hasArrInstance: true, hasDatabase: true, hasProfileSelections: false }, step: 'select-profiles' },
  { progress: { hasArrInstance: true, hasDatabase: true, hasProfileSelections: true }, step: 'preview-sync' },
];

for (const { progress, step } of RESUME_CASES) {
  Deno.test(`POST /api/v1/setup/resume after skip lands on ${step} for ${JSON.stringify(progress)}`, async () => {
    const restores: Restore[] = [];
    const state = installFakeSetupState(restores, {
      dismissedAt: '2026-10-01T00:00:00.000Z',
      checklistDismissedAt: '2026-10-02T00:00:00.000Z',
      currentStep: 'welcome',
    });
    installFakeProgress(restores, progress);

    try {
      const response = await resumePost({} as Parameters<typeof resumePost>[0]);
      assertEquals(response.status, 200);
      assertEquals(await response.json(), {
        wizard: { completed: false, dismissedAt: null, currentStep: step },
        progress,
      });
      assertEquals(state.checklistDismissedAt, null);
      assertEquals(setupStateQueries.wizardShouldRun(), true);
    } finally {
      restoreAll(restores);
    }
  });
}

Deno.test('POST /api/v1/setup/resume is idempotent: repeat calls return 200 and the same state', async () => {
  const restores: Restore[] = [];
  installFakeSetupState(restores, { dismissedAt: '2026-10-01T00:00:00.000Z' });
  installFakeProgress(restores, { hasArrInstance: true, hasDatabase: false, hasProfileSelections: false });

  try {
    const first = await resumePost({} as Parameters<typeof resumePost>[0]);
    const second = await resumePost({} as Parameters<typeof resumePost>[0]);
    assertEquals(first.status, 200);
    assertEquals(second.status, 200);

    const firstBody: unknown = await first.json();
    assertEquals(await second.json(), firstBody);
    assertEquals(firstBody, {
      wizard: { completed: false, dismissedAt: null, currentStep: 'link-database' },
      progress: { hasArrInstance: true, hasDatabase: false, hasProfileSelections: false },
    });
  } finally {
    restoreAll(restores);
  }
});

Deno.test('POST /api/v1/setup/resume reopens a completed wizard', async () => {
  const restores: Restore[] = [];
  const state = installFakeSetupState(restores, { completed: true, currentStep: 'done' });
  installFakeProgress(restores, { hasArrInstance: true, hasDatabase: true, hasProfileSelections: true });

  try {
    const response = await resumePost({} as Parameters<typeof resumePost>[0]);
    assertEquals(response.status, 200);
    assertEquals(state.completed, false);
    assertEquals(state.currentStep, 'preview-sync');
    assertEquals(setupStateQueries.wizardShouldRun(), true);
  } finally {
    restoreAll(restores);
  }
});

Deno.test('POST /api/v1/setup/checklist/dismiss is idempotent', async () => {
  const restores: Restore[] = [];
  installFakeSetupState(restores, { dismissedAt: '2026-10-01T00:00:00.000Z' });

  try {
    for (let call = 0; call < 2; call += 1) {
      const response = await checklistDismissPost({} as Parameters<typeof checklistDismissPost>[0]);
      assertEquals(response.status, 200);
      assertEquals(await response.json(), { checklistDismissed: true });
    }
  } finally {
    restoreAll(restores);
  }
});

Deno.test('POST /api/v1/setup/test-connection rejects an unsupported arr type with 400', async () => {
  const restores: Restore[] = [];
  installFakeSetupState(restores);
  resetRateLimitForTests();

  try {
    const response = await testConnectionPost(
      buildTestConnectionRequest(
        { type: 'unsupported-app', url: 'http://radarr.local:7878', apiKey: 'key' },
        '198.51.100.10'
      )
    );
    assertEquals(response.status, 400);
    assertEquals(await response.json(), { success: false, reason: 'invalid_response' });
  } finally {
    restoreAll(restores);
    resetRateLimitForTests();
  }
});

Deno.test('POST /api/v1/setup/test-connection rejects SSRF/metadata URLs with a sanitized reason', async () => {
  const restores: Restore[] = [];
  installFakeSetupState(restores);
  resetRateLimitForTests();

  try {
    const response = await testConnectionPost(
      buildTestConnectionRequest({ type: 'radarr', url: 'http://169.254.169.254', apiKey: 'key' }, '198.51.100.11')
    );
    assertEquals(response.status, 400);
    assertEquals(response.headers.get('Access-Control-Allow-Origin'), null);

    const body = (await response.json()) as { success: boolean; reason: string };
    assertEquals(body, { success: false, reason: 'unreachable' });
  } finally {
    restoreAll(restores);
    resetRateLimitForTests();
  }
});

Deno.test('POST /api/v1/setup/test-connection rate-limits repeated attempts per client IP', async () => {
  const restores: Restore[] = [];
  installFakeSetupState(restores);
  resetRateLimitForTests();

  const clientIp = '198.51.100.12';
  // Invalid body is enough here: the rate-limit check runs before body
  // validation, so it doesn't matter that every attempt would 400 anyway.
  const invalidBody = { type: 'unsupported-app', url: 'http://example.com', apiKey: 'key' };

  try {
    for (let attempt = 0; attempt < DEFAULT_RATE_LIMIT_MAX_REQUESTS; attempt += 1) {
      const response = await testConnectionPost(buildTestConnectionRequest(invalidBody, clientIp));
      assertEquals(response.status, 400);
    }

    const blocked = await testConnectionPost(buildTestConnectionRequest(invalidBody, clientIp));
    assertEquals(blocked.status, 429);
    assertEquals(await blocked.json(), { success: false, reason: 'rate_limited' });
  } finally {
    restoreAll(restores);
    resetRateLimitForTests();
  }
});

Deno.test(
  'POST /api/v1/setup/test-connection returns app name/version on success without a real network call',
  async () => {
    const restores: Restore[] = [];
    installFakeSetupState(restores);
    resetRateLimitForTests();
    patchTarget(
      BaseArrClient.prototype,
      'getSystemStatus',
      async () => ({ ok: true, appName: 'Radarr', version: '5.10.0' }),
      restores
    );

    try {
      const response = await testConnectionPost(
        buildTestConnectionRequest(
          { type: 'radarr', url: 'http://10.0.0.5:7878', apiKey: 'valid-key' },
          '198.51.100.13'
        )
      );
      assertEquals(response.status, 200);
      assertEquals(await response.json(), { success: true, appName: 'Radarr', version: '5.10.0' });
    } finally {
      restoreAll(restores);
      resetRateLimitForTests();
    }
  }
);

Deno.test('POST /api/v1/setup/test-connection maps a 401 status to an unauthorized reason', async () => {
  const restores: Restore[] = [];
  installFakeSetupState(restores);
  resetRateLimitForTests();
  patchTarget(BaseArrClient.prototype, 'getSystemStatus', async () => ({ ok: false, status: 401 }), restores);

  try {
    const response = await testConnectionPost(
      buildTestConnectionRequest(
        { type: 'radarr', url: 'http://10.0.0.5:7878', apiKey: 'invalid-key' },
        '198.51.100.14'
      )
    );
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { success: false, reason: 'unauthorized' });
  } finally {
    restoreAll(restores);
    resetRateLimitForTests();
  }
});
