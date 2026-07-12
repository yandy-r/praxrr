import { assert, assertEquals } from '@std/assert';
import { parse } from '@std/yaml';
import type { components as AppComponents } from '$api/v1.d.ts';
import { buildSyncPreviewReviewBinding } from '$sync/preview/reviewBinding.ts';
import { PREVIEW_STATUS_GENERATING, PREVIEW_STATUS_READY, previewStore } from '$sync/preview/store.ts';
import type { SyncPreviewResult, SyncPreviewReviewInvalidationReason } from '$sync/preview/types.ts';
import type { components as PortableComponents } from '../../../../praxrr-api/types.ts';
import {
  _handleSyncPreviewApplyRequest,
  type SyncPreviewApplyDependencies,
} from '../../routes/api/v1/sync/preview/[previewId]/apply/+server.ts';

interface DiscriminatorMapping {
  readonly path: string;
  readonly target: string;
}

type AppInvalidationCode = AppComponents['schemas']['SyncPreviewApplyInvalidationCode'];
type PortableInvalidationCode = PortableComponents['schemas']['SyncPreviewApplyInvalidationCode'];
type AppInvalidatedResponse = AppComponents['schemas']['SyncPreviewApplyInvalidatedResponse'];
type PortableInvalidatedResponse = PortableComponents['schemas']['SyncPreviewApplyInvalidatedResponse'];
type AppApplyResponse = AppComponents['schemas']['SyncPreviewApplyResponse'];
type PortableApplyResponse = PortableComponents['schemas']['SyncPreviewApplyResponse'];
type AppApplyErrorResponse = AppComponents['schemas']['SyncPreviewApplyErrorResponse'];
type PortableApplyErrorResponse = PortableComponents['schemas']['SyncPreviewApplyErrorResponse'];
type AppNamedProfileConfig = AppComponents['schemas']['SyncPreviewNamedProfileSectionConfig'];
type PortableNamedProfileConfig = PortableComponents['schemas']['SyncPreviewNamedProfileSectionConfig'];
type AppMediaManagementConfig = AppComponents['schemas']['SyncPreviewMediaManagementSectionConfig'];
type PortableMediaManagementConfig = PortableComponents['schemas']['SyncPreviewMediaManagementSectionConfig'];
type AppPluginManifest = AppComponents['schemas']['PluginManifestMetadata'];
type PortablePluginManifest = PortableComponents['schemas']['PluginManifestMetadata'];
type AppPluginRecord = AppComponents['schemas']['PluginRecord'];
type PortablePluginRecord = PortableComponents['schemas']['PluginRecord'];
type AppPluginListResponse = AppComponents['schemas']['PluginListResponse'];
type PortablePluginListResponse = PortableComponents['schemas']['PluginListResponse'];
type AppPluginReloadResponse = AppComponents['schemas']['PluginReloadResponse'];
type PortablePluginReloadResponse = PortableComponents['schemas']['PluginReloadResponse'];
type AppPluginErrorResponse = AppComponents['schemas']['PluginErrorResponse'];
type PortablePluginErrorResponse = PortableComponents['schemas']['PluginErrorResponse'];
type AppPluginExtensionPoint = AppComponents['schemas']['PluginExtensionPointId'];
type PortablePluginExtensionPoint = PortableComponents['schemas']['PluginExtensionPointId'];
type AppPluginCapability = AppComponents['schemas']['PluginCapabilityId'];
type PortablePluginCapability = PortableComponents['schemas']['PluginCapabilityId'];
type AppPluginLifecycle = AppComponents['schemas']['PluginLifecycleState'];
type PortablePluginLifecycle = PortableComponents['schemas']['PluginLifecycleState'];
type AppPluginErrorCode = AppComponents['schemas']['PluginErrorCode'];
type PortablePluginErrorCode = PortableComponents['schemas']['PluginErrorCode'];

const INVALIDATION_CODES = {
  pcd_drift: true,
  arr_drift: true,
  pcd_and_arr_drift: true,
  scope_drift: true,
  unverifiable_review: true,
} satisfies Record<SyncPreviewReviewInvalidationReason, true> &
  Record<AppInvalidationCode, true> &
  Record<PortableInvalidationCode, true>;

const INVALIDATED_RESPONSE_REQUIRED = [
  'error',
  'code',
  'changedEvidence',
  'changedSections',
  'regenerateRequired',
  'staleWarning',
];
const APPLY_RESPONSE_REQUIRED = ['success', 'results', 'staleWarning', 'outcomes', 'syncHistoryId'];
const APPLY_ERROR_RESPONSE_REQUIRED = ['failure', 'staleWarning'];
const PLUGIN_MANIFEST_REQUIRED = [
  'apiVersion',
  'id',
  'name',
  'version',
  'runtime',
  'entry',
  'extensionPoints',
  'capabilities',
];
const PLUGIN_RECORD_REQUIRED = [
  'manifest',
  'enabled',
  'discovered',
  'state',
  'registeredAt',
  'lastError',
  'createdAt',
  'updatedAt',
];
const PLUGIN_LIST_REQUIRED = ['pluginsEnabled', 'items'];
const PLUGIN_RELOAD_REQUIRED = ['pluginsEnabled', 'reloaded', 'discovered', 'registered', 'rejected', 'missing'];
const PLUGIN_ERROR_REQUIRED = ['code', 'error'];

const PLUGIN_DETAIL_STATUSES = {
  '200': 'PluginDetailResponse',
  '400': 'PluginErrorResponse',
  '404': 'PluginErrorResponse',
  '409': 'PluginErrorResponse',
  '500': 'PluginErrorResponse',
} as const;

const PLUGIN_MUTATION_STATUSES = {
  '200': 'PluginMutationResponse',
  '400': 'PluginErrorResponse',
  '404': 'PluginErrorResponse',
  '409': 'PluginErrorResponse',
  '500': 'PluginErrorResponse',
} as const;

const PLUGIN_EXTENSION_POINTS = {
  'config.profileCompiled.observe': true,
  'sync.previewComputed.observe': true,
  'config.validation.observe': true,
  'sync.beforeApply.observe': true,
  'sync.afterApply.observe': true,
  'parser.releaseTitle.transform': true,
  'customFormat.condition.evaluate': true,
  'notification.dispatch.observe': true,
  'importExport.adapter': true,
} satisfies Record<AppPluginExtensionPoint, true> & Record<PortablePluginExtensionPoint, true>;

const PLUGIN_CAPABILITIES = {
  'read:resolved-profile': true,
  'read:sync-preview': true,
  'read:custom-format': true,
  'read:config-validation': true,
} satisfies Record<AppPluginCapability, true> & Record<PortablePluginCapability, true>;

const PLUGIN_LIFECYCLE_STATES = {
  discovered: true,
  validated: true,
  registered: true,
  rejected: true,
  activated: true,
  failed: true,
  unloaded: true,
} satisfies Record<AppPluginLifecycle, true> & Record<PortablePluginLifecycle, true>;

const PLUGIN_ERROR_CODES = {
  invalid_identity: true,
  plugins_disabled: true,
  plugin_not_found: true,
  registry_conflict: true,
  internal_error: true,
} satisfies Record<AppPluginErrorCode, true> & Record<PortablePluginErrorCode, true>;

const GENERATED_INVALIDATED_RESPONSE_SAMPLE = {
  error: 'Live Arr configuration changed. Nothing was applied. Generate and review a new preview.',
  code: 'arr_drift',
  changedEvidence: ['arr'],
  changedSections: ['qualityProfiles'],
  regenerateRequired: true,
  staleWarning: null,
} satisfies AppInvalidatedResponse & PortableInvalidatedResponse;

const GENERATED_MATCHED_FAILURE_SAMPLE = {
  success: false,
  results: {
    status: 'failure',
    output: '',
    failure: {
      code: 'executionFailed',
      message: 'The sync run did not complete successfully.',
      recoveryAction: 'Review the per-entity outcomes, resolve the reported issues, then apply again.',
    },
  },
  staleWarning: null,
  outcomes: [
    {
      section: 'qualityProfiles',
      arrType: 'radarr',
      entityType: 'qualityProfile',
      name: 'Reviewed HD',
      action: 'update',
      status: 'failed',
      remoteId: '7',
      reason: 'The Arr instance rejected the request (HTTP 400).',
    },
  ],
  syncHistoryId: 234,
} satisfies AppApplyResponse & PortableApplyResponse;

const GENERATED_UNEXPECTED_FAILURE_SAMPLE = {
  failure: {
    code: 'internalError',
    message: 'An unexpected error occurred while processing the preview.',
    recoveryAction: 'Try again; if the problem persists, check the server logs for details.',
  },
  staleWarning: null,
} satisfies AppApplyErrorResponse & PortableApplyErrorResponse;

const GENERATED_NAMED_PROFILE_CONFIG_SAMPLE = {
  databaseId: 234,
  profileName: 'Reviewed profile',
} satisfies AppNamedProfileConfig & PortableNamedProfileConfig;

const GENERATED_MEDIA_MANAGEMENT_CONFIG_SAMPLE = {
  namingDatabaseId: 234,
  namingConfigName: 'Reviewed naming',
  qualityDefinitionsDatabaseId: null,
  qualityDefinitionsConfigName: null,
  mediaSettingsDatabaseId: null,
  mediaSettingsConfigName: null,
} satisfies AppMediaManagementConfig & PortableMediaManagementConfig;

const GENERATED_PLUGIN_MANIFEST_SAMPLE = {
  apiVersion: '1',
  id: 'com.example.contract',
  name: 'Contract Plugin',
  version: '1.0.0',
  runtime: 'wasm',
  entry: 'plugin.wasm',
  extensionPoints: ['sync.previewComputed.observe'],
  capabilities: ['read:sync-preview'],
} satisfies AppPluginManifest & PortablePluginManifest;

const GENERATED_PLUGIN_RECORD_SAMPLE = {
  manifest: GENERATED_PLUGIN_MANIFEST_SAMPLE,
  enabled: true,
  discovered: true,
  state: 'registered',
  registeredAt: '2026-07-11T00:00:00.000Z',
  lastError: null,
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
} satisfies AppPluginRecord & PortablePluginRecord;

const GENERATED_PLUGIN_LIST_SAMPLE = {
  pluginsEnabled: true,
  items: [GENERATED_PLUGIN_RECORD_SAMPLE],
} satisfies AppPluginListResponse & PortablePluginListResponse;

const GENERATED_PLUGIN_RELOAD_SAMPLE = {
  pluginsEnabled: true,
  reloaded: true,
  discovered: 1,
  registered: 1,
  rejected: 0,
  missing: 0,
} satisfies AppPluginReloadResponse & PortablePluginReloadResponse;

const GENERATED_PLUGIN_ERROR_SAMPLE = {
  code: 'plugin_not_found',
  error: 'Plugin not found in the requested API-version namespace',
} satisfies AppPluginErrorResponse & PortablePluginErrorResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectDiscriminatorMappings(value: unknown, path = '$'): DiscriminatorMapping[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectDiscriminatorMappings(item, `${path}[${index}]`));
  }
  if (!isRecord(value)) return [];

  const mappings: DiscriminatorMapping[] = [];
  if (isRecord(value.discriminator) && isRecord(value.discriminator.mapping)) {
    for (const [name, target] of Object.entries(value.discriminator.mapping)) {
      if (typeof target === 'string' && target.startsWith('#/')) {
        mappings.push({
          path: `${path}.discriminator.mapping.${name}`,
          target,
        });
      }
    }
  }

  for (const [key, child] of Object.entries(value)) {
    mappings.push(...collectDiscriminatorMappings(child, `${path}.${key}`));
  }
  return mappings;
}

function resolveLocalJsonPointer(root: unknown, pointer: string): unknown {
  if (pointer === '#') return root;
  if (!pointer.startsWith('#/')) return undefined;

  let current = root;
  for (const encodedSegment of pointer.slice(2).split('/')) {
    if (!isRecord(current)) return undefined;
    const segment = decodeURIComponent(encodedSegment).replaceAll('~1', '/').replaceAll('~0', '~');
    current = current[segment];
  }
  return current;
}

Deno.test('bundled OpenAPI discriminator mapping pointers resolve to bundled schemas', async () => {
  const specUrl = new URL('../../../../praxrr-api/openapi.json', import.meta.url);
  const spec = JSON.parse(await Deno.readTextFile(specUrl)) as unknown;
  const mappings = collectDiscriminatorMappings(spec);

  assert(mappings.length > 0, 'expected at least one local discriminator mapping pointer');
  for (const mapping of mappings) {
    assertEquals(
      isRecord(resolveLocalJsonPointer(spec, mapping.target)),
      true,
      `${mapping.path} points to missing schema ${mapping.target}`
    );
  }
});

function getRecordProperty(value: unknown, key: string): Record<string, unknown> {
  assert(isRecord(value), `expected object containing ${key}`);
  const property = value[key];
  assert(isRecord(property), `expected ${key} to be an object`);
  return property;
}

function schemaRefs(value: unknown): string[] {
  if (!isRecord(value)) return [];
  if (typeof value.$ref === 'string') return [value.$ref];
  if (!Array.isArray(value.oneOf)) return [];
  return value.oneOf.flatMap((entry) => schemaRefs(entry));
}

function responseSchema(responses: unknown, status: string): unknown {
  const response = getRecordProperty(responses, status);
  const content = getRecordProperty(response, 'content');
  return getRecordProperty(content, 'application/json').schema;
}

Deno.test('reviewed apply contract source, bundle, and generated declarations stay in lockstep', async () => {
  const sourceSchemas = parse(
    await Deno.readTextFile(new URL('../../../../../docs/api/v1/schemas/sync.yaml', import.meta.url))
  );
  const sourcePaths = parse(
    await Deno.readTextFile(new URL('../../../../../docs/api/v1/paths/sync.yaml', import.meta.url))
  );
  const bundled = JSON.parse(
    await Deno.readTextFile(new URL('../../../../praxrr-api/openapi.json', import.meta.url))
  ) as unknown;

  const sourceInvalidation = getRecordProperty(sourceSchemas, 'SyncPreviewApplyInvalidationCode');
  const sourceInvalidatedResponse = getRecordProperty(sourceSchemas, 'SyncPreviewApplyInvalidatedResponse');
  const sourceApplyResponse = getRecordProperty(sourceSchemas, 'SyncPreviewApplyResponse');
  const sourceApplyErrorResponse = getRecordProperty(sourceSchemas, 'SyncPreviewApplyErrorResponse');
  const bundledSchemas = getRecordProperty(getRecordProperty(bundled, 'components'), 'schemas');
  const bundledInvalidation = getRecordProperty(bundledSchemas, 'SyncPreviewApplyInvalidationCode');
  const bundledInvalidatedResponse = getRecordProperty(bundledSchemas, 'SyncPreviewApplyInvalidatedResponse');
  const bundledApplyResponse = getRecordProperty(bundledSchemas, 'SyncPreviewApplyResponse');
  const bundledApplyErrorResponse = getRecordProperty(bundledSchemas, 'SyncPreviewApplyErrorResponse');

  const expectedCodes = Object.keys(INVALIDATION_CODES);
  assertEquals(sourceInvalidation.enum, expectedCodes);
  assertEquals(bundledInvalidation.enum, expectedCodes);
  assertEquals(sourceInvalidatedResponse.required, INVALIDATED_RESPONSE_REQUIRED);
  assertEquals(bundledInvalidatedResponse.required, INVALIDATED_RESPONSE_REQUIRED);
  assertEquals(sourceApplyResponse.required, APPLY_RESPONSE_REQUIRED);
  assertEquals(bundledApplyResponse.required, APPLY_RESPONSE_REQUIRED);
  assertEquals(sourceApplyErrorResponse.required, APPLY_ERROR_RESPONSE_REQUIRED);
  assertEquals(bundledApplyErrorResponse.required, APPLY_ERROR_RESPONSE_REQUIRED);
  assertEquals(Object.keys(GENERATED_INVALIDATED_RESPONSE_SAMPLE), INVALIDATED_RESPONSE_REQUIRED);
  assertEquals(Object.keys(GENERATED_MATCHED_FAILURE_SAMPLE), APPLY_RESPONSE_REQUIRED);
  assertEquals(Object.keys(GENERATED_UNEXPECTED_FAILURE_SAMPLE), APPLY_ERROR_RESPONSE_REQUIRED);

  const sourceApplyPath = getRecordProperty(sourcePaths, 'previewApply');
  const sourceResponses = getRecordProperty(getRecordProperty(sourceApplyPath, 'post'), 'responses');
  const bundledPaths = getRecordProperty(bundled, 'paths');
  const bundledApplyPath = getRecordProperty(bundledPaths, '/sync/preview/{previewId}/apply');
  const bundledResponses = getRecordProperty(getRecordProperty(bundledApplyPath, 'post'), 'responses');

  const expectedStatusRefs = {
    '200': ['SyncPreviewApplyResponse'],
    '400': ['ErrorResponse'],
    '404': ['ErrorResponse'],
    '409': ['ErrorResponse'],
    '422': ['SyncPreviewApplyInvalidatedResponse', 'SyncPreviewApplyErrorResponse'],
    '500': ['SyncPreviewApplyResponse', 'SyncPreviewApplyErrorResponse'],
  } satisfies Record<string, string[]>;

  for (const [status, expectedSchemas] of Object.entries(expectedStatusRefs)) {
    const sourceSchema = getRecordProperty(
      getRecordProperty(getRecordProperty(sourceResponses, status), 'content'),
      'application/json'
    ).schema;
    const bundledSchema = getRecordProperty(
      getRecordProperty(getRecordProperty(bundledResponses, status), 'content'),
      'application/json'
    ).schema;
    assertEquals(
      schemaRefs(sourceSchema).map((ref) => ref.split('/').at(-1)),
      expectedSchemas,
      `source response mapping drifted for ${status}`
    );
    assertEquals(
      schemaRefs(bundledSchema).map((ref) => ref.split('/').at(-1)),
      expectedSchemas,
      `bundled response mapping drifted for ${status}`
    );
  }
});

Deno.test('plugin management source, bundle, paths, and generated declarations stay in lockstep', async () => {
  const sourceSchemas = parse(
    await Deno.readTextFile(new URL('../../../../../docs/api/v1/schemas/plugins.yaml', import.meta.url))
  );
  const sourcePaths = parse(
    await Deno.readTextFile(new URL('../../../../../docs/api/v1/paths/plugins.yaml', import.meta.url))
  );
  const bundled = JSON.parse(
    await Deno.readTextFile(new URL('../../../../praxrr-api/openapi.json', import.meta.url))
  ) as unknown;
  const bundledSchemas = getRecordProperty(getRecordProperty(bundled, 'components'), 'schemas');

  const schemaExpectations = [
    ['PluginManifestMetadata', PLUGIN_MANIFEST_REQUIRED, Object.keys(GENERATED_PLUGIN_MANIFEST_SAMPLE)],
    ['PluginRecord', PLUGIN_RECORD_REQUIRED, Object.keys(GENERATED_PLUGIN_RECORD_SAMPLE)],
    ['PluginListResponse', PLUGIN_LIST_REQUIRED, Object.keys(GENERATED_PLUGIN_LIST_SAMPLE)],
    ['PluginReloadResponse', PLUGIN_RELOAD_REQUIRED, Object.keys(GENERATED_PLUGIN_RELOAD_SAMPLE)],
    ['PluginErrorResponse', PLUGIN_ERROR_REQUIRED, Object.keys(GENERATED_PLUGIN_ERROR_SAMPLE)],
  ] as const;

  for (const [schemaName, required, generatedKeys] of schemaExpectations) {
    assertEquals(
      getRecordProperty(sourceSchemas, schemaName).required,
      required,
      `${schemaName} source required drifted`
    );
    assertEquals(
      getRecordProperty(bundledSchemas, schemaName).required,
      required,
      `${schemaName} bundled required drifted`
    );
    assertEquals(generatedKeys, required, `${schemaName} generated declaration sample drifted`);
  }

  const enumExpectations = [
    ['PluginExtensionPointId', Object.keys(PLUGIN_EXTENSION_POINTS)],
    ['PluginCapabilityId', Object.keys(PLUGIN_CAPABILITIES)],
    ['PluginLifecycleState', Object.keys(PLUGIN_LIFECYCLE_STATES)],
    ['PluginErrorCode', Object.keys(PLUGIN_ERROR_CODES)],
  ] as const;

  for (const [schemaName, expected] of enumExpectations) {
    assertEquals(getRecordProperty(sourceSchemas, schemaName).enum, expected, `${schemaName} source enum drifted`);
    assertEquals(getRecordProperty(bundledSchemas, schemaName).enum, expected, `${schemaName} bundled enum drifted`);
  }

  const operationExpectations = [
    {
      sourceKey: 'list',
      method: 'get',
      bundledPath: '/plugins',
      statuses: { '200': 'PluginListResponse', '500': 'PluginErrorResponse' },
    },
    {
      sourceKey: 'reload',
      method: 'post',
      bundledPath: '/plugins/reload',
      statuses: { '200': 'PluginReloadResponse', '500': 'PluginErrorResponse' },
    },
    {
      sourceKey: 'detail',
      method: 'get',
      bundledPath: '/plugins/{apiVersion}/{id}',
      statuses: PLUGIN_DETAIL_STATUSES,
    },
    {
      sourceKey: 'enable',
      method: 'post',
      bundledPath: '/plugins/{apiVersion}/{id}/enable',
      statuses: PLUGIN_MUTATION_STATUSES,
    },
    {
      sourceKey: 'disable',
      method: 'post',
      bundledPath: '/plugins/{apiVersion}/{id}/disable',
      statuses: PLUGIN_MUTATION_STATUSES,
    },
  ] as const;
  const bundledPaths = getRecordProperty(bundled, 'paths');

  for (const operation of operationExpectations) {
    const sourceResponses = getRecordProperty(
      getRecordProperty(getRecordProperty(sourcePaths, operation.sourceKey), operation.method),
      'responses'
    );
    const bundledResponses = getRecordProperty(
      getRecordProperty(getRecordProperty(bundledPaths, operation.bundledPath), operation.method),
      'responses'
    );
    const expectedStatuses = Object.keys(operation.statuses).sort();
    assertEquals(Object.keys(sourceResponses).sort(), expectedStatuses);
    assertEquals(Object.keys(bundledResponses).sort(), expectedStatuses);

    for (const [status, schemaName] of Object.entries(operation.statuses)) {
      const sourceRefs = schemaRefs(responseSchema(sourceResponses, status)).map((ref) => ref.split('/').at(-1));
      const bundledRefs = schemaRefs(responseSchema(bundledResponses, status)).map((ref) => ref.split('/').at(-1));
      assertEquals(sourceRefs, [schemaName]);
      assertEquals(bundledRefs, [schemaName]);
    }
  }
});

Deno.test('transient section config contract is typed identically in app and portable bundles', () => {
  assertEquals(GENERATED_NAMED_PROFILE_CONFIG_SAMPLE, {
    databaseId: 234,
    profileName: 'Reviewed profile',
  });
  assertEquals(GENERATED_MEDIA_MANAGEMENT_CONFIG_SAMPLE, {
    namingDatabaseId: 234,
    namingConfigName: 'Reviewed naming',
    qualityDefinitionsDatabaseId: null,
    qualityDefinitionsConfigName: null,
    mediaSettingsDatabaseId: null,
    mediaSettingsConfigName: null,
  });
});

function reviewedPreview(id: string): Omit<SyncPreviewResult, 'createdAt' | 'expiresAt'> {
  return {
    id,
    instanceId: 234,
    instanceName: 'Contract Radarr',
    arrType: 'radarr',
    status: PREVIEW_STATUS_READY,
    failure: null,
    sections: ['qualityProfiles'],
    sectionOutcomes: [{ section: 'qualityProfiles', failure: null, skipped: false }],
    qualityProfiles: null,
    delayProfiles: null,
    mediaManagement: null,
    metadataProfiles: null,
    summary: {
      totalCreates: 0,
      totalUpdates: 1,
      totalDeletes: 0,
      totalUnchanged: 0,
    },
  };
}

async function installReviewedPreview(id: string, nowMs: number): Promise<void> {
  const preview = reviewedPreview(id);
  previewStore.create({ ...preview, status: PREVIEW_STATUS_GENERATING }, nowMs);
  const binding = await buildSyncPreviewReviewBinding({
    instanceId: preview.instanceId,
    arrType: preview.arrType,
    target: {
      url: 'http://preview.test',
      credentialFingerprint: 'credential-v1',
      credentialKeyVersion: 'key-v1',
      credentialRevision: 'revision-v1',
    },
    sections: preview.sections,
    sectionConfigs: { qualityProfiles: { selections: ['Reviewed HD'] } },
    evidence: [
      {
        section: 'qualityProfiles',
        pcd: { profile: 'Reviewed HD' },
        arr: { remoteId: 7 },
        plan: { action: 'update' },
      },
    ],
  });
  const { status: _status, ...completed } = preview;
  previewStore.completeGeneration(id, completed, binding, nowMs);
}

function applyRequest(id: string): Request {
  return new Request(`http://localhost/api/v1/sync/preview/${id}/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sections: ['qualityProfiles'] }),
  });
}

Deno.test('reviewed apply runtime keeps invalidation, matched failure, and unexpected failure distinct', async () => {
  const nowMs = Date.now();
  const invalidatedId = `contract-invalidated-${crypto.randomUUID()}`;
  const matchedFailureId = `contract-matched-failure-${crypto.randomUUID()}`;
  const unexpectedFailureId = `contract-unexpected-failure-${crypto.randomUUID()}`;
  await Promise.all([
    installReviewedPreview(invalidatedId, nowMs),
    installReviewedPreview(matchedFailureId, nowMs),
    installReviewedPreview(unexpectedFailureId, nowMs),
  ]);

  const baseDependencies = {
    getSectionsInProgress: () => [],
    now: () => nowMs,
  };

  try {
    const invalidated = await _handleSyncPreviewApplyRequest(invalidatedId, applyRequest(invalidatedId), {
      ...baseDependencies,
      executeReviewedSyncJob: () =>
        Promise.resolve({
          kind: 'invalidated',
          reason: 'arr_drift',
          changedEvidence: ['arr'],
          changedSections: ['qualityProfiles'],
          outcomes: [],
          syncHistoryId: null,
        }),
    });
    assertEquals(invalidated.status, 422);
    assertEquals(await invalidated.json(), GENERATED_INVALIDATED_RESPONSE_SAMPLE);

    const matchedFailure = await _handleSyncPreviewApplyRequest(matchedFailureId, applyRequest(matchedFailureId), {
      ...baseDependencies,
      executeReviewedSyncJob: () =>
        Promise.resolve({
          kind: 'executed',
          result: {
            ...GENERATED_MATCHED_FAILURE_SAMPLE.results,
            failureCode: 'upstream',
            outcomes: GENERATED_MATCHED_FAILURE_SAMPLE.outcomes,
            syncHistoryId: GENERATED_MATCHED_FAILURE_SAMPLE.syncHistoryId,
          },
        }),
    });
    assertEquals(matchedFailure.status, 500);
    assertEquals(await matchedFailure.json(), GENERATED_MATCHED_FAILURE_SAMPLE);

    const unexpectedFailure = await _handleSyncPreviewApplyRequest(
      unexpectedFailureId,
      applyRequest(unexpectedFailureId),
      {
        ...baseDependencies,
        executeReviewedSyncJob: () => Promise.reject(new Error('SECRET upstream response')),
      } satisfies SyncPreviewApplyDependencies
    );
    assertEquals(unexpectedFailure.status, 500);
    assertEquals(await unexpectedFailure.json(), GENERATED_UNEXPECTED_FAILURE_SAMPLE);
  } finally {
    previewStore.delete(invalidatedId);
    previewStore.delete(matchedFailureId);
    previewStore.delete(unexpectedFailureId);
  }
});
