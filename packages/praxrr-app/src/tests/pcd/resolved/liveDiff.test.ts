import { assert, assertEquals } from '@std/assert';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { logger } from '$logger/logger.ts';
import type { GeneratePreviewResult } from '$sync/preview/orchestrator.ts';
import type { EntityChange } from '$sync/preview/types.ts';
import { computeLiveDiff } from '$pcd/resolved/liveDiff.ts';
import type { LiveDiffDeps } from '$pcd/resolved/liveDiff.ts';

// `generatePreview` is a bare named function export, not a property of an exported
// const object -- it cannot be monkey-patched the way `logger.error`/`db.query` are in
// tests/pcd/snapshots/service.test.ts (ESM import bindings are read-only for
// importers). computeLiveDiff instead accepts an optional `deps.generatePreview`
// injection point; every test below supplies a stub through it.

type Restore = () => void;

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

function patchLoggerForTest(restores: Restore[]): void {
  patchTarget(logger, 'error', (async () => undefined) as typeof logger.error, restores);
}

function buildInstance(overrides: Partial<ArrInstance> = {}): ArrInstance {
  return {
    id: 1,
    name: 'Radarr Main',
    type: 'radarr',
    url: 'http://localhost:7878',
    external_url: null,
    api_key_fingerprint: null,
    api_key: '',
    tags: null,
    enabled: 1,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
    ...overrides,
  };
}

function buildPreviewResult(overrides: Partial<GeneratePreviewResult>): GeneratePreviewResult {
  return {
    instanceId: 1,
    instanceName: 'Radarr Main',
    arrType: 'radarr',
    status: 'ready',
    createdAtMs: 0,
    sections: [],
    sectionOutcomes: [],
    qualityProfiles: null,
    delayProfiles: null,
    mediaManagement: null,
    metadataProfiles: null,
    summary: { totalCreates: 0, totalUpdates: 0, totalDeletes: 0, totalUnchanged: 0 },
    ...overrides,
  };
}

function buildEntityChange(overrides: Partial<EntityChange> = {}): EntityChange {
  return {
    entityType: 'qualityProfile',
    name: 'Profile A',
    action: 'unchanged',
    remoteId: 10,
    fields: [],
    ...overrides,
  };
}

function neverCalledStub(): LiveDiffDeps['generatePreview'] {
  return () => {
    throw new Error('generatePreview should not have been called');
  };
}

Deno.test('computeLiveDiff returns unsupported when the section is unsupported for the arr type', async () => {
  const stub = neverCalledStub();

  const result = await computeLiveDiff({
    instance: buildInstance({ type: 'radarr' }),
    entityType: 'lidarrMetadataProfile',
    name: 'Standard',
    deps: { generatePreview: stub },
  });

  assertEquals(result, { found: false, reason: 'unsupported' });
});

Deno.test(
  'computeLiveDiff short-circuits regularExpression to unsupported before any gating or preview call',
  async () => {
    let calls = 0;
    const stub: LiveDiffDeps['generatePreview'] = () => {
      calls += 1;
      throw new Error('generatePreview should not have been called');
    };

    const result = await computeLiveDiff({
      instance: buildInstance({ type: 'radarr' }),
      entityType: 'regularExpression',
      name: 'Sample RE',
      deps: { generatePreview: stub },
    });

    assertEquals(result, { found: false, reason: 'unsupported' });
    assertEquals(calls, 0);
  }
);

Deno.test('computeLiveDiff locates a collection entity via namespace-aware matching', async () => {
  const change = buildEntityChange({
    entityType: 'qualityProfile',
    name: 'Profile A\u200B',
    fields: [{ field: 'name', type: 'changed', current: 'a', desired: 'b' }],
  });

  const stub: LiveDiffDeps['generatePreview'] = () =>
    Promise.resolve(
      buildPreviewResult({
        sections: ['qualityProfiles'],
        sectionOutcomes: [{ section: 'qualityProfiles', failure: null, skipped: false }],
        qualityProfiles: { section: 'qualityProfiles', qualityProfiles: [change], customFormats: [] },
      })
    );

  const result = await computeLiveDiff({
    instance: buildInstance({ type: 'radarr' }),
    entityType: 'qualityProfile',
    name: 'Profile A',
    deps: { generatePreview: stub },
  });

  assert(result.found, 'expected the namespace-suffixed candidate to match');
  assertEquals(result.change, change);
});

Deno.test('computeLiveDiff locates a singleton entity via direct field access', async () => {
  const change = buildEntityChange({ entityType: 'delayProfile', name: 'Default', fields: [] });

  const stub: LiveDiffDeps['generatePreview'] = () =>
    Promise.resolve(
      buildPreviewResult({
        sections: ['delayProfiles'],
        sectionOutcomes: [{ section: 'delayProfiles', failure: null, skipped: false }],
        delayProfiles: { section: 'delayProfiles', profile: change },
      })
    );

  const result = await computeLiveDiff({
    instance: buildInstance({ type: 'radarr' }),
    entityType: 'delayProfile',
    name: 'Default',
    deps: { generatePreview: stub },
  });

  assert(result.found, 'expected the singleton profile to be returned');
  assertEquals(result.change, change);
});

Deno.test(
  'computeLiveDiff returns not_found when the singleton profile name does not match the requested name',
  async () => {
    // The live instance is configured with a DIFFERENT delay profile than the one being
    // requested -- returning the singleton unconditionally (the pre-fix behavior) would
    // report a live diff for the wrong profile instead of not_found.
    const change = buildEntityChange({ entityType: 'delayProfile', name: 'Some Other Profile', fields: [] });

    const stub: LiveDiffDeps['generatePreview'] = () =>
      Promise.resolve(
        buildPreviewResult({
          sections: ['delayProfiles'],
          sectionOutcomes: [{ section: 'delayProfiles', failure: null, skipped: false }],
          delayProfiles: { section: 'delayProfiles', profile: change },
        })
      );

    const result = await computeLiveDiff({
      instance: buildInstance({ type: 'radarr' }),
      entityType: 'delayProfile',
      name: 'Default',
      deps: { generatePreview: stub },
    });

    assertEquals(result, { found: false, reason: 'not_found' });
  }
);

Deno.test('computeLiveDiff locates a namespace-suffixed singleton profile name', async () => {
  const change = buildEntityChange({ entityType: 'delayProfile', name: 'Default​', fields: [] });

  const stub: LiveDiffDeps['generatePreview'] = () =>
    Promise.resolve(
      buildPreviewResult({
        sections: ['delayProfiles'],
        sectionOutcomes: [{ section: 'delayProfiles', failure: null, skipped: false }],
        delayProfiles: { section: 'delayProfiles', profile: change },
      })
    );

  const result = await computeLiveDiff({
    instance: buildInstance({ type: 'radarr' }),
    entityType: 'delayProfile',
    name: 'Default',
    deps: { generatePreview: stub },
  });

  assert(result.found, 'expected the namespace-suffixed singleton candidate to match');
  assertEquals(result.change, change);
});

Deno.test('computeLiveDiff returns not_found when the entity is absent from the section payload', async () => {
  const stub: LiveDiffDeps['generatePreview'] = () =>
    Promise.resolve(
      buildPreviewResult({
        sections: ['qualityProfiles'],
        sectionOutcomes: [{ section: 'qualityProfiles', failure: null, skipped: false }],
        qualityProfiles: { section: 'qualityProfiles', qualityProfiles: [], customFormats: [] },
      })
    );

  const result = await computeLiveDiff({
    instance: buildInstance({ type: 'radarr' }),
    entityType: 'qualityProfile',
    name: 'Missing Profile',
    deps: { generatePreview: stub },
  });

  assertEquals(result, { found: false, reason: 'not_found' });
});

Deno.test(
  'computeLiveDiff returns not_configured (not error) when the section has no sync configuration on the instance',
  async () => {
    // `skipped: true` with `error: null` and no `result` (see orchestrator.ts's
    // `!handler.hasConfig(...)` branch) means this instance has never configured the
    // section at all -- a normal outcome, not a fetch/parse failure. Before the fix this
    // fell through to the generic 'error' reason, which routes turn into a 500.
    const stub: LiveDiffDeps['generatePreview'] = () =>
      Promise.resolve(
        buildPreviewResult({
          sections: ['qualityProfiles'],
          sectionOutcomes: [{ section: 'qualityProfiles', failure: null, skipped: true }],
        })
      );

    const result = await computeLiveDiff({
      instance: buildInstance({ type: 'radarr' }),
      entityType: 'qualityProfile',
      name: 'Profile A',
      deps: { generatePreview: stub },
    });

    assertEquals(result, { found: false, reason: 'not_configured' });
  }
);

Deno.test('computeLiveDiff maps a section outcome error to a sanitized reason', async () => {
  const restores: Restore[] = [];
  patchLoggerForTest(restores);
  try {
    const stub: LiveDiffDeps['generatePreview'] = () =>
      Promise.resolve(
        buildPreviewResult({
          sections: ['qualityProfiles'],
          sectionOutcomes: [
            {
              section: 'qualityProfiles',
              // A 401 is classified upstream as the typed `unauthorized` code; liveDiff maps the
              // code straight to its closed reason (no substring parsing).
              failure: {
                code: 'unauthorized',
                message: 'The Radarr instance rejected the API key.',
                recoveryAction: 'Update the API key for this instance in its settings, then regenerate the preview.',
              },
              skipped: false,
            },
          ],
        })
      );

    const result = await computeLiveDiff({
      instance: buildInstance({ type: 'radarr' }),
      entityType: 'qualityProfile',
      name: 'Profile A',
      deps: { generatePreview: stub },
    });

    assertEquals(result, { found: false, reason: 'unauthorized' });
  } finally {
    restores.forEach((restore) => restore());
  }
});

Deno.test(
  'computeLiveDiff maps a thrown preview error to a sanitized reason without leaking the raw message',
  async () => {
    const restores: Restore[] = [];
    patchLoggerForTest(restores);
    try {
      const stub: LiveDiffDeps['generatePreview'] = () => {
        throw new Error('connect ETIMEDOUT 10.0.0.5:7878 timeout');
      };

      const result = await computeLiveDiff({
        instance: buildInstance({ type: 'radarr' }),
        entityType: 'qualityProfile',
        name: 'Profile A',
        deps: { generatePreview: stub },
      });

      assertEquals(result, { found: false, reason: 'timeout' });
      assertEquals(Object.keys(result), ['found', 'reason']);
    } finally {
      restores.forEach((restore) => restore());
    }
  }
);
