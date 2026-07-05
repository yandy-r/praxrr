import { assertEquals, assertExists, assertThrows } from '@std/assert';
import type { TrashIdMapping } from '$db/queries/trashIdMappings.ts';
import type {
  PortableCustomFormat,
  PortableQualityProfile,
  PortableRadarrNaming,
  PortableSonarrNaming,
} from '$shared/pcd/portable.ts';
import {
  transformTrashGuideEntities,
  TrashGuideTransformError,
  type TrashGuideTransformResult,
} from '$trashguide/transformer.ts';
import { toPortableNaming, type TrashGuideNamingTransformResult } from '$trashguide/transformers/mediaManagement.ts';
import type {
  TrashGuideCfGroupEntity,
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
const NAMING_ID = toTrashGuideId('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
const SONARR_NAMING_ID = toTrashGuideId('abababababababababababababababab');

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

function createNamingEntity(overrides: Partial<TrashGuideNamingEntity> = {}): TrashGuideNamingEntity {
  return {
    entity_type: 'naming',
    arr_type: 'radarr',
    trash_id: NAMING_ID,
    file_path: 'naming/default.json',
    name: 'TRaSH Naming',
    templates: {},
    ...overrides,
  };
}

function createParseResult(
  arrType: TrashGuideSupportedArrType,
  orderedEntities: readonly TrashGuideParsedEntity[]
): TrashGuideParseResult {
  const customFormats: TrashGuideCustomFormatEntity[] = [];
  const customFormatGroups: TrashGuideCfGroupEntity[] = [];
  const qualityProfiles: TrashGuideQualityProfileEntity[] = [];
  const qualitySizes: TrashGuideQualitySizeEntity[] = [];
  const naming: TrashGuideNamingEntity[] = [];

  for (const entity of orderedEntities) {
    switch (entity.entity_type) {
      case 'custom_format':
        customFormats.push(entity);
        break;
      case 'custom_format_group':
        customFormatGroups.push(entity);
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
      custom_format_groups: customFormatGroups,
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

function expectRadarrNamingData(result: TrashGuideNamingTransformResult): PortableRadarrNaming {
  if (result.portableEntityType !== 'radarr_naming') {
    throw new Error(`Expected radarr_naming, received "${result.portableEntityType}"`);
  }
  return result.data;
}

function expectSonarrNamingData(result: TrashGuideNamingTransformResult): PortableSonarrNaming {
  if (result.portableEntityType !== 'sonarr_naming') {
    throw new Error(`Expected sonarr_naming, received "${result.portableEntityType}"`);
  }
  return result.data;
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
  'transformTrashGuideEntities skips custom format scores when score_set and default scores are not available',
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

    const result = transformTrashGuideEntities({
      sourceId: 12,
      arrType: 'radarr',
      parsed,
      existingMappings: [],
    });

    const profileData = getQualityProfileData(result);
    assertEquals(profileData.customFormatScores, []);
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

// ---------------------------------------------------------------------------
// Priority 5: quality profile ordered-item cutoff + group formation
// (toOrderedItems, reached via transformTrashGuideEntities)
// ---------------------------------------------------------------------------

Deno.test('transformTrashGuideEntities selects a cutoff group by member quality (unique winner, upgradeUntil)', () => {
  const result = transformTrashGuideEntities({
    sourceId: 30,
    arrType: 'radarr',
    parsed: createParseResult('radarr', [
      createQualityProfileEntity({
        name: 'Group Cutoff',
        cutoff: 'Bluray-1080p',
        format_items: [],
        items: [
          { name: 'SD', allowed: true, qualities: ['SDTV'] },
          { name: 'HD Bluray', allowed: true, qualities: ['Bluray-720p', 'Bluray-1080p'] },
        ],
      }),
    ]),
    existingMappings: [],
  });

  const profileData = getQualityProfileData(result);
  assertEquals(profileData.orderedItems.length, 2);
  assertEquals(profileData.orderedItems[0], {
    type: 'quality',
    name: 'SDTV',
    position: 1,
    enabled: true,
    upgradeUntil: false,
    members: [],
  });
  assertEquals(profileData.orderedItems[1], {
    type: 'group',
    name: 'HD Bluray',
    position: 2,
    enabled: true,
    upgradeUntil: true,
    members: [{ name: 'Bluray-720p' }, { name: 'Bluray-1080p' }],
  });
  assertEquals(profileData.orderedItems.filter((item) => item.upgradeUntil === true).length, 1);
});

Deno.test('transformTrashGuideEntities rejects an ambiguous cutoff matching multiple rows', () => {
  const error = assertThrows(
    () =>
      transformTrashGuideEntities({
        sourceId: 31,
        arrType: 'radarr',
        parsed: createParseResult('radarr', [
          createQualityProfileEntity({
            name: 'Ambiguous Cutoff',
            cutoff: 'Bluray-1080p',
            format_items: [],
            items: [
              { name: 'Bluray-1080p', allowed: true, qualities: ['Bluray-1080p'] },
              { name: 'HD Group', allowed: true, qualities: ['Bluray-720p', 'Bluray-1080p'] },
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
    'Ambiguous cutoff mapping for quality profile "Ambiguous Cutoff": "Bluray-1080p" matched multiple quality rows'
  );
});

Deno.test('transformTrashGuideEntities matches a cutoff name case-insensitively', () => {
  const result = transformTrashGuideEntities({
    sourceId: 32,
    arrType: 'radarr',
    parsed: createParseResult('radarr', [
      createQualityProfileEntity({
        name: 'Case Cutoff',
        cutoff: 'bluray-1080p',
        format_items: [],
        items: [
          { name: 'Bluray-1080p', allowed: true, qualities: ['Bluray-1080p'] },
          { name: 'SDTV', allowed: false, qualities: ['SDTV'] },
        ],
      }),
    ]),
    existingMappings: [],
  });

  const profileData = getQualityProfileData(result);
  assertEquals(profileData.orderedItems[0]?.upgradeUntil, true);
  assertEquals(profileData.orderedItems[1]?.upgradeUntil, false);
  assertEquals(profileData.orderedItems.filter((item) => item.upgradeUntil === true).length, 1);
});

Deno.test('transformTrashGuideEntities rejects an empty cutoff', () => {
  const error = assertThrows(
    () =>
      transformTrashGuideEntities({
        sourceId: 33,
        arrType: 'radarr',
        parsed: createParseResult('radarr', [
          createQualityProfileEntity({
            cutoff: '',
            format_items: [],
          }),
        ]),
        existingMappings: [],
      }),
    TrashGuideTransformError
  );

  assertEquals(error.message, 'Quality profile "TRaSH Profile" has an empty cutoff');
});

Deno.test('transformTrashGuideEntities rejects a whitespace-only cutoff', () => {
  const error = assertThrows(
    () =>
      transformTrashGuideEntities({
        sourceId: 34,
        arrType: 'radarr',
        parsed: createParseResult('radarr', [
          createQualityProfileEntity({
            cutoff: '   ',
            format_items: [],
          }),
        ]),
        existingMappings: [],
      }),
    TrashGuideTransformError
  );

  assertEquals(error.message, 'Quality profile "TRaSH Profile" has an empty cutoff');
});

Deno.test('transformTrashGuideEntities rejects a cutoff that resolves to no quality or group', () => {
  const error = assertThrows(
    () =>
      transformTrashGuideEntities({
        sourceId: 35,
        arrType: 'radarr',
        parsed: createParseResult('radarr', [
          createQualityProfileEntity({
            name: 'No Match Cutoff',
            cutoff: 'Nonexistent Tier',
            format_items: [],
            items: [{ name: 'Bluray-1080p', allowed: true, qualities: ['Bluray-1080p'] }],
          }),
        ]),
        existingMappings: [],
      }),
    TrashGuideTransformError
  );

  assertEquals(
    error.message,
    'Quality profile "No Match Cutoff" cutoff "Nonexistent Tier" did not resolve to any quality or quality group'
  );
});

Deno.test(
  'transformTrashGuideEntities resolves an unmapped cutoff to a group by name with a defined upgradeUntil',
  () => {
    const result = transformTrashGuideEntities({
      sourceId: 36,
      arrType: 'radarr',
      parsed: createParseResult('radarr', [
        createQualityProfileEntity({
          name: 'Group Name Cutoff',
          cutoff: 'HD Bluray',
          format_items: [],
          items: [
            { name: 'SD', allowed: true, qualities: ['SDTV'] },
            { name: 'HD Bluray', allowed: true, qualities: ['Bluray-720p', 'Bluray-1080p'] },
          ],
        }),
      ]),
      existingMappings: [],
    });

    const profileData = getQualityProfileData(result);
    assertEquals(profileData.orderedItems[0]?.upgradeUntil, false);
    assertEquals(profileData.orderedItems[1]?.upgradeUntil, true);
    assertEquals(
      profileData.orderedItems.every((item) => typeof item.upgradeUntil === 'boolean'),
      true
    );
  }
);

Deno.test('transformTrashGuideEntities forms groups with nested members and propagates allowed to enabled', () => {
  const result = transformTrashGuideEntities({
    sourceId: 37,
    arrType: 'radarr',
    parsed: createParseResult('radarr', [
      createQualityProfileEntity({
        name: 'Allowed Propagation',
        cutoff: 'Bluray-1080p',
        format_items: [],
        items: [
          { name: 'Bluray-1080p', allowed: true, qualities: ['Bluray-1080p'] },
          { name: 'SDTV', allowed: false, qualities: ['SDTV'] },
          { name: 'WEB Group', allowed: false, qualities: ['WEBDL-720p', 'WEBDL-1080p'] },
        ],
      }),
    ]),
    existingMappings: [],
  });

  const profileData = getQualityProfileData(result);
  assertEquals(profileData.orderedItems.length, 3);
  assertEquals(profileData.orderedItems[0], {
    type: 'quality',
    name: 'Bluray-1080p',
    position: 1,
    enabled: true,
    upgradeUntil: true,
    members: [],
  });
  assertEquals(profileData.orderedItems[1], {
    type: 'quality',
    name: 'SDTV',
    position: 2,
    enabled: false,
    upgradeUntil: false,
    members: [],
  });
  assertEquals(profileData.orderedItems[2], {
    type: 'group',
    name: 'WEB Group',
    position: 3,
    enabled: false,
    upgradeUntil: false,
    members: [{ name: 'WEBDL-720p' }, { name: 'WEBDL-1080p' }],
  });
});

Deno.test('transformTrashGuideEntities rejects a multi-quality group item with an empty name', () => {
  const error = assertThrows(
    () =>
      transformTrashGuideEntities({
        sourceId: 38,
        arrType: 'radarr',
        parsed: createParseResult('radarr', [
          createQualityProfileEntity({
            name: 'Empty Group Name',
            cutoff: 'Bluray-1080p',
            format_items: [],
            items: [
              { name: 'Bluray-1080p', allowed: true, qualities: ['Bluray-1080p'] },
              { name: '', allowed: true, qualities: ['WEBDL-720p', 'WEBDL-1080p'] },
            ],
          }),
        ]),
        existingMappings: [],
      }),
    TrashGuideTransformError
  );

  assertEquals(error.message, 'Quality profile "Empty Group Name" includes a group item with an empty name');
});

Deno.test('transformTrashGuideEntities normalizes group member names per arr_type (Sonarr Remux)', () => {
  const result = transformTrashGuideEntities({
    sourceId: 39,
    arrType: 'sonarr',
    parsed: createParseResult('sonarr', [
      createQualityProfileEntity({
        arr_type: 'sonarr',
        name: 'Sonarr Remux Group',
        language: null,
        cutoff: 'Remux Tier',
        format_items: [],
        items: [{ name: 'Remux Tier', allowed: true, qualities: ['Remux-1080p', 'Bluray-1080p'] }],
      }),
    ]),
    existingMappings: [],
  });

  const profileData = getQualityProfileData(result);
  assertEquals(profileData.orderedItems.length, 1);
  assertEquals(profileData.orderedItems[0], {
    type: 'group',
    name: 'Remux Tier',
    position: 1,
    enabled: true,
    upgradeUntil: true,
    members: [{ name: 'Bluray-1080p Remux' }, { name: 'Bluray-1080p' }],
  });
});

// ---------------------------------------------------------------------------
// Priority 6: media-management naming template resolution
// (toPortableNaming direct + transformTrashGuideEntities integration)
// ---------------------------------------------------------------------------

Deno.test('toPortableNaming maps radarr top-level string templates', () => {
  const result = toPortableNaming(
    createNamingEntity({
      arr_type: 'radarr',
      name: 'Radarr Naming',
      templates: { folder: 'Movies/{Movie Title}', file: '{Movie Title} {Quality Full}' },
    }),
    'radarr'
  );

  assertEquals(result, {
    portableEntityType: 'radarr_naming',
    data: {
      name: 'Radarr Naming',
      rename: true,
      movieFolderFormat: 'Movies/{Movie Title}',
      movieFormat: '{Movie Title} {Quality Full}',
      replaceIllegalCharacters: true,
      colonReplacementFormat: 'smart',
    },
  });
});

Deno.test('toPortableNaming selects the most-specific radarr file candidate (file.standard.default wins)', () => {
  const result = toPortableNaming(
    createNamingEntity({
      arr_type: 'radarr',
      templates: {
        folder: { default: 'FolderDefault' },
        file: { standard: { default: 'StdDefault', preview: 'ShouldLose' }, default: 'FileDefaultShouldLose' },
      },
    }),
    'radarr'
  );

  assertEquals(result.portableEntityType, 'radarr_naming');
  const data = expectRadarrNamingData(result);
  assertEquals(data.movieFolderFormat, 'FolderDefault');
  assertEquals(data.movieFormat, 'StdDefault');
});

Deno.test('toPortableNaming falls back to file.standard when file.standard.default is absent', () => {
  const result = toPortableNaming(
    createNamingEntity({ arr_type: 'radarr', templates: { folder: 'F', file: { standard: 'StdString' } } }),
    'radarr'
  );

  const data = expectRadarrNamingData(result);
  assertEquals(data.movieFormat, 'StdString');
  assertEquals(data.movieFolderFormat, 'F');
});

Deno.test('toPortableNaming falls back to file.default when the standard branch is absent', () => {
  const result = toPortableNaming(
    createNamingEntity({ arr_type: 'radarr', templates: { folder: 'F', file: { default: 'FileDefault' } } }),
    'radarr'
  );

  assertEquals(expectRadarrNamingData(result).movieFormat, 'FileDefault');
});

Deno.test('toPortableNaming maps sonarr full templates to PortableSonarrNaming', () => {
  const result = toPortableNaming(
    createNamingEntity({
      arr_type: 'sonarr',
      name: 'Sonarr Naming',
      templates: {
        series: 'Series/{Series Title}',
        season: 'Season {season:00}',
        episodes: { standard: 'Std', daily: 'Daily', anime: 'Anime' },
      },
    }),
    'sonarr'
  );

  assertEquals(result.portableEntityType, 'sonarr_naming');
  assertEquals(result.data, {
    name: 'Sonarr Naming',
    rename: true,
    seriesFolderFormat: 'Series/{Series Title}',
    seasonFolderFormat: 'Season {season:00}',
    standardEpisodeFormat: 'Std',
    dailyEpisodeFormat: 'Daily',
    animeEpisodeFormat: 'Anime',
    replaceIllegalCharacters: true,
    colonReplacementFormat: 'smart',
    customColonReplacementFormat: null,
    multiEpisodeStyle: 'extend',
  });
});

Deno.test('toPortableNaming resolves sonarr episodes.*.default candidates', () => {
  const result = toPortableNaming(
    createNamingEntity({
      arr_type: 'sonarr',
      templates: {
        series: { default: 'S' },
        season: { default: 'Se' },
        episodes: { standard: { default: 'St' }, daily: { default: 'D' }, anime: { default: 'A' } },
      },
    }),
    'sonarr'
  );

  const data = expectSonarrNamingData(result);
  assertEquals(data.seriesFolderFormat, 'S');
  assertEquals(data.seasonFolderFormat, 'Se');
  assertEquals(data.standardEpisodeFormat, 'St');
  assertEquals(data.dailyEpisodeFormat, 'D');
  assertEquals(data.animeEpisodeFormat, 'A');
});

Deno.test('toPortableNaming throws on entity arr_type vs transform arr_type mismatch (explicit arr_type guard)', () => {
  assertThrows(
    () =>
      toPortableNaming(
        createNamingEntity({
          arr_type: 'sonarr',
          name: 'Mismatch Naming',
          templates: { series: 'S', season: 'Se', episodes: { standard: 'St', daily: 'D', anime: 'A' } },
        }),
        'radarr'
      ),
    Error,
    'Naming "Mismatch Naming" arr_type "sonarr" does not match transform arr_type "radarr"'
  );

  assertThrows(
    () =>
      toPortableNaming(
        createNamingEntity({ arr_type: 'radarr', name: 'Reverse Mismatch', templates: { folder: 'F', file: 'Fi' } }),
        'sonarr'
      ),
    Error,
    'Naming "Reverse Mismatch" arr_type "radarr" does not match transform arr_type "sonarr"'
  );
});

Deno.test('toPortableNaming throws Missing naming template mapping when radarr folder is absent', () => {
  assertThrows(
    () => toPortableNaming(createNamingEntity({ arr_type: 'radarr', templates: { file: 'X' } }), 'radarr'),
    Error,
    'Missing naming template mapping for radarr.folder'
  );
});

Deno.test('toPortableNaming throws when a template resolves to an empty/whitespace string', () => {
  assertThrows(
    () =>
      toPortableNaming(createNamingEntity({ arr_type: 'radarr', templates: { folder: 'F', file: '   ' } }), 'radarr'),
    Error,
    'cannot be empty'
  );
});

Deno.test('toPortableNaming throws Ambiguous naming template mapping for conflicting children', () => {
  assertThrows(
    () =>
      toPortableNaming(
        createNamingEntity({
          arr_type: 'radarr',
          templates: { folder: { web: 'WebFolder', bluray: 'BlurayFolder' }, file: 'X' },
        }),
        'radarr'
      ),
    Error,
    'Ambiguous naming template mapping'
  );
});

Deno.test('toPortableNaming resolves a record whose children share one value (Set dedup)', () => {
  const result = toPortableNaming(
    createNamingEntity({ arr_type: 'radarr', templates: { folder: { web: 'Same', bluray: 'Same' }, file: 'X' } }),
    'radarr'
  );

  assertEquals(expectRadarrNamingData(result).movieFolderFormat, 'Same');
});

Deno.test('toPortableNaming resolves a nested child default via recursion', () => {
  const result = toPortableNaming(
    createNamingEntity({ arr_type: 'radarr', templates: { folder: { grouped: { default: 'Nested' } }, file: 'X' } }),
    'radarr'
  );

  assertEquals(expectRadarrNamingData(result).movieFolderFormat, 'Nested');
});

Deno.test('toPortableNaming throws must be a string or object for a non-string/non-record value', () => {
  assertThrows(
    () => toPortableNaming(createNamingEntity({ arr_type: 'radarr', templates: { folder: 42, file: 'X' } }), 'radarr'),
    Error,
    'must be a string or object'
  );
});

Deno.test('transformTrashGuideEntities emits a radarr_naming operation', () => {
  const result = transformTrashGuideEntities({
    sourceId: 61,
    arrType: 'radarr',
    parsed: createParseResult('radarr', [
      createNamingEntity({ arr_type: 'radarr', templates: { folder: 'F', file: 'Fi' } }),
    ]),
    existingMappings: [],
  });

  const operation = result.activeOperations.find((row) => row.portableEntityType === 'radarr_naming');
  assertExists(operation);
  assertEquals(operation.identity.entityType, 'naming');
  const data = operation.data as PortableRadarrNaming;
  assertEquals(data.movieFolderFormat, 'F');
  assertEquals(data.movieFormat, 'Fi');
  assertEquals(
    result.mappingWrites.some((row) => row.entityType === 'naming'),
    true
  );
});

Deno.test('transformTrashGuideEntities emits a sonarr_naming operation (explicit arr_type routing)', () => {
  const result = transformTrashGuideEntities({
    sourceId: 62,
    arrType: 'sonarr',
    parsed: createParseResult('sonarr', [
      createNamingEntity({
        arr_type: 'sonarr',
        trash_id: SONARR_NAMING_ID,
        templates: { series: 'S', season: 'Se', episodes: { standard: 'St', daily: 'D', anime: 'A' } },
      }),
    ]),
    existingMappings: [],
  });

  const operation = result.activeOperations.find((row) => row.portableEntityType === 'sonarr_naming');
  assertExists(operation);
  assertEquals(operation.identity.entityType, 'naming');
  const data = operation.data as PortableSonarrNaming;
  assertEquals(data.standardEpisodeFormat, 'St');
  assertEquals(data.multiEpisodeStyle, 'extend');
});

Deno.test(
  'transformTrashGuideEntities wraps naming template failures as TrashGuideTransformError ambiguous_mapping',
  () => {
    const error = assertThrows(
      () =>
        transformTrashGuideEntities({
          sourceId: 60,
          arrType: 'radarr',
          parsed: createParseResult('radarr', [createNamingEntity({ arr_type: 'radarr', templates: {} })]),
          existingMappings: [],
        }),
      TrashGuideTransformError
    );

    assertEquals(error.code, 'ambiguous_mapping');
    assertEquals(error.message, 'Missing naming template mapping for radarr.folder');
  }
);
