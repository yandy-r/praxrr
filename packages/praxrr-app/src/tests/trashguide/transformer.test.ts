import { assertEquals, assertThrows } from '@std/assert';
import type { TrashIdMapping } from '$db/queries/trashIdMappings.ts';
import type { PortableCustomFormat, PortableQualityProfile } from '$shared/pcd/portable.ts';
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
import { asTrashGuideId, toTrashGuideId } from '$trashguide/types.ts';

const ALPHA_CF_ID = toTrashGuideId('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const ZULU_CF_ID = toTrashGuideId('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
const PROFILE_ID = toTrashGuideId('cccccccccccccccccccccccccccccccc');

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
      trash_id: toTrashGuideId('dddddddddddddddddddddddddddddddd'),
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

Deno.test(
  'transformTrashGuideEntities throws when custom format default score is missing and no profile score set exists',
  () => {
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

    const transform = () =>
      transformTrashGuideEntities({
        sourceId: 12,
        arrType: 'radarr',
        parsed,
        existingMappings: [],
      });

    assertThrows(
      transform,
      Error,
      'references custom format "Scored by profile only" without a score in set "unknown-score-set"'
    );
  }
);

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

Deno.test('transformTrashGuideEntities accepts radarr anime quality-size profiles', () => {
  const result = transformTrashGuideEntities({
    sourceId: 95,
    arrType: 'radarr',
    parsed: createParseResult('radarr', [
      {
        entity_type: 'quality_size',
        arr_type: 'radarr',
        trash_id: toTrashGuideId('dddddddddddddddddddddddddddddddd'),
        file_path: 'quality-size/anime.json',
        name: 'anime',
        profile_type: 'anime',
        qualities: [
          {
            quality: 'Bluray-1080p',
            min: 1,
            preferred: 2,
            max: 3,
          },
        ],
      },
    ]),
    existingMappings: [],
  });

  const operation = result.activeOperations.find((row) => row.portableEntityType === 'radarr_quality_definitions');
  if (!operation) {
    throw new Error('Expected radarr quality definitions operation');
  }
  assertEquals(operation.data.name, 'anime');
});

Deno.test('transformTrashGuideEntities resolves profile item quality from item name when qualities are omitted', () => {
  const result = transformTrashGuideEntities({
    sourceId: 23,
    arrType: 'radarr',
    parsed: createParseResult('radarr', [
      createQualityProfileEntity({
        name: '[Anime] Remux-1080p',
        cutoff: 'Bluray-720p',
        items: [
          {
            name: 'Bluray-720p',
            allowed: true,
            qualities: [],
          },
        ],
      }),
    ]),
    existingMappings: [],
  });

  const profileData = getQualityProfileData(result);
  assertEquals(profileData.orderedItems.length, 1);
  assertEquals(profileData.orderedItems[0]?.type, 'quality');
  assertEquals(profileData.orderedItems[0]?.name, 'Bluray-720p');
});

Deno.test('transformTrashGuideEntities rejects profile item missing implicit quality name', () => {
  const error = assertThrows(
    () =>
      transformTrashGuideEntities({
        sourceId: 24,
        arrType: 'radarr',
        parsed: createParseResult('radarr', [
          createQualityProfileEntity({
            name: 'Invalid Profile',
            items: [
              {
                name: 'Definitely Not A Quality',
                allowed: true,
                qualities: [],
              },
            ],
          }),
        ]),
        existingMappings: [],
      }),
    TrashGuideTransformError
  );

  assertEquals(error.code, 'ambiguous_mapping');
  assertEquals(
    error.message,
    'Unknown quality "Definitely Not A Quality" in Invalid Profile:Definitely Not A Quality for arr_type "radarr" after normalization to "Definitely Not A Quality"'
  );
});

Deno.test(
  'transformTrashGuideEntities resolves resolution spec value from spec name when fields.value is missing',
  () => {
    const result = transformTrashGuideEntities({
      sourceId: 88,
      arrType: 'radarr',
      parsed: createParseResult('radarr', [
        createCustomFormatEntity({
          name: '1080p missing resolution value',
          specifications: [
            {
              name: '1080p',
              implementation: 'ResolutionSpecification',
              negate: false,
              required: true,
              fields: {},
            },
          ],
        }),
      ]),
      existingMappings: [],
    });

    assertEquals(result.activeOperations.length, 1);
    const operation = result.activeOperations[0];
    assertEquals(operation.portableEntityType, 'custom_format');
    const customFormatData = operation.data as PortableCustomFormat;
    assertEquals(customFormatData.conditions[0]?.type, 'resolution');
    assertEquals(customFormatData.conditions[0]?.resolutions, ['1080p']);
  }
);

Deno.test('transformTrashGuideEntities resolves source spec value from spec name when fields.value is missing', () => {
  const result = transformTrashGuideEntities({
    sourceId: 89,
    arrType: 'radarr',
    parsed: createParseResult('radarr', [
      createCustomFormatEntity({
        name: 'Anime BD Tier 01',
        specifications: [
          {
            name: 'Bluray',
            implementation: 'SourceSpecification',
            negate: false,
            required: true,
            fields: {},
          },
        ],
      }),
    ]),
    existingMappings: [],
  });

  assertEquals(result.activeOperations.length, 1);
  const operation = result.activeOperations[0];
  assertEquals(operation.portableEntityType, 'custom_format');
  const customFormatData = operation.data as PortableCustomFormat;
  assertEquals(customFormatData.conditions[0]?.type, 'source');
  assertEquals(customFormatData.conditions[0]?.sources, ['Bluray']);
});

Deno.test(
  'transformTrashGuideEntities resolves custom format score by trash_id name fallback when trash_id was not parsed',
  () => {
    const result = transformTrashGuideEntities({
      sourceId: 90,
      arrType: 'radarr',
      parsed: createParseResult('radarr', [
        createCustomFormatEntity({
          name: 'Anime Dual Audio',
          trash_id: toTrashGuideId('ffffffffffffffffffffffffffffffff'),
        }),
        createQualityProfileEntity({
          name: 'Fallback CF',
          format_items: [
            {
              name: 'Anime Dual Audio',
              score: null,
              custom_format_trash_id: toTrashGuideId('11111111111111111111111111111111'),
            },
          ],
        }),
      ]),
      existingMappings: [],
    });

    const profileData = getQualityProfileData(result);
    assertEquals(profileData.customFormatScores, [
      {
        customFormatName: 'Anime Dual Audio',
        arrType: 'radarr',
        score: 100,
      },
    ]);
  }
);

Deno.test(
  'transformTrashGuideEntities skips unresolved custom format score references while still importing profile',
  () => {
    const profile = createQualityProfileEntity({
      name: 'Profile with Missing CF',
      format_items: [
        {
          name: 'Missing Custom Format',
          score: null,
          custom_format_trash_id: toTrashGuideId('11111111111111111111111111111111'),
        },
      ],
    });

    const result = transformTrashGuideEntities({
      sourceId: 92,
      arrType: 'radarr',
      parsed: createParseResult('radarr', [profile]),
      existingMappings: [],
    });

    const profileData = getQualityProfileData(result);
    assertEquals(profileData.customFormatScores, []);
  }
);

Deno.test(
  'transformTrashGuideEntities rejects custom format reference when trash_id is missing and name is ambiguous',
  () => {
    const error = assertThrows(
      () =>
        transformTrashGuideEntities({
          sourceId: 91,
          arrType: 'radarr',
          parsed: createParseResult('radarr', [
            createCustomFormatEntity({
              name: 'Anime Dual Audio',
              trash_id: asTrashGuideId('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'),
            }),
            createCustomFormatEntity({
              name: 'Anime Dual Audio',
              trash_id: asTrashGuideId('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2'),
            }),
            createQualityProfileEntity({
              name: 'Ambiguous Fallback',
              format_items: [
                {
                  name: 'Anime Dual Audio',
                  score: null,
                  custom_format_trash_id: toTrashGuideId('11111111111111111111111111111111'),
                },
              ],
            }),
          ]),
          existingMappings: [],
        }),
      TrashGuideTransformError
    );

    assertEquals(
      error.message,
      'Ambiguous custom format reference in profile "Ambiguous Fallback": name "Anime Dual Audio" matches multiple custom formats'
    );
  }
);
