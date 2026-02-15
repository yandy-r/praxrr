import { assertEquals } from "@std/assert";
import {
  formatUnknownQualityDefinitionsTypeError,
  QUALITY_DEFINITIONS_MISSING_NAME_ERROR,
  resolveQualityDefinitionsEntityType,
  validateQualityDefinitionsActionInput,
} from "../../routes/media-management/[databaseId]/quality-definitions/validation.ts";

Deno.test("quality-definitions validation: missing name returns deterministic error", () => {
  const result = validateQualityDefinitionsActionInput({
    name: "   ",
    arrType: "lidarr",
    arrTypeLabel: "Lidarr",
  });

  if (result.ok) {
    throw new Error("Expected validation failure for missing name");
  }

  assertEquals(result.error, QUALITY_DEFINITIONS_MISSING_NAME_ERROR);
});

Deno.test("quality-definitions validation: unknown arr type returns deterministic error", () => {
  const result = validateQualityDefinitionsActionInput({
    name: "Config A",
    arrType: "customarr",
    arrTypeLabel: "Customarr",
  });

  if (result.ok) {
    throw new Error("Expected validation failure for unknown arr type");
  }

  assertEquals(
    result.error,
    formatUnknownQualityDefinitionsTypeError("Customarr"),
  );
});

Deno.test("quality-definitions validation: lidarr arr type resolves expected entity type", () => {
  assertEquals(
    resolveQualityDefinitionsEntityType("lidarr"),
    "lidarr_quality_definitions",
  );
});

Deno.test("quality-definitions validation: valid input returns typed success payload", () => {
  const result = validateQualityDefinitionsActionInput({
    name: "  Lidarr Config  ",
    arrType: "lidarr",
    arrTypeLabel: "Lidarr",
  });

  assertEquals(result.ok, true);
  if (!result.ok) {
    throw new Error("Expected validation success");
  }

  assertEquals(result.name, "Lidarr Config");
  assertEquals(result.arrType, "lidarr");
  assertEquals(result.entityType, "lidarr_quality_definitions");
});
