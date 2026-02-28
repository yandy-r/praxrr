import { assertEquals } from '@std/assert';
import {
  toSourcedCustomFormatRow,
  toSourcedNamingListItem,
  toSourcedQualityDefinitionListItem,
  toSourcedQualityProfileRow,
} from '$trashguide/displayTransform.ts';
import type { TrashGuideEntityCache } from '$db/queries/trashGuideEntityCache.ts';
import { logger } from '$logger/logger.ts';

const SOURCE = {
  id: 12,
  name: 'TRaSH Source',
  arrType: 'radarr',
} as const;

const noopWarn = async () => Promise.resolve();
const originalWarn = logger.warn;
logger.warn = noopWarn;

function syntheticId(sourceId: number, trashId: string): number {
  const normalized = trashId.trim().toLowerCase();
  let hash = 2_166_136_261; // FNV-1a offset basis

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619); // FNV prime
  }

  const suffix = (hash >>> 0) % 1_000_000_000;
  return -(sourceId * 1_000_000_000 + suffix + 1);
}

function entityCache(overrides: Partial<TrashGuideEntityCache>): TrashGuideEntityCache {
  return {
    id: 99,
    sourceId: SOURCE.id,
    trashId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    entityType: 'quality_profile',
    name: 'Fallback',
    jsonData: '{}',
    filePath: 'entities.json',
    contentHash: 'hash',
    fetchedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

Deno.test('toSourcedCustomFormatRow: returns null for malformed cache JSON', () => {
  const row = toSourcedCustomFormatRow(
    entityCache({
      entityType: 'custom_format',
      name: 'Malformed CF',
      trashId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      jsonData: '{not json',
    }),
    SOURCE
  );

  assertEquals(row, null);
});

Deno.test('toSourcedCustomFormatRow: returns null when cached entity_type does not match requested type', () => {
  const row = toSourcedCustomFormatRow(
    entityCache({
      entityType: 'custom_format',
      name: 'Wrong Entity',
      trashId: 'ffffffffffffffffffffffffffffffff',
      jsonData: JSON.stringify({
        entity_type: 'quality_profile',
        arr_type: 'radarr',
        trash_id: 'ffffffffffffffffffffffffffffffff',
        file_path: 'quality-profiles/wrong.json',
        name: 'Wrong Entity',
        description: null,
        source_url: null,
        score_set: null,
        group: null,
        upgrade_allowed: true,
        cutoff: 'Any',
        min_format_score: 0,
        cutoff_format_score: 0,
        min_upgrade_format_score: 0,
        language: null,
        items: [],
        format_items: [],
      }),
    }),
    SOURCE
  );

  assertEquals(row, null);
});

Deno.test('toSourcedCustomFormatRow: maps specifications and source metadata', () => {
  const trashId = '1234567890abcdef1234567890abcdef';
  const row = toSourcedCustomFormatRow(
    entityCache({
      entityType: 'custom_format',
      name: 'Has Subtitle',
      trashId,
      jsonData: JSON.stringify({
        entity_type: 'custom_format',
        arr_type: 'radarr',
        trash_id: trashId,
        file_path: 'custom-formats/has-subtitle.json',
        name: 'Has Subtitle',
        description: 'Custom CF for subtitles',
        regex_url: null,
        include_in_rename: true,
        scores: { default: 100 },
        specifications: [
          {
            name: 'Release title',
            implementation: 'ReleaseTitleSpecification',
            required: true,
            negate: false,
            fields: { value: 'SUBTITLE' },
          },
        ],
      }),
    }),
    SOURCE
  );

  assertEquals(row, {
    id: syntheticId(SOURCE.id, trashId),
    name: 'Has Subtitle',
    description: 'Custom CF for subtitles',
    tags: [],
    conditions: [
      {
        name: 'Release title',
        type: 'ReleaseTitleSpecification',
        required: true,
        negate: false,
      },
    ],
    arrTargets: ['radarr'],
    testCount: 0,
    sourceType: 'trash',
    sourceDatabaseId: 12,
    sourceDatabaseName: 'TRaSH Source',
    trashId,
  });
});

Deno.test('toSourcedQualityProfileRow: maps upgrade-until matching across group and member quality names', () => {
  const profileName = 'TRaSH HD';
  const trashId = 'fedcba0987654321fedcba0987654321';
  const row = toSourcedQualityProfileRow(
    entityCache({
      entityType: 'quality_profile',
      name: profileName,
      trashId,
      jsonData: JSON.stringify({
        entity_type: 'quality_profile',
        arr_type: 'radarr',
        trash_id: trashId,
        file_path: 'quality-profiles/trash.json',
        name: profileName,
        description: null,
        source_url: null,
        score_set: null,
        group: null,
        upgrade_allowed: true,
        cutoff: 'Primary Group',
        min_format_score: 5,
        cutoff_format_score: 200,
        min_upgrade_format_score: 25,
        language: null,
        items: [
          {
            name: 'Primary',
            allowed: true,
            qualities: ['Primary'],
          },
          {
            name: 'Primary Group',
            allowed: true,
            qualities: ['1080p', '2160p'],
          },
          {
            name: 'Fallback',
            allowed: false,
            qualities: ['2160p'],
          },
        ],
        format_items: [],
      }),
    }),
    SOURCE
  );

  assertEquals(row?.id, syntheticId(SOURCE.id, trashId));
  assertEquals(row?.name, profileName);
  assertEquals(row?.description, '');
  assertEquals(row?.qualities, [
    { position: 1, type: 'quality', name: 'Primary', is_upgrade_until: false },
    { position: 2, type: 'group', name: 'Primary Group', is_upgrade_until: true },
    { position: 3, type: 'quality', name: '2160p', is_upgrade_until: false },
  ]);
  assertEquals(row?.language, undefined);
});

Deno.test('toSourcedNamingListItem/toSourcedQualityDefinitionListItem: parse malformed cache as null and valid cache keeps source fields', () => {
  const badNaming = toSourcedNamingListItem(
    entityCache({
      entityType: 'naming',
      name: 'Bad Name',
      trashId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      jsonData: '[]',
    }),
    SOURCE
  );
  assertEquals(badNaming, null);

  const naming = toSourcedNamingListItem(
    entityCache({
      entityType: 'naming',
      name: 'Good Name',
      trashId: 'cccccccccccccccccccccccccccccccc',
      jsonData: JSON.stringify({
        entity_type: 'naming',
        arr_type: 'radarr',
        trash_id: 'cccccccccccccccccccccccccccccccc',
        file_path: 'naming.json',
        name: 'Good Name',
        language: null,
        source_url: null,
        episode_format: '{Series Title}',
        movie_format: null,
        series_folder_format: null,
      }),
    }),
    SOURCE
  );

  assertEquals(naming?.name, 'Good Name');
  assertEquals(naming?.sourceType, 'trash');
  assertEquals(naming?.arr_type, 'radarr');

  const badQualityDefinition = toSourcedQualityDefinitionListItem(
    entityCache({
      entityType: 'quality_size',
      name: 'Bad Sizes',
      trashId: 'dddddddddddddddddddddddddddddddd',
      jsonData: '{broken',
    }),
    SOURCE
  );
  assertEquals(badQualityDefinition, null);

  const qualityDefinition = toSourcedQualityDefinitionListItem(
    entityCache({
      entityType: 'quality_size',
      name: 'Good Sizes',
      trashId: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      jsonData: JSON.stringify({
        entity_type: 'quality_size',
        arr_type: 'radarr',
        trash_id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        file_path: 'qualities.json',
        name: 'Good Sizes',
        profile_type: 'series',
        qualities: [
          {
            quality: '1080p',
            min: 0,
            preferred: 2000,
            max: 5000,
          },
          {
            quality: '2160p',
            min: 0,
            preferred: 2000,
            max: 5000,
          },
        ],
      }),
    }),
    SOURCE
  );

  assertEquals(qualityDefinition?.name, 'Good Sizes');
  assertEquals(qualityDefinition?.quality_count, 2);
});

Deno.test('toSyntheticId: distinguishes malformed TRaSH IDs', () => {
  const malformedA = toSourcedCustomFormatRow(
    entityCache({
      entityType: 'custom_format',
      name: 'Malformed A CF',
      trashId: 'not-a-hex-id-a',
      jsonData: JSON.stringify({
        entity_type: 'custom_format',
        name: 'Malformed A CF',
        arr_type: 'radarr',
        trash_id: 'not-a-hex-id-a',
        file_path: 'custom-formats/bad-a.json',
        description: null,
        regex_url: null,
        include_in_rename: false,
        scores: {},
        specifications: [],
      }),
    }),
    SOURCE
  );

  const malformedB = toSourcedCustomFormatRow(
    entityCache({
      entityType: 'custom_format',
      name: 'Malformed B CF',
      trashId: 'not-a-hex-id-b',
      jsonData: JSON.stringify({
        entity_type: 'custom_format',
        name: 'Malformed B CF',
        arr_type: 'radarr',
        trash_id: 'not-a-hex-id-b',
        file_path: 'custom-formats/bad-b.json',
        description: null,
        regex_url: null,
        include_in_rename: false,
        scores: {},
        specifications: [],
      }),
    }),
    SOURCE
  );

  assertEquals(malformedA?.id === malformedB?.id, false);
});
