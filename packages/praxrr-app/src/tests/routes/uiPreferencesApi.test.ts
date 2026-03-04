/// <reference path="../../app.d.ts" />

import { assertEquals } from '@std/assert';
import { userInterfacePreferencesQueries } from '$db/queries/user_interface_preferences.ts';
import { GET, PATCH } from '../../routes/api/v1/ui-preferences/+server.ts';
import type { SectionKey } from '$shared/disclosure/sectionKeys.ts';

type Restore = () => void;

interface StorePreference {
  userId: number;
  sectionKey: SectionKey;
  mode: 'basic' | 'advanced';
  updatedAt: string;
}

type PatchEvent = Parameters<typeof PATCH>[0];
type GetEvent = Parameters<typeof GET>[0];

interface RestorableRequest {
  restores: Restore[];
  restoreAll: () => void;
}

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

function withInMemoryStore(): RestorableRequest {
  const restores: Restore[] = [];
  createInMemoryPreferenceStore(restores);

  return {
    restores,
    restoreAll: () => restoreAll(restores),
  };
}

function createInMemoryPreferenceStore(restores: Restore[]): Map<string, StorePreference> {
  const store = new Map<string, StorePreference>();
  const mapKey = (userId: number, sectionKey: string): string => `${userId}:${sectionKey}`;

  patchTarget(
    userInterfacePreferencesQueries,
    'getByUserIdAndSectionKey',
    (userId, sectionKey) => store.get(mapKey(userId, sectionKey)),
    restores
  );

  patchTarget(
    userInterfacePreferencesQueries,
    'upsert',
    (input) => {
      const record: StorePreference = {
        userId: input.userId,
        sectionKey: input.sectionKey,
        mode: input.mode,
        updatedAt: new Date().toISOString(),
      };

      store.set(mapKey(input.userId, input.sectionKey), record);
      return record;
    },
    restores
  );

  return store;
}

function buildGetRequest(sectionKey: string, userId?: number): GetEvent {
  const event: Partial<GetEvent> = {
    url: new URL(`http://localhost/api/v1/ui-preferences?section_key=${encodeURIComponent(sectionKey)}`),
    locals: {
      user: null,
      session: null,
      authBypass: false,
    },
  };
  if (typeof userId === 'number') {
    event.locals = {
      user: {
        id: userId,
        username: `user-${userId}`,
        password_hash: 'hash',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      session: null,
      authBypass: false,
    };
  }

  return event as GetEvent;
}

function buildPatchRequest(
  sectionKey: string,
  mode: 'basic' | 'advanced',
  userId?: number,
  expectedUpdatedAt?: string | null
): PatchEvent {
  const body: Record<string, unknown> = {
    section_key: sectionKey,
    mode,
  };
  if (expectedUpdatedAt !== undefined) {
    body.expected_updated_at = expectedUpdatedAt;
  }
  const event: Partial<PatchEvent> = {
    request: new Request('http://localhost/api/v1/ui-preferences', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
    locals: {
      user: null,
      session: null,
      authBypass: false,
    },
  };

  if (typeof userId === 'number') {
    event.locals = {
      user: {
        id: userId,
        username: `user-${userId}`,
        password_hash: 'hash',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      session: null,
      authBypass: false,
    };
  }

  return event as PatchEvent;
}

Deno.test('unauthenticated ui preference read returns 401', async () => {
  const requestScope = withInMemoryStore();
  try {
    const response = await GET(buildGetRequest('media-management:media-settings:naming'));

    assertEquals(response.status, 401);
  } finally {
    requestScope.restoreAll();
  }
});

Deno.test('unauthenticated ui preference write returns 401', async () => {
  const requestScope = withInMemoryStore();
  try {
    const response = await PATCH(buildPatchRequest('media-management:media-settings:naming', 'advanced'));

    assertEquals(response.status, 401);
  } finally {
    requestScope.restoreAll();
  }
});

Deno.test('authenticated users can read/write their own preferences without leaking across users', async () => {
  const requestScope = withInMemoryStore();

  try {
    const userAId = 11;
    const userBId = 22;
    const sectionKey = 'media-management:media-settings:naming';

    const writeForAResponse = await PATCH(buildPatchRequest(sectionKey, 'advanced', userAId));
    const writeForABody = (await writeForAResponse.json()) as {
      mode: 'basic' | 'advanced';
      persisted: boolean;
    };
    assertEquals(writeForAResponse.status, 200);
    assertEquals(writeForABody.mode, 'advanced');
    assertEquals(writeForABody.persisted, true);

    const readForAResponse = await GET(buildGetRequest(sectionKey, userAId));
    const readForABody = (await readForAResponse.json()) as {
      mode: 'basic' | 'advanced';
      persisted: boolean;
    };
    assertEquals(readForAResponse.status, 200);
    assertEquals(readForABody.mode, 'advanced');
    assertEquals(readForABody.persisted, true);

    const readForBResponse = await GET(buildGetRequest(sectionKey, userBId));
    const readForBBody = (await readForBResponse.json()) as {
      mode: 'basic' | 'advanced';
      persisted: boolean;
    };
    assertEquals(readForBResponse.status, 200);
    assertEquals(readForBBody.mode, 'basic');
    assertEquals(readForBBody.persisted, false);

    const writeForBResponse = await PATCH(buildPatchRequest(sectionKey, 'advanced', userBId));
    assertEquals(writeForBResponse.status, 200);

    const readForAAfterBResponse = await GET(buildGetRequest(sectionKey, userAId));
    const readForAAfterBBody = (await readForAAfterBResponse.json()) as {
      mode: 'basic' | 'advanced';
    };
    assertEquals(readForAAfterBResponse.status, 200);
    assertEquals(readForAAfterBBody.mode, 'advanced');
  } finally {
    requestScope.restoreAll();
  }
});

Deno.test('similar section keys are namespace-distinct and never overwrite each other', async () => {
  const requestScope = withInMemoryStore();

  try {
    const userId = 33;
    const sectionA = 'media-management:media-settings:folder-management';
    const sectionB = 'media-management:media-settings:folder-management-extra';

    const writeResponseA = await PATCH(buildPatchRequest(sectionA, 'advanced', userId));
    const writeResponseB = await PATCH(buildPatchRequest(sectionB, 'basic', userId));
    assertEquals(writeResponseA.status, 200);
    assertEquals(writeResponseB.status, 200);

    const readAResponse = await GET(buildGetRequest(sectionA, userId));
    const readABody = (await readAResponse.json()) as { mode: 'basic' | 'advanced' };
    assertEquals(readAResponse.status, 200);
    assertEquals(readABody.mode, 'advanced');

    const readBResponse = await GET(buildGetRequest(sectionB, userId));
    const readBBody = (await readBResponse.json()) as { mode: 'basic' | 'advanced' };
    assertEquals(readBResponse.status, 200);
    assertEquals(readBBody.mode, 'basic');
  } finally {
    requestScope.restoreAll();
  }
});

Deno.test('first-visit preference defaults to basic', async () => {
  const requestScope = withInMemoryStore();

  try {
    const sectionKey = 'media-management:media-settings:importing';
    const userId = 44;

    const response = await GET(buildGetRequest(sectionKey, userId));
    const payload = (await response.json()) as {
      section_key: string;
      mode: 'basic' | 'advanced';
      persisted: boolean;
      updated_at: string | null;
    };
    assertEquals(response.status, 200);
    assertEquals(payload.section_key, sectionKey);
    assertEquals(payload.mode, 'basic');
    assertEquals(payload.persisted, false);
    assertEquals(payload.updated_at, null);
  } finally {
    requestScope.restoreAll();
  }
});

Deno.test('PATCH with expected_updated_at null when row exists is allowed (no spurious 409)', async () => {
  const requestScope = withInMemoryStore();

  try {
    const sectionKey = 'media-management:media-settings:naming';
    const userId = 99;

    // Create a row first
    const createRes = await PATCH(
      buildPatchRequest(sectionKey, 'basic', userId, undefined /* no expected_updated_at */)
    );
    assertEquals(createRes.status, 200);

    // Client sends null before hydration or after read failure; server should accept the write
    const res = await PATCH(buildPatchRequest(sectionKey, 'advanced', userId, null));
    assertEquals(res.status, 200);
    const body = (await res.json()) as { mode: 'basic' | 'advanced' };
    assertEquals(body.mode, 'advanced');
  } finally {
    requestScope.restoreAll();
  }
});

Deno.test('media-management and custom-format route families are key-isolated', async () => {
  const requestScope = withInMemoryStore();

  try {
    const userId = 55;
    const mediaKey = 'media-management:media-settings:naming';
    const customKey = 'custom-formats:general:conditions';

    const writeMediaResponse = await PATCH(buildPatchRequest(mediaKey, 'advanced', userId));
    assertEquals(writeMediaResponse.status, 200);

    const readCustomResponse = await GET(buildGetRequest(customKey, userId));
    const readCustomBody = (await readCustomResponse.json()) as { mode: 'basic' | 'advanced' };
    assertEquals(readCustomResponse.status, 200);
    assertEquals(readCustomBody.mode, 'basic');

    const writeCustomResponse = await PATCH(buildPatchRequest(customKey, 'advanced', userId));
    assertEquals(writeCustomResponse.status, 200);

    const readMediaResponse = await GET(buildGetRequest(mediaKey, userId));
    const readMediaBody = (await readMediaResponse.json()) as { mode: 'basic' | 'advanced' };
    assertEquals(readMediaResponse.status, 200);
    assertEquals(readMediaBody.mode, 'advanced');
  } finally {
    requestScope.restoreAll();
  }
});

Deno.test('invalid section keys are rejected by server validation', async () => {
  const requestScope = withInMemoryStore();

  try {
    const response = await PATCH(buildPatchRequest('invalid_section_key', 'advanced', 66));
    assertEquals(response.status, 400);
  } finally {
    requestScope.restoreAll();
  }
});

Deno.test('excessively long section keys are rejected by server validation', async () => {
  const requestScope = withInMemoryStore();

  try {
    const longSegment = 'a'.repeat(50);
    const longSectionKey = `x:${longSegment}:${longSegment}`;

    const response = await PATCH(buildPatchRequest(longSectionKey, 'advanced', 77));
    assertEquals(response.status, 400);
  } finally {
    requestScope.restoreAll();
  }
});

Deno.test('newly introduced rollout keys accept valid read/write cycles', async () => {
  const requestScope = withInMemoryStore();

  try {
    const userId = 100;
    const rolloutKeys = [
      'regular-expressions:general:metadata',
      'metadata-profiles:general:type-selection',
      'arr:upgrades:filter-settings',
    ];

    for (const key of rolloutKeys) {
      // Default read returns basic
      const readDefault = await GET(buildGetRequest(key, userId));
      const readDefaultBody = (await readDefault.json()) as { mode: 'basic' | 'advanced'; persisted: boolean };
      assertEquals(readDefault.status, 200);
      assertEquals(readDefaultBody.mode, 'basic');
      assertEquals(readDefaultBody.persisted, false);

      // Write advanced
      const writeRes = await PATCH(buildPatchRequest(key, 'advanced', userId));
      assertEquals(writeRes.status, 200);

      // Read back advanced
      const readBack = await GET(buildGetRequest(key, userId));
      const readBackBody = (await readBack.json()) as { mode: 'basic' | 'advanced'; persisted: boolean };
      assertEquals(readBack.status, 200);
      assertEquals(readBackBody.mode, 'advanced');
      assertEquals(readBackBody.persisted, true);

      // Write basic
      const resetRes = await PATCH(buildPatchRequest(key, 'basic', userId));
      assertEquals(resetRes.status, 200);

      // Read back basic
      const readReset = await GET(buildGetRequest(key, userId));
      const readResetBody = (await readReset.json()) as { mode: 'basic' | 'advanced' };
      assertEquals(readReset.status, 200);
      assertEquals(readResetBody.mode, 'basic');
    }
  } finally {
    requestScope.restoreAll();
  }
});

Deno.test('rollout keys are isolated from each other', async () => {
  const requestScope = withInMemoryStore();

  try {
    const userId = 101;
    const regexKey = 'regular-expressions:general:metadata';
    const metadataKey = 'metadata-profiles:general:type-selection';

    await PATCH(buildPatchRequest(regexKey, 'advanced', userId));

    const readMetadata = await GET(buildGetRequest(metadataKey, userId));
    const metadataBody = (await readMetadata.json()) as { mode: 'basic' | 'advanced' };
    assertEquals(readMetadata.status, 200);
    assertEquals(metadataBody.mode, 'basic');
  } finally {
    requestScope.restoreAll();
  }
});

Deno.test('ui preference writes are rate limited per user and section', async () => {
  const requestScope = withInMemoryStore();

  try {
    const sectionKey = 'media-management:media-settings:importing';
    const userId = 88;
    for (let i = 0; i < 8; i += 1) {
      const response = await PATCH(buildPatchRequest(sectionKey, i % 2 === 0 ? 'advanced' : 'basic', userId));
      assertEquals(response.status, 200);
    }

    const blockedResponse = await PATCH(buildPatchRequest(sectionKey, 'advanced', userId));
    assertEquals(blockedResponse.status, 429);
  } finally {
    requestScope.restoreAll();
  }
});
