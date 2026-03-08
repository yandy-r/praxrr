import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { parseTrashGuideEntities } from "$trashguide/parser.ts";
import {
  type TrashGuideDiscoveryResult,
  type TrashGuideEntityType,
  TrashGuideParserError,
  type TrashGuideSourceFile,
  type TrashGuideSupportedArrType,
} from "$trashguide/types.ts";

type Restore = () => void;

function patchTarget<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
  restores: Restore[],
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

function createSourceFile(
  entityType: TrashGuideEntityType,
  relativePath: string,
): TrashGuideSourceFile {
  return {
    entity_type: entityType,
    relative_path: relativePath,
    absolute_path: `/fixtures/${relativePath}`,
  };
}

function createDiscovery(
  arrType: TrashGuideSupportedArrType,
  files: Partial<Record<TrashGuideEntityType, readonly TrashGuideSourceFile[]>>,
): TrashGuideDiscoveryResult {
  const filesByEntity = {
    custom_format: files.custom_format ?? [],
    custom_format_group: files.custom_format_group ?? [],
    quality_profile: files.quality_profile ?? [],
    quality_size: files.quality_size ?? [],
    naming: files.naming ?? [],
  } satisfies TrashGuideDiscoveryResult["files_by_entity"];

  const totalFiles = filesByEntity.custom_format.length +
    filesByEntity.custom_format_group.length +
    filesByEntity.quality_profile.length +
    filesByEntity.quality_size.length +
    filesByEntity.naming.length;

  return {
    arr_type: arrType,
    metadata_path: "/fixtures/metadata.json",
    files_by_entity: filesByEntity,
    total_files: totalFiles,
  };
}

function patchReadTextFile(
  fixtures: Readonly<Record<string, string>>,
  restores: Restore[],
): void {
  const mutableDeno = Deno as unknown as {
    readTextFile: typeof Deno.readTextFile;
  };

  const replacement: typeof Deno.readTextFile = (...args) => {
    const [path] = args;
    const key = typeof path === "string" ? path : path.toString();
    const fixture = fixtures[key];
    if (fixture === undefined) {
      throw new Error(`Missing fixture for ${key}`);
    }
    return Promise.resolve(fixture);
  };

  patchTarget(mutableDeno, "readTextFile", replacement, restores);
}

function createCustomFormatPayload(
  name: string,
  trashId: string,
): Record<string, unknown> {
  return {
    trash_id: trashId,
    name,
    includeCustomFormatWhenRenaming: true,
    trash_scores: {
      default: 100,
    },
    specifications: [
      {
        name: "Release title contains WEB-DL",
        implementation: "ReleaseTitleSpecification",
        negate: false,
        required: true,
        fields: {
          value: "WEB-DL",
        },
      },
    ],
  };
}

Deno.test("parseTrashGuideEntities rejects discovery arr_type mismatch", async () => {
  const discovery = createDiscovery("sonarr", {});

  const error = await assertRejects(
    () =>
      parseTrashGuideEntities({
        arr_type: "radarr",
        discovery,
      }),
    TrashGuideParserError,
  );

  assertEquals(error.code, "arr_type_mismatch");
});

Deno.test({
  name:
    "parseTrashGuideEntities keeps identity ordering stable for identical duplicates",
  sanitizeResources: false,
  fn: async () => {
    const trashId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const fileA = createSourceFile("custom_format", "custom-formats/a.json");
    const fileB = createSourceFile("custom_format", "custom-formats/b.json");

    const discovery = createDiscovery("radarr", {
      custom_format: [fileB, fileA],
    });

    const fixtures: Record<string, string> = {
      [fileA.absolute_path]: JSON.stringify(
        createCustomFormatPayload("Alpha CF", trashId),
      ),
      [fileB.absolute_path]:
        '{"name":"Alpha CF","trash_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","includeCustomFormatWhenRenaming":true,"trash_scores":{"default":100},"specifications":[{"name":"Release title contains WEB-DL","implementation":"ReleaseTitleSpecification","negate":false,"required":true,"fields":{"value":"WEB-DL"}}]}',
    };

    const restores: Restore[] = [];
    patchReadTextFile(fixtures, restores);

    try {
      const result = await parseTrashGuideEntities({
        arr_type: "radarr",
        discovery,
      });

      assertEquals(result.status, "success");
      assertEquals(result.parsed_files, 2);
      assertEquals(result.failed_files, 0);
      assertEquals(result.issues.length, 0);
      assertEquals(
        result.ordered_entities.map((entity) => entity.file_path),
        ["custom-formats/a.json", "custom-formats/b.json"],
      );
    } finally {
      restoreAll(restores);
    }
  },
});

Deno.test({
  name: "parseTrashGuideEntities accepts custom formats without trash_scores",
  sanitizeResources: false,
  fn: async () => {
    const file = createSourceFile(
      "custom_format",
      "custom-formats/no-scores.json",
    );
    const discovery = createDiscovery("radarr", {
      custom_format: [file],
    });
    const payload = createCustomFormatPayload(
      "No Scores CF",
      "cccccccccccccccccccccccccccccccc",
    );
    delete payload.trash_scores;

    const restores: Restore[] = [];
    patchReadTextFile(
      {
        [file.absolute_path]: JSON.stringify(payload),
      },
      restores,
    );

    try {
      const result = await parseTrashGuideEntities({
        arr_type: "radarr",
        discovery,
      });

      assertEquals(result.status, "success");
      assertEquals(result.issues.length, 0);
      assertEquals(result.entities.custom_formats.length, 1);
      assertEquals(result.entities.custom_formats[0].scores, {});
    } finally {
      restoreAll(restores);
    }
  },
});

Deno.test({
  name:
    "parseTrashGuideEntities fails on conflicting payloads for the same stable identity",
  sanitizeResources: false,
  fn: async () => {
    const trashId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const fileA = createSourceFile(
      "custom_format",
      "custom-formats/first.json",
    );
    const fileB = createSourceFile(
      "custom_format",
      "custom-formats/second.json",
    );

    const discovery = createDiscovery("radarr", {
      custom_format: [fileA, fileB],
    });

    const fixtures: Record<string, string> = {
      [fileA.absolute_path]: JSON.stringify(
        createCustomFormatPayload("First Name", trashId),
      ),
      [fileB.absolute_path]: JSON.stringify(
        createCustomFormatPayload("Renamed Name", trashId),
      ),
    };

    const restores: Restore[] = [];
    patchReadTextFile(fixtures, restores);

    try {
      const error = await assertRejects(
        () =>
          parseTrashGuideEntities({
            arr_type: "radarr",
            discovery,
          }),
        Error,
      );

      assertStringIncludes(error.message, "TRaSH identity collision detected");
    } finally {
      restoreAll(restores);
    }
  },
});
