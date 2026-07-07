import { assertEquals } from '@std/assert';
import { GET as stateGET, PATCH as statePATCH } from '../../routes/api/v1/setup/state/+server.ts';
import { POST as completePost } from '../../routes/api/v1/setup/complete/+server.ts';
import { POST as skipPost } from '../../routes/api/v1/setup/skip/+server.ts';
import { POST as testConnectionPost } from '../../routes/api/v1/setup/test-connection/+server.ts';
import { setupStateQueries, type WizardStep } from '$db/queries/setupState.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { DEFAULT_RATE_LIMIT_MAX_REQUESTS, resetRateLimitForTests } from '$utils/rateLimit.ts';
import { BaseArrClient } from '$arr/base.ts';

type Restore = () => void;

interface FakeWizardState {
  completed: boolean;
  dismissedAt: string | null;
  currentStep: WizardStep;
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
    ...overrides,
  };

  patchTarget(setupStateQueries, 'getWizardState', () => ({ ...state }), restores);
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
      async () => ({ appName: 'Radarr', version: '5.10.0' }),
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
