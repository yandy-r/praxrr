import { assertEquals, assertExists, assertRejects, assertStringIncludes } from '@std/assert';
import { parseTrashGuideEntities } from '$trashguide/parser.ts';
import {
  asTrashGuideId,
  type TrashGuideDiscoveryResult,
  type TrashGuideEntityType,
  type TrashGuideParseIssue,
  TrashGuideParserError,
  type TrashGuideSourceFile,
  type TrashGuideSupportedArrType,
} from '$trashguide/types.ts';

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

function restoreAll(restores: Restore[]): void {
  for (const restore of restores.reverse()) {
    restore();
  }
}

function createSourceFile(entityType: TrashGuideEntityType, relativePath: string): TrashGuideSourceFile {
  return {
    entity_type: entityType,
    relative_path: relativePath,
    absolute_path: `/fixtures/${relativePath}`,
  };
}

function createDiscovery(
  arrType: TrashGuideSupportedArrType,
  files: Partial<Record<TrashGuideEntityType, readonly TrashGuideSourceFile[]>>
): TrashGuideDiscoveryResult {
  const filesByEntity = {
    custom_format: files.custom_format ?? [],
    custom_format_group: files.custom_format_group ?? [],
    quality_profile: files.quality_profile ?? [],
    quality_size: files.quality_size ?? [],
    naming: files.naming ?? [],
  } satisfies TrashGuideDiscoveryResult['files_by_entity'];

  const totalFiles =
    filesByEntity.custom_format.length +
    filesByEntity.custom_format_group.length +
    filesByEntity.quality_profile.length +
    filesByEntity.quality_size.length +
    filesByEntity.naming.length;

  return {
    arr_type: arrType,
    metadata_path: '/fixtures/metadata.json',
    files_by_entity: filesByEntity,
    total_files: totalFiles,
  };
}

function patchReadTextFile(fixtures: Readonly<Record<string, string>>, restores: Restore[]): void {
  const mutableDeno = Deno as unknown as {
    readTextFile: typeof Deno.readTextFile;
  };

  const replacement: typeof Deno.readTextFile = (...args) => {
    const [path] = args;
    const key = typeof path === 'string' ? path : path.toString();
    const fixture = fixtures[key];
    if (fixture === undefined) {
      throw new Error(`Missing fixture for ${key}`);
    }
    return Promise.resolve(fixture);
  };

  patchTarget(mutableDeno, 'readTextFile', replacement, restores);
}

function createCustomFormatPayload(name: string, trashId: string): Record<string, unknown> {
  return {
    trash_id: trashId,
    name,
    includeCustomFormatWhenRenaming: true,
    trash_scores: {
      default: 100,
    },
    specifications: [
      {
        name: 'Release title contains WEB-DL',
        implementation: 'ReleaseTitleSpecification',
        negate: false,
        required: true,
        fields: {
          value: 'WEB-DL',
        },
      },
    ],
  };
}

function createQualityProfilePayload(name: string, trashId: string, formatItems: unknown): Record<string, unknown> {
  return {
    trash_id: trashId,
    name,
    upgradeAllowed: true,
    cutoff: 'Bluray-1080p',
    minFormatScore: 0,
    cutoffFormatScore: 10000,
    minUpgradeFormatScore: 1,
    items: [{ name: 'Bluray-1080p', allowed: true, qualities: [] }],
    formatItems,
  };
}

function createQualitySizePayload(type: string, qualities: readonly unknown[]): Record<string, unknown> {
  return {
    type,
    qualities,
  };
}

function countIssueCodes(issues: readonly TrashGuideParseIssue[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const issue of issues) {
    counts[issue.code] = (counts[issue.code] ?? 0) + 1;
  }
  return counts;
}

function findIssueByFilePath(issues: readonly TrashGuideParseIssue[], filePath: string): TrashGuideParseIssue {
  const issue = issues.find((candidate) => candidate.file_path === filePath);
  assertExists(issue, `expected an issue for ${filePath}`);
  return issue;
}

Deno.test('parseTrashGuideEntities rejects discovery arr_type mismatch', async () => {
  const discovery = createDiscovery('sonarr', {});

  const error = await assertRejects(
    () =>
      parseTrashGuideEntities({
        arr_type: 'radarr',
        discovery,
      }),
    TrashGuideParserError
  );

  assertEquals(error.code, 'arr_type_mismatch');
});

Deno.test({
  name: 'parseTrashGuideEntities keeps identity ordering stable for identical duplicates',
  sanitizeResources: false,
  fn: async () => {
    const trashId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const fileA = createSourceFile('custom_format', 'custom-formats/a.json');
    const fileB = createSourceFile('custom_format', 'custom-formats/b.json');

    const discovery = createDiscovery('radarr', {
      custom_format: [fileB, fileA],
    });

    const fixtures: Record<string, string> = {
      [fileA.absolute_path]: JSON.stringify(createCustomFormatPayload('Alpha CF', trashId)),
      [fileB.absolute_path]:
        '{"name":"Alpha CF","trash_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","includeCustomFormatWhenRenaming":true,"trash_scores":{"default":100},"specifications":[{"name":"Release title contains WEB-DL","implementation":"ReleaseTitleSpecification","negate":false,"required":true,"fields":{"value":"WEB-DL"}}]}',
    };

    const restores: Restore[] = [];
    patchReadTextFile(fixtures, restores);

    try {
      const result = await parseTrashGuideEntities({
        arr_type: 'radarr',
        discovery,
      });

      assertEquals(result.status, 'success');
      assertEquals(result.parsed_files, 2);
      assertEquals(result.failed_files, 0);
      assertEquals(result.issues.length, 0);
      assertEquals(
        result.ordered_entities.map((entity) => entity.file_path),
        ['custom-formats/a.json', 'custom-formats/b.json']
      );
    } finally {
      restoreAll(restores);
    }
  },
});

Deno.test({
  name: 'parseTrashGuideEntities accepts custom formats without trash_scores',
  sanitizeResources: false,
  fn: async () => {
    const file = createSourceFile('custom_format', 'custom-formats/no-scores.json');
    const discovery = createDiscovery('radarr', {
      custom_format: [file],
    });
    const payload = createCustomFormatPayload('No Scores CF', 'cccccccccccccccccccccccccccccccc');
    delete payload.trash_scores;

    const restores: Restore[] = [];
    patchReadTextFile(
      {
        [file.absolute_path]: JSON.stringify(payload),
      },
      restores
    );

    try {
      const result = await parseTrashGuideEntities({
        arr_type: 'radarr',
        discovery,
      });

      assertEquals(result.status, 'success');
      assertEquals(result.issues.length, 0);
      assertEquals(result.entities.custom_formats.length, 1);
      assertEquals(result.entities.custom_formats[0].scores, {});
    } finally {
      restoreAll(restores);
    }
  },
});

Deno.test({
  name: 'parseTrashGuideEntities fails on conflicting payloads for the same stable identity',
  sanitizeResources: false,
  fn: async () => {
    const trashId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const fileA = createSourceFile('custom_format', 'custom-formats/first.json');
    const fileB = createSourceFile('custom_format', 'custom-formats/second.json');

    const discovery = createDiscovery('radarr', {
      custom_format: [fileA, fileB],
    });

    const fixtures: Record<string, string> = {
      [fileA.absolute_path]: JSON.stringify(createCustomFormatPayload('First Name', trashId)),
      [fileB.absolute_path]: JSON.stringify(createCustomFormatPayload('Renamed Name', trashId)),
    };

    const restores: Restore[] = [];
    patchReadTextFile(fixtures, restores);

    try {
      const error = await assertRejects(
        () =>
          parseTrashGuideEntities({
            arr_type: 'radarr',
            discovery,
          }),
        Error
      );

      assertStringIncludes(error.message, 'TRaSH identity collision detected');
    } finally {
      restoreAll(restores);
    }
  },
});

Deno.test({
  name: 'parseTrashGuideEntities maps object-form formatItems (numeric scores + trash_id refs) to sorted format_items',
  sanitizeResources: false,
  fn: async () => {
    const file = createSourceFile('quality_profile', 'quality-profiles/web.json');
    const discovery = createDiscovery('radarr', {
      quality_profile: [file],
    });

    const restores: Restore[] = [];
    patchReadTextFile(
      {
        [file.absolute_path]: JSON.stringify(
          createQualityProfilePayload('WEB Profile', 'dddddddddddddddddddddddddddddddd', {
            'Zeta CF': 100,
            'Alpha CF': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          })
        ),
      },
      restores
    );

    try {
      const result = await parseTrashGuideEntities({
        arr_type: 'radarr',
        discovery,
      });

      assertEquals(result.status, 'success');
      assertEquals(result.issues.length, 0);
      assertEquals(result.entities.quality_profiles.length, 1);
      assertEquals(result.entities.quality_profiles[0].format_items, [
        {
          name: 'Alpha CF',
          score: null,
          custom_format_trash_id: asTrashGuideId('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
        },
        {
          name: 'Zeta CF',
          score: 100,
          custom_format_trash_id: null,
        },
      ]);
    } finally {
      restoreAll(restores);
    }
  },
});

Deno.test({
  name: 'parseTrashGuideEntities records validation_error for object-form formatItems entry with invalid value',
  sanitizeResources: false,
  fn: async () => {
    const customFormatFile = createSourceFile('custom_format', 'custom-formats/good.json');
    const qualityProfileFile = createSourceFile('quality_profile', 'quality-profiles/web.json');
    const discovery = createDiscovery('radarr', {
      custom_format: [customFormatFile],
      quality_profile: [qualityProfileFile],
    });

    const restores: Restore[] = [];
    patchReadTextFile(
      {
        [customFormatFile.absolute_path]: JSON.stringify(
          createCustomFormatPayload('Good CF', 'cccccccccccccccccccccccccccccccc')
        ),
        [qualityProfileFile.absolute_path]: JSON.stringify(
          createQualityProfilePayload('WEB Profile', 'dddddddddddddddddddddddddddddddd', { 'Bad CF': true })
        ),
      },
      restores
    );

    try {
      const result = await parseTrashGuideEntities({
        arr_type: 'radarr',
        discovery,
      });

      assertEquals(result.status, 'partial');
      assertEquals(result.parsed_files, 1);
      assertEquals(result.failed_files, 1);
      assertEquals(result.issues.length, 1);
      assertEquals(result.entities.custom_formats.length, 1);
      assertEquals(result.entities.custom_formats[0].name, 'Good CF');

      const issue = findIssueByFilePath(result.issues, 'quality-profiles/web.json');
      assertEquals(issue.code, 'validation_error');
      assertEquals(issue.entity_type, 'quality_profile');
      assertStringIncludes(issue.message, 'must be a numeric score or a 32-char trash_id reference');
    } finally {
      restoreAll(restores);
    }
  },
});

Deno.test({
  name: 'parseTrashGuideEntities records validation_error when formatItems is neither array nor object',
  sanitizeResources: false,
  fn: async () => {
    const file = createSourceFile('quality_profile', 'quality-profiles/web.json');
    const discovery = createDiscovery('radarr', {
      quality_profile: [file],
    });

    const restores: Restore[] = [];
    patchReadTextFile(
      {
        [file.absolute_path]: JSON.stringify(
          createQualityProfilePayload('WEB Profile', 'dddddddddddddddddddddddddddddddd', 'nope')
        ),
      },
      restores
    );

    try {
      const result = await parseTrashGuideEntities({
        arr_type: 'radarr',
        discovery,
      });

      assertEquals(result.status, 'failed');
      assertEquals(result.issues.length, 1);

      const issue = findIssueByFilePath(result.issues, 'quality-profiles/web.json');
      assertEquals(issue.code, 'validation_error');
      assertEquals(issue.entity_type, 'quality_profile');
      assertStringIncludes(issue.message, 'formatItems must be an array or object');
    } finally {
      restoreAll(restores);
    }
  },
});

Deno.test({
  name: 'parseTrashGuideEntities records validation_error when quality size min is not a finite number',
  sanitizeResources: false,
  fn: async () => {
    const file = createSourceFile('quality_size', 'qualities/movie.json');
    const discovery = createDiscovery('radarr', {
      quality_size: [file],
    });

    const restores: Restore[] = [];
    patchReadTextFile(
      {
        [file.absolute_path]: JSON.stringify(
          createQualitySizePayload('movie', [{ quality: 'Bluray-1080p', min: '5', preferred: 10, max: 100 }])
        ),
      },
      restores
    );

    try {
      const result = await parseTrashGuideEntities({
        arr_type: 'radarr',
        discovery,
      });

      assertEquals(result.status, 'failed');
      assertEquals(result.issues.length, 1);

      const issue = findIssueByFilePath(result.issues, 'qualities/movie.json');
      assertEquals(issue.code, 'validation_error');
      assertEquals(issue.entity_type, 'quality_size');
      assertStringIncludes(issue.message, '"min" must be a finite number');
      assertStringIncludes(issue.message, 'qualities[0]');
    } finally {
      restoreAll(restores);
    }
  },
});

Deno.test({
  name: 'parseTrashGuideEntities records validation_error when quality size preferred is missing',
  sanitizeResources: false,
  fn: async () => {
    const file = createSourceFile('quality_size', 'qualities/movie.json');
    const discovery = createDiscovery('radarr', {
      quality_size: [file],
    });

    const restores: Restore[] = [];
    patchReadTextFile(
      {
        [file.absolute_path]: JSON.stringify(
          createQualitySizePayload('movie', [{ quality: 'Bluray-1080p', min: 5, max: 100 }])
        ),
      },
      restores
    );

    try {
      const result = await parseTrashGuideEntities({
        arr_type: 'radarr',
        discovery,
      });

      assertEquals(result.status, 'failed');
      assertEquals(result.issues.length, 1);

      const issue = findIssueByFilePath(result.issues, 'qualities/movie.json');
      assertEquals(issue.code, 'validation_error');
      assertEquals(issue.entity_type, 'quality_size');
      assertStringIncludes(issue.message, 'missing required field "preferred"');
    } finally {
      restoreAll(restores);
    }
  },
});

Deno.test({
  name: 'parseTrashGuideEntities records validation_error when quality size max is not a finite number',
  sanitizeResources: false,
  fn: async () => {
    const file = createSourceFile('quality_size', 'qualities/movie.json');
    const discovery = createDiscovery('radarr', {
      quality_size: [file],
    });

    const restores: Restore[] = [];
    patchReadTextFile(
      {
        [file.absolute_path]: JSON.stringify(
          createQualitySizePayload('movie', [{ quality: 'Bluray-1080p', min: 5, preferred: 10, max: 'big' }])
        ),
      },
      restores
    );

    try {
      const result = await parseTrashGuideEntities({
        arr_type: 'radarr',
        discovery,
      });

      assertEquals(result.status, 'failed');
      assertEquals(result.issues.length, 1);

      const issue = findIssueByFilePath(result.issues, 'qualities/movie.json');
      assertEquals(issue.code, 'validation_error');
      assertEquals(issue.entity_type, 'quality_size');
      assertStringIncludes(issue.message, '"max" must be a finite number');
    } finally {
      restoreAll(restores);
    }
  },
});

Deno.test({
  name: 'parseTrashGuideEntities records validation_error for quality size type incompatible with arr_type',
  sanitizeResources: false,
  fn: async () => {
    const file = createSourceFile('quality_size', 'qualities/series.json');
    const discovery = createDiscovery('radarr', {
      quality_size: [file],
    });

    const restores: Restore[] = [];
    patchReadTextFile(
      {
        [file.absolute_path]: JSON.stringify(createQualitySizePayload('series', [])),
      },
      restores
    );

    try {
      const result = await parseTrashGuideEntities({
        arr_type: 'radarr',
        discovery,
      });

      assertEquals(result.status, 'failed');
      assertEquals(result.issues.length, 1);

      const issue = findIssueByFilePath(result.issues, 'qualities/series.json');
      assertEquals(issue.code, 'validation_error');
      assertEquals(issue.entity_type, 'quality_size');
      assertStringIncludes(issue.message, 'incompatible with arr_type "radarr"');
    } finally {
      restoreAll(restores);
    }
  },
});

Deno.test({
  name: 'parseTrashGuideEntities records validation_error for unsupported quality size type',
  sanitizeResources: false,
  fn: async () => {
    const file = createSourceFile('quality_size', 'qualities/audio.json');
    const discovery = createDiscovery('radarr', {
      quality_size: [file],
    });

    const restores: Restore[] = [];
    patchReadTextFile(
      {
        [file.absolute_path]: JSON.stringify(createQualitySizePayload('audio', [])),
      },
      restores
    );

    try {
      const result = await parseTrashGuideEntities({
        arr_type: 'radarr',
        discovery,
      });

      assertEquals(result.status, 'failed');
      assertEquals(result.issues.length, 1);

      const issue = findIssueByFilePath(result.issues, 'qualities/audio.json');
      assertEquals(issue.code, 'validation_error');
      assertEquals(issue.entity_type, 'quality_size');
      assertStringIncludes(issue.message, 'is unsupported');
    } finally {
      restoreAll(restores);
    }
  },
});

Deno.test({
  name: 'parseTrashGuideEntities accumulates mixed issue codes and reports partial without aborting the batch',
  sanitizeResources: false,
  fn: async () => {
    const goodFile = createSourceFile('custom_format', 'custom-formats/good.json');
    const badJsonFile = createSourceFile('custom_format', 'custom-formats/bad-json.json');
    const missingFile = createSourceFile('custom_format', 'custom-formats/missing.json');
    const qualitySizeFile = createSourceFile('quality_size', 'qualities/movie.json');
    const qualityProfileFile = createSourceFile('quality_profile', 'quality-profiles/web.json');

    const discovery = createDiscovery('radarr', {
      custom_format: [goodFile, badJsonFile, missingFile],
      quality_size: [qualitySizeFile],
      quality_profile: [qualityProfileFile],
    });

    const restores: Restore[] = [];
    patchReadTextFile(
      {
        [goodFile.absolute_path]: JSON.stringify(
          createCustomFormatPayload('Good CF', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')
        ),
        [badJsonFile.absolute_path]: '{ not json',
        // missingFile intentionally omitted -> patchReadTextFile throws (file_read_error)
        [qualitySizeFile.absolute_path]: JSON.stringify(
          createQualitySizePayload('movie', [{ quality: 'Bluray-1080p', min: 'x', preferred: 10, max: 100 }])
        ),
        [qualityProfileFile.absolute_path]: JSON.stringify(
          createQualityProfilePayload('WEB Profile', 'dddddddddddddddddddddddddddddddd', { 'Bad CF': true })
        ),
      },
      restores
    );

    try {
      const result = await parseTrashGuideEntities({
        arr_type: 'radarr',
        discovery,
      });

      assertEquals(result.status, 'partial');
      assertEquals(result.parsed_files, 1);
      assertEquals(result.failed_files, 4);
      assertEquals(result.issues.length, 4);
      assertEquals(countIssueCodes(result.issues), {
        file_read_error: 1,
        json_parse_error: 1,
        validation_error: 2,
      });

      for (const issue of result.issues) {
        assertEquals(issue.retryable, false);
        assertEquals(issue.message.length > 0, true);
      }

      assertEquals(findIssueByFilePath(result.issues, 'custom-formats/missing.json').code, 'file_read_error');
      assertEquals(findIssueByFilePath(result.issues, 'custom-formats/bad-json.json').code, 'json_parse_error');
      assertEquals(findIssueByFilePath(result.issues, 'qualities/movie.json').code, 'validation_error');
      assertEquals(findIssueByFilePath(result.issues, 'quality-profiles/web.json').code, 'validation_error');

      assertEquals(result.entities.custom_formats.length, 1);
      assertEquals(result.entities.custom_formats[0].name, 'Good CF');
    } finally {
      restoreAll(restores);
    }
  },
});

Deno.test({
  name: 'parseTrashGuideEntities reports failed status when every file fails',
  sanitizeResources: false,
  fn: async () => {
    const badJsonFile = createSourceFile('custom_format', 'custom-formats/bad.json');
    const qualitySizeFile = createSourceFile('quality_size', 'qualities/movie.json');

    const discovery = createDiscovery('radarr', {
      custom_format: [badJsonFile],
      quality_size: [qualitySizeFile],
    });

    const restores: Restore[] = [];
    patchReadTextFile(
      {
        [badJsonFile.absolute_path]: '{ bad',
        [qualitySizeFile.absolute_path]: JSON.stringify(
          createQualitySizePayload('movie', [{ quality: 'Bluray-1080p', min: 'x', preferred: 10, max: 100 }])
        ),
      },
      restores
    );

    try {
      const result = await parseTrashGuideEntities({
        arr_type: 'radarr',
        discovery,
      });

      assertEquals(result.status, 'failed');
      assertEquals(result.parsed_files, 0);
      assertEquals(result.failed_files, 2);
      assertEquals(result.issues.length, 2);
      assertEquals(result.ordered_entities.length, 0);
      assertEquals(result.entities.custom_formats.length, 0);
      assertEquals(result.entities.quality_sizes.length, 0);
      assertEquals(countIssueCodes(result.issues), {
        json_parse_error: 1,
        validation_error: 1,
      });
    } finally {
      restoreAll(restores);
    }
  },
});
