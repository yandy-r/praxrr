/**
 * YAN-446 regression: the quality-profile section preview (and therefore drift) must compare
 * desired PCD payloads against Arr GET responses semantically, not structurally.
 *
 * Arr GET decorates custom formats with `implementationName`, `infoLink`, per-field UI metadata
 * (`order`, `label`, `helpText`, `type`, `advanced`, `privacy`, `isFloat`), default booleans
 * (`includeCustomFormatWhenRenaming: false`, Language `exceptLanguage: false`), and returns quality
 * profiles whose `formatItems[].name` is the suffixed Arr CF name and whose Radarr quality objects
 * carry `modifier`. An Arr that already matches the PCD exactly must preview as `unchanged` and
 * drift as `in-sync`, per arr_type, while real changes are still reported.
 */
import { assert, assertEquals } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import type { BaseArrClient } from '$arr/base.ts';
import type { ArrCustomFormat, ArrQualityProfileItem, ArrQualityProfilePayload } from '$arr/types.ts';
import { checkInstanceDrift } from '$sync/drift/check.ts';
import type { PcdCondition, PcdCustomFormat } from '$sync/customFormats/transformer.ts';
import type { GeneratePreviewResult } from '$sync/preview/orchestrator.ts';
import type {
  EntityChange,
  QualityProfilesPreview,
  SyncPreviewEvidenceClass,
  SyncPreviewEvidenceRecorder,
  SyncPreviewSection,
} from '$sync/preview/types.ts';
import { QualityProfileSyncer } from '$sync/qualityProfiles/syncer.ts';
import type { PcdQualityProfile } from '$sync/qualityProfiles/transformer.ts';

type ParityArrType = 'radarr' | 'sonarr';

const SUFFIX = '\u200B';
const INSTANCE_ID = 7;

function dbTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/preview-arr-shape-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });
      db.close();
      config.setBasePath(tempBasePath);
      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

// =============================================================================
// PCD fixtures
// =============================================================================

function condition(over: Partial<PcdCondition> & Pick<PcdCondition, 'name' | 'type'>): PcdCondition {
  return { arrType: 'all', negate: false, required: false, ...over };
}

function pcdCustomFormats(): Map<string, PcdCustomFormat> {
  const hdr: PcdCustomFormat = {
    id: 1,
    name: 'HDR',
    includeInRename: false,
    conditions: [
      condition({ name: 'HDR title', type: 'release_title', patterns: [{ name: 'hdr', pattern: '\\bHDR\\b' }] }),
      condition({ name: '1080p', type: 'resolution', required: true, resolutions: ['1080p'] }),
      condition({ name: 'English', type: 'language', languages: [{ name: 'English', except: false }] }),
      // Arr-specific conditions: each must only reach its own arr_type.
      condition({ name: 'Remux modifier', type: 'quality_modifier', arrType: 'radarr', qualityModifiers: ['remux'] }),
      condition({ name: 'Season pack', type: 'release_type', arrType: 'sonarr', releaseTypes: ['season_pack'] }),
    ],
  };
  const tier: PcdCustomFormat = {
    id: 2,
    name: 'Tier 01',
    includeInRename: true,
    conditions: [
      condition({ name: 'Not LQ', type: 'release_group', negate: true, patterns: [{ name: 'lq', pattern: '^LQ$' }] }),
      condition({ name: 'Bluray', type: 'source', sources: ['bluray'] }),
      condition({ name: 'Not French', type: 'language', languages: [{ name: 'French', except: true }] }),
    ],
  };
  return new Map([
    [hdr.name, hdr],
    [tier.name, tier],
  ]);
}

function pcdProfile(arrType: ParityArrType): PcdQualityProfile {
  return {
    id: 1,
    name: 'HD',
    upgradesAllowed: true,
    minimumCustomFormatScore: 0,
    upgradeUntilScore: 500,
    upgradeScoreIncrement: 1,
    qualities: [
      { type: 'quality', referenceId: 1, name: 'Remux-1080p', position: 0, enabled: true, upgradeUntil: true },
      {
        type: 'group',
        referenceId: 2,
        name: 'WEB 1080p',
        position: 1,
        enabled: true,
        upgradeUntil: false,
        members: [
          { id: 3, name: 'WEBDL-1080p' },
          { id: 4, name: 'WEBRip-1080p' },
        ],
      },
      { type: 'quality', referenceId: 5, name: 'Bluray-1080p', position: 2, enabled: true, upgradeUntil: false },
    ],
    language: arrType === 'radarr' ? { id: 1, name: 'English', type: 'simple' } : null,
    customFormats: [
      { formatId: 1, formatName: 'HDR', score: 100 },
      { formatId: 2, formatName: 'Tier 01', score: 250 },
    ],
  };
}

// =============================================================================
// Arr GET-shape decorators (what Radarr/Sonarr return for an identical entity)
// =============================================================================

/** Radarr quality modifiers keyed by quality name; Sonarr qualities have no modifier. */
const RADARR_MODIFIERS: Readonly<Record<string, string>> = {
  'Remux-1080p': 'remux',
  'Remux-2160p': 'remux',
  'BR-DISK': 'brdisk',
  'Raw-HD': 'rawhd',
  REGIONAL: 'regional',
  DVDSCR: 'screener',
};

function arrGetCustomFormat(desired: ArrCustomFormat, id: number): ArrCustomFormat {
  const specifications = desired.specifications.map((spec) => {
    const fields: Record<string, unknown>[] = spec.fields.map((field, order) => ({
      order,
      name: field.name,
      label: field.name === 'value' ? 'Value' : field.name,
      helpText: 'help',
      value: field.value,
      type: typeof field.value === 'string' ? 'textbox' : 'select',
      advanced: false,
      privacy: 'normal',
      isFloat: false,
    }));
    if (spec.implementation === 'LanguageSpecification' && !spec.fields.some((f) => f.name === 'exceptLanguage')) {
      fields.push({
        order: fields.length,
        name: 'exceptLanguage',
        label: 'Except Language',
        helpText: 'help',
        value: false,
        type: 'checkbox',
        advanced: false,
        privacy: 'normal',
        isFloat: false,
      });
    }
    return {
      name: spec.name,
      implementation: spec.implementation,
      implementationName: spec.implementation.replace('Specification', ''),
      infoLink: `https://wiki.servarr.com/${spec.implementation}`,
      negate: spec.negate,
      required: spec.required,
      // Arr returns fields in its own declaration order.
      fields: fields.reverse(),
    };
  });
  return {
    id,
    name: desired.name,
    includeCustomFormatWhenRenaming: desired.includeCustomFormatWhenRenaming ?? false,
    // Arr returns specifications in storage order, not the PCD sort order.
    specifications: specifications.reverse(),
  } as unknown as ArrCustomFormat;
}

function arrGetQualityItem(item: ArrQualityProfileItem, arrType: ParityArrType): ArrQualityProfileItem {
  const quality = item.quality
    ? arrType === 'radarr'
      ? { ...item.quality, modifier: RADARR_MODIFIERS[item.quality.name] ?? 'none' }
      : { ...item.quality }
    : undefined;
  return {
    ...(item.id !== undefined && { id: item.id }),
    ...(item.name !== undefined && { name: item.name }),
    ...(quality && { quality }),
    items: item.items.map((child) => arrGetQualityItem(child, arrType)),
    allowed: item.allowed,
  };
}

function arrGetQualityProfile(
  desired: ArrQualityProfilePayload,
  id: number,
  arrType: ParityArrType,
  arrFormats: readonly ArrCustomFormat[]
): ArrQualityProfilePayload {
  const arrNameById = new Map(arrFormats.map((format) => [format.id!, format.name]));
  return {
    ...structuredClone(desired),
    id,
    items: desired.items.map((item) => arrGetQualityItem(item, arrType)),
    // Arr reports every CF by its live (suffixed) name, in its own order.
    formatItems: desired.formatItems
      .map((item) => ({ format: item.format, name: arrNameById.get(item.format) ?? item.name, score: item.score }))
      .reverse(),
  };
}

// =============================================================================
// Harness
// =============================================================================

interface ArrState {
  customFormats: ArrCustomFormat[];
  qualityProfiles: ArrQualityProfilePayload[];
}

interface PreviewRun {
  preview: QualityProfilesPreview;
  desiredCustomFormats: ArrCustomFormat[];
  desiredProfiles: ArrQualityProfilePayload[];
}

async function runPreview(arrType: ParityArrType, state: ArrState): Promise<PreviewRun> {
  const client = {
    getCustomFormats: () => Promise.resolve(structuredClone(state.customFormats)),
    getQualityProfiles: () => Promise.resolve(structuredClone(state.qualityProfiles)),
  } as unknown as BaseArrClient;
  const syncer = new QualityProfileSyncer(client, INSTANCE_ID, 'Parity', arrType);
  syncer.setPreviewConfig({ selections: [{ databaseId: 3, profileName: 'HD' }] });
  const batches = [
    {
      sourceKind: 'pcd' as const,
      sourceLabel: 'DB 3',
      databaseId: 3,
      suffix: SUFFIX,
      profiles: [{ pcdProfile: pcdProfile(arrType), referencedFormatNames: ['HDR', 'Tier 01'] }],
      customFormats: pcdCustomFormats(),
      pcdFormatIdMap: new Map<string, number>(),
    },
  ];
  const stubbed = syncer as unknown as {
    fetchSyncBatches: () => Promise<unknown[]>;
    getQualityMappings: () => Promise<Map<string, string>>;
  };
  stubbed.fetchSyncBatches = () => Promise.resolve(structuredClone(batches));
  stubbed.getQualityMappings = () => Promise.resolve(new Map());

  const evidence = new Map<string, unknown>();
  const recorder: SyncPreviewEvidenceRecorder = {
    record(_section: SyncPreviewSection, source: SyncPreviewEvidenceClass, key: string, value: unknown) {
      evidence.set(`${source}.${key}`, value);
    },
    prepare() {},
  };
  syncer.setPreviewEvidenceRecorder(recorder);

  const preview = (await syncer.generatePreview()) as QualityProfilesPreview;
  const desired = evidence.get('pcd.desiredPayloads') as {
    customFormats: ArrCustomFormat[];
    qualityProfiles: ArrQualityProfilePayload[];
  };
  assert(desired, 'preview must record desired payloads');
  return {
    preview,
    desiredCustomFormats: structuredClone(desired.customFormats),
    desiredProfiles: structuredClone(desired.qualityProfiles),
  };
}

/** Build an Arr whose live state is exactly what a confirmed sync of the PCD would leave. */
async function syncedArrState(arrType: ParityArrType): Promise<ArrState> {
  const state: ArrState = { customFormats: [], qualityProfiles: [] };
  // An unmanaged CF lives alongside the managed ones; every profile lists it at score 0.
  const unmanaged = { id: 5, name: 'Hand Made', includeCustomFormatWhenRenaming: false, specifications: [] };

  const first = await runPreview(arrType, state);
  state.customFormats = [
    unmanaged,
    ...first.desiredCustomFormats.map((format, index) => arrGetCustomFormat(format, 11 + index)),
  ];

  const second = await runPreview(arrType, state);
  state.qualityProfiles = second.desiredProfiles.map((profile, index) =>
    arrGetQualityProfile(profile, 21 + index, arrType, state.customFormats)
  );
  return state;
}

/** Writes a sync would issue; unmanaged deletes are reported but never written without pruning. */
function pendingWrites(changes: readonly EntityChange[]): EntityChange[] {
  return changes.filter((change) => change.action !== 'unchanged' && change.action !== 'delete');
}

async function driftStatus(arrType: ParityArrType, preview: QualityProfilesPreview) {
  const instance: ArrInstance = {
    id: INSTANCE_ID,
    name: 'Parity',
    type: arrType,
    url: 'http://localhost:7878',
    external_url: null,
    api_key_fingerprint: null,
    api_key: 'test-key',
    tags: null,
    enabled: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  const result: GeneratePreviewResult = {
    instanceId: INSTANCE_ID,
    instanceName: 'Parity',
    arrType,
    status: 'ready',
    createdAtMs: 0,
    sections: ['qualityProfiles'],
    sectionOutcomes: [{ section: 'qualityProfiles', failure: null, skipped: false }],
    qualityProfiles: preview,
    delayProfiles: null,
    mediaManagement: null,
    metadataProfiles: null,
    summary: { totalCreates: 0, totalUpdates: 0, totalDeletes: 0, totalUnchanged: 0 },
  };
  return await checkInstanceDrift(instance, {
    heartbeat: () => Promise.resolve({ ok: true, version: '5.0.0', appName: arrType }),
    isPcdCacheReady: () => true,
    resolveAvailableSections: () => new Set<SyncPreviewSection>(['qualityProfiles']),
    registerPreviewAttempt: () => true,
    generatePreview: () => Promise.resolve(result),
    now: () => 0,
    budgetMs: 20_000,
  });
}

// =============================================================================
// Tests
// =============================================================================

for (const arrType of ['radarr', 'sonarr'] as const) {
  dbTest(`${arrType}: Arr GET state identical to PCD previews unchanged and drifts in-sync`, async () => {
    const state = await syncedArrState(arrType);
    const { preview } = await runPreview(arrType, state);

    assertEquals(preview.customFormats.length, 3);
    assertEquals(preview.qualityProfiles.length, 1);
    assertEquals(pendingWrites(preview.customFormats), [], 'identical custom formats must be unchanged');
    assertEquals(pendingWrites(preview.qualityProfiles), [], 'identical quality profiles must be unchanged');

    const drift = await driftStatus(arrType, preview);
    assertEquals(drift.status, 'in-sync');
    assertEquals(drift.counts.drifted, 0);
    assertEquals(drift.counts.missing, 0);
  });

  dbTest(`${arrType}: real custom format and quality profile changes are still detected`, async () => {
    const state = await syncedArrState(arrType);
    const hdr = state.customFormats.find((format) => format.name === `HDR${SUFFIX}`)!;
    const tier = state.customFormats.find((format) => format.name === `Tier 01${SUFFIX}`)!;

    // Spec value edited in Arr.
    const titleSpec = hdr.specifications.find((spec) => spec.name === 'HDR title')!;
    titleSpec.fields.find((field) => field.name === 'value')!.value = '\\bHDR10\\b';
    // Negate flipped and a spec removed in Arr.
    const groupSpec = tier.specifications.find((spec) => spec.name === 'Not LQ')!;
    groupSpec.negate = false;
    tier.specifications = tier.specifications.filter((spec) => spec.name !== 'Bluray');
    // Score edited in Arr.
    const profile = state.qualityProfiles[0];
    profile.formatItems.find((item) => item.format === hdr.id)!.score = 50;

    const { preview } = await runPreview(arrType, state);
    const changed = pendingWrites(preview.customFormats);
    assertEquals(changed.map((change) => [change.name, change.action]).sort(), [
      ['HDR', 'update'],
      ['Tier 01', 'update'],
    ]);
    const hdrChange = changed.find((change) => change.name === 'HDR')!;
    assertEquals(hdrChange.fields.length, 1);
    assertEquals(hdrChange.fields[0].current, '\\bHDR10\\b');
    assertEquals(hdrChange.fields[0].desired, '\\bHDR\\b');
    const tierFields = changed.find((change) => change.name === 'Tier 01')!.fields;
    assertEquals(tierFields.length, 2);
    assert(tierFields.some((field) => field.type === 'changed' && field.current === false && field.desired === true));
    assert(tierFields.some((field) => field.type === 'added'));

    const profileChanges = pendingWrites(preview.qualityProfiles);
    assertEquals(profileChanges.length, 1);
    assertEquals(profileChanges[0].action, 'update');
    assertEquals(
      profileChanges[0].fields.map(({ type, current, desired }) => ({ type, current, desired })),
      [{ type: 'changed', current: 50, desired: 100 }]
    );

    const drift = await driftStatus(arrType, preview);
    assertEquals(drift.status, 'drifted');
    assertEquals(drift.counts.drifted, 3);
  });
}
