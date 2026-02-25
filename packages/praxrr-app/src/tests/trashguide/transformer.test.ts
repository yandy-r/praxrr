import { assertEquals, assertThrows } from '@std/assert';
import type { TrashIdMapping } from '$db/queries/trashIdMappings.ts';
import type { PortableQualityProfile } from '$shared/pcd/portable.ts';
import {
  transformTrashGuideEntities,
  TrashGuideTransformError,
  type TrashGuideTransformResult,
} from '$trashguide/transformer.ts';
import type {
  TrashGuideCustomFormatEntity,
  TrashGuideNamingEntity,
  TrashGuideParsedEntity,
  TrashGuideParseResult,
  TrashGuideQualityProfileEntity,
  TrashGuideQualitySizeEntity,
  TrashGuideSupportedArrType,
} from '$trashguide/types.ts';

const ALPHA_CF_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ZULU_CF_ID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const PROFILE_ID = 'cccccccccccccccccccccccccccccccc';

function createCustomFormatEntity(overrides: Partial<TrashGuideCustomFormatEntity> = {}): TrashGuideCustomFormatEntity {
  return {
    entity_type: 'custom_format',
    arr_type: 'radarr',
    trash_id: ALPHA_CF_ID,
    file_path: 'custom-formats/alpha.json',
    name: 'Alpha CF',
    description: null,
    regex_url: null,
    include_in_rename: true,
    scores: {
      default: 100,
    },
    specifications: [
      {
        name: 'Release title',
        implementation: 'ReleaseTitleSpecification',
        negate: false,
        required: true,
        fields: {
          value: 'WEB-DL',
        },
      },
    ],
    ...overrides,
  };
}

function createQualityProfileEntity(
  overrides: Partial<TrashGuideQualityProfileEntity> = {}
): TrashGuideQualityProfileEntity {
  return {
    entity_type: 'quality_profile',
    arr_type: 'radarr',
    trash_id: PROFILE_ID,
    file_path: 'quality-profiles/default.json',
    name: 'TRaSH Profile',
    description: null,
    source_url: null,
    score_set: null,
    group: null,
    upgrade_allowed: true,
    cutoff: 'Bluray-1080p',
    min_format_score: 0,
    cutoff_format_score: 0,
    min_upgrade_format_score: 1,
    language: null,
    items: [
      {
        name: 'Bluray-1080p',
        allowed: true,
        qualities: ['Bluray-1080p'],
      },
    ],
    format_items: [
      {
        name: 'Alpha CF',
        score: 10,
        custom_format_trash_id: null,
      },
    ],
    ...overrides,
  };
}

function createParseResult(
  arrType: TrashGuideSupportedArrType,
  orderedEntities: readonly TrashGuideParsedEntity[]
): TrashGuideParseResult {
  const customFormats: TrashGuideCustomFormatEntity[] = [];
  const qualityProfiles: TrashGuideQualityProfileEntity[] = [];
  const qualitySizes: TrashGuideQualitySizeEntity[] = [];
  const naming: TrashGuideNamingEntity[] = [];

  for (const entity of orderedEntities) {
    switch (entity.entity_type) {
      case 'custom_format':
        customFormats.push(entity);
        break;
      case 'quality_profile':
        qualityProfiles.push(entity);
        break;
      case 'quality_size':
        qualitySizes.push(entity);
        break;
      case 'naming':
        naming.push(entity);
        break;
    }
  }

  return {
    arr_type: arrType,
    status: 'success',
    entities: {
      custom_formats: customFormats,
      quality_profiles: qualityProfiles,
      quality_sizes: qualitySizes,
      naming,
    },
    ordered_entities: orderedEntities,
    issues: [],
    parsed_files: orderedEntities.length,
    failed_files: 0,
  };
}

function getQualityProfileData(result: TrashGuideTransformResult): PortableQualityProfile {
  const operation = result.activeOperations.find((row) => row.portableEntityType === 'quality_profile');
  if (!operation || operation.portableEntityType !== 'quality_profile') {
    throw new Error('Expected a quality_profile operation in transform result');
  }

  return operation.data as PortableQualityProfile;
}

Deno.test('transformTrashGuideEntities rejects parsed arr_type mismatch', () => {
  const parsed = createParseResult('sonarr', [
    createCustomFormatEntity({
      arr_type: 'sonarr',
      trash_id: 'dddddddddddddddddddddddddddddddd',
      file_path: 'custom-formats/sonarr.json',
    }),
  ]);

  const error = assertThrows(
    () =>
      transformTrashGuideEntities({
        sourceId: 11,
        arrType: 'radarr',
        parsed,
        existingMappings: [],
      }),
    TrashGuideTransformError
  );

  assertEquals(error.code, 'arr_type_mismatch');
});

Deno.test('transformTrashGuideEntities tracks rename by stable trash_id identity', () => {
  const renamedEntity = createCustomFormatEntity({
    trash_id: ALPHA_CF_ID,
    name: 'Renamed Alpha CF',
  });
  const parsed = createParseResult('radarr', [renamedEntity]);

  const existingMappings: TrashIdMapping[] = [
    {
      sourceId: 99,
      arrType: 'radarr',
      entityType: 'custom_format',
      trashId: ALPHA_CF_ID,
      entityName: 'Legacy Alpha CF',
    },
  ];

  const result = transformTrashGuideEntities({
    sourceId: 99,
    arrType: 'radarr',
    parsed,
    existingMappings,
  });

  assertEquals(result.renamedEntities, [
    {
      sourceId: 99,
      arrType: 'radarr',
      entityType: 'custom_format',
      trashId: ALPHA_CF_ID,
      previousName: 'Legacy Alpha CF',
      nextName: 'Renamed Alpha CF',
    },
  ]);
  assertEquals(result.mappingWrites[0].entityName, 'Renamed Alpha CF');
  assertEquals(result.activeOperations[0].identity.trashId, ALPHA_CF_ID);
  assertEquals(result.activeOperations[0].previousName, 'Legacy Alpha CF');
});

Deno.test('transformTrashGuideEntities falls back to score 0 when custom format default score is missing', () => {
  const customFormatWithoutDefaultScore = createCustomFormatEntity({
    trash_id: ALPHA_CF_ID,
    name: 'Scored by profile only',
    scores: {
      sqp_special: 450,
    },
  });

  const profileUsingTrashIdReference = createQualityProfileEntity({
    score_set: 'unknown-score-set',
    format_items: [
      {
        name: 'Scored by profile only',
        score: null,
        custom_format_trash_id: ALPHA_CF_ID,
      },
    ],
  });

  const parsed = createParseResult('radarr', [customFormatWithoutDefaultScore, profileUsingTrashIdReference]);

  const result = transformTrashGuideEntities({
    sourceId: 12,
    arrType: 'radarr',
    parsed,
    existingMappings: [],
  });

  const profileData = getQualityProfileData(result);
  assertEquals(profileData.customFormatScores, [
    {
      customFormatName: 'Scored by profile only',
      arrType: 'radarr',
      score: 0,
    },
  ]);
});

Deno.test('transformTrashGuideEntities generates idempotent operations from duplicate and reordered entities', () => {
  const alpha = createCustomFormatEntity({
    trash_id: ALPHA_CF_ID,
    name: 'Alpha CF',
    file_path: 'custom-formats/alpha.json',
  });
  const alphaDuplicate = createCustomFormatEntity({
    trash_id: ALPHA_CF_ID,
    name: 'Alpha CF',
    file_path: 'custom-formats/alpha-copy.json',
  });
  const zulu = createCustomFormatEntity({
    trash_id: ZULU_CF_ID,
    name: 'Zulu CF',
    file_path: 'custom-formats/zulu.json',
  });

  const parsedA = createParseResult('radarr', [zulu, alphaDuplicate, alpha]);
  const parsedB = createParseResult('radarr', [alpha, zulu, alphaDuplicate]);

  const resultA = transformTrashGuideEntities({
    sourceId: 22,
    arrType: 'radarr',
    parsed: parsedA,
    existingMappings: [],
  });

  const resultB = transformTrashGuideEntities({
    sourceId: 22,
    arrType: 'radarr',
    parsed: parsedB,
    existingMappings: [],
  });

  assertEquals(resultA.activeOperations.length, 2);
  assertEquals(resultA.mappingWrites.length, 2);
  assertEquals(resultA.removedEntities, []);
  assertEquals(resultA.renamedEntities, []);
  assertEquals(resultA.skippedEntities, []);
  assertEquals(resultA.activeOperations, resultB.activeOperations);
  assertEquals(resultA.mappingWrites, resultB.mappingWrites);
});
