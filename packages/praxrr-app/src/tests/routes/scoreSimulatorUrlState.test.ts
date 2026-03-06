import { assert, assertEquals, assertExists } from "@std/assert";
import {
  copyShareLink,
  parseUrlState,
  serializeUrlState,
  type SimulatorUrlState,
} from "../../routes/score-simulator/[databaseId]/urlState.ts";

function encodeJson(value: unknown): string {
  return btoa(JSON.stringify(value));
}

function buildLongOverrides(size: number): Record<string, number> {
  const overrides: Record<string, number> = {};
  for (let index = 0; index < size; index++) {
    overrides[`custom-format-${index}`] = index;
  }
  return overrides;
}

async function withMockClipboard(
  run: (writes: string[]) => Promise<void>,
): Promise<void> {
  const writes: string[] = [];
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );

  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: (value: string): Promise<void> => {
        writes.push(value);
        return Promise.resolve();
      },
    },
    configurable: true,
  });

  try {
    await run(writes);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(navigator, "clipboard", originalDescriptor);
    }
  }
}

Deno.test("parseUrlState returns undefined fields for empty params", () => {
  assertEquals(parseUrlState(new URLSearchParams()), {
    title: undefined,
    mediaType: undefined,
    profile: undefined,
    compare: undefined,
    arrType: undefined,
    batch: undefined,
    batchMediaType: undefined,
    overrides: undefined,
  });
});

Deno.test("parseUrlState parses simple params and ignores unknown params", () => {
  const params = new URLSearchParams({
    title: "Release.2025.1080p",
    mediaType: "movie",
    profile: "pcd:main profile",
    arrType: "radarr",
    unknown: "ignore-me",
  });

  assertEquals(parseUrlState(params), {
    title: "Release.2025.1080p",
    mediaType: "movie",
    profile: "pcd:main profile",
    compare: undefined,
    arrType: "radarr",
    batch: undefined,
    batchMediaType: undefined,
    overrides: undefined,
  });
});

Deno.test("parseUrlState validates mediaType and arrType values", () => {
  assertEquals(
    parseUrlState(new URLSearchParams({ mediaType: "movie" })).mediaType,
    "movie",
  );
  assertEquals(
    parseUrlState(new URLSearchParams({ mediaType: "series" })).mediaType,
    "series",
  );
  assertEquals(
    parseUrlState(new URLSearchParams({ mediaType: "anime" })).mediaType,
    undefined,
  );
  assertEquals(
    parseUrlState(new URLSearchParams({ arrType: "radarr" })).arrType,
    "radarr",
  );
  assertEquals(
    parseUrlState(new URLSearchParams({ arrType: "sonarr" })).arrType,
    "sonarr",
  );
  assertEquals(
    parseUrlState(new URLSearchParams({ arrType: "lidarr" })).arrType,
    undefined,
  );
});

Deno.test("parseUrlState treats empty string params as absent", () => {
  const params = new URLSearchParams({
    title: "",
    mediaType: "",
    profile: "",
    compare: "",
    arrType: "",
    batch: "",
    batchMediaType: "",
    overrides: "",
  });

  assertEquals(parseUrlState(params), {
    title: undefined,
    mediaType: undefined,
    profile: undefined,
    compare: undefined,
    arrType: undefined,
    batch: undefined,
    batchMediaType: undefined,
    overrides: undefined,
  });
});

Deno.test("parseUrlState decodes valid batch arrays", () => {
  const batch = ["one", "two", "three"];
  const params = new URLSearchParams({ batch: encodeJson(batch) });
  assertEquals(parseUrlState(params).batch, batch);
});

Deno.test("parseUrlState returns undefined for malformed batch base64", () => {
  const params = new URLSearchParams({ batch: "%%%not-base64%%%" });
  assertEquals(parseUrlState(params).batch, undefined);
});

Deno.test("parseUrlState returns undefined for batch values that are not valid JSON arrays", () => {
  const invalidJsonParams = new URLSearchParams({
    batch: btoa("{invalid-json"),
  });
  assertEquals(parseUrlState(invalidJsonParams).batch, undefined);

  const notArrayParams = new URLSearchParams({
    batch: encodeJson({ title: "nope" }),
  });
  assertEquals(parseUrlState(notArrayParams).batch, undefined);
});

Deno.test("parseUrlState decodes overrides, rounds values, and filters non-finite values", () => {
  const params = new URLSearchParams({
    overrides: btoa('{"keep":4.6,"dropPositive":1e309,"dropNegative":-1e309}'),
  });

  assertEquals(parseUrlState(params).overrides, { keep: 5 });
});

Deno.test("parseUrlState returns undefined for malformed overrides base64", () => {
  const params = new URLSearchParams({ overrides: "***bad-base64***" });
  assertEquals(parseUrlState(params).overrides, undefined);
});

Deno.test("serializeUrlState serializes full state", () => {
  const state: SimulatorUrlState = {
    title: "Release.2025",
    mediaType: "movie",
    profile: "pcd:alpha profile",
    compare: "pcd:beta profile",
    arrType: "radarr",
    batch: ["A", "B"],
    batchMediaType: "series",
    overrides: { CF_A: 10, CF_B: 20 },
  };

  const params = serializeUrlState(state);

  assertEquals(params.get("title"), "Release.2025");
  assertEquals(params.get("mediaType"), "movie");
  assertEquals(params.get("profile"), "pcd:alpha profile");
  assertEquals(params.get("compare"), "pcd:beta profile");
  assertEquals(params.get("arrType"), "radarr");
  assertEquals(JSON.parse(atob(params.get("batch") ?? "null")), ["A", "B"]);
  assertEquals(params.get("batchMediaType"), "series");
  assertEquals(JSON.parse(atob(params.get("overrides") ?? "null")), {
    CF_A: 10,
    CF_B: 20,
  });
});

Deno.test("serializeUrlState omits undefined and empty values", () => {
  const params = serializeUrlState({
    title: "",
    profile: undefined,
    compare: "",
    mediaType: undefined,
    arrType: undefined,
    batch: [],
    batchMediaType: undefined,
    overrides: {},
  });

  assertEquals(params.toString(), "");
});

Deno.test("serializeUrlState rounds override values and omits non-finite values", () => {
  const params = serializeUrlState({
    overrides: {
      rounded: 4.5,
      noInfinity: Number.POSITIVE_INFINITY,
      noNaN: Number.NaN,
    },
  });

  assertEquals(JSON.parse(atob(params.get("overrides") ?? "null")), {
    rounded: 5,
  });
});

Deno.test("parse/serialize round-trip preserves full state", () => {
  const original: SimulatorUrlState = {
    title: "Release.2026.2160p",
    mediaType: "movie",
    profile: "pcd:alpha",
    compare: "pcd:beta",
    arrType: "sonarr",
    batch: ["One.Title", "Two.Title"],
    batchMediaType: "series",
    overrides: { CF_A: 5, CF_B: -10 },
  };

  const roundTrip = parseUrlState(serializeUrlState(original));
  assertEquals(roundTrip, original);
});

Deno.test("parse/serialize round-trip preserves profile names with spaces, colons, and unicode", () => {
  const withSpaces = parseUrlState(
    serializeUrlState({ profile: "pcd:profile with spaces" }),
  );
  assertEquals(withSpaces.profile, "pcd:profile with spaces");

  const withColons = parseUrlState(
    serializeUrlState({ profile: "trash:1234:HDR:DV" }),
  );
  assertEquals(withColons.profile, "trash:1234:HDR:DV");

  const withUnicode = parseUrlState(
    serializeUrlState({ profile: "プロファイル:éxample" }),
  );
  assertEquals(withUnicode.profile, "プロファイル:éxample");
});

Deno.test("copyShareLink drops overrides first when URL exceeds max length", async () => {
  await withMockClipboard(async (writes) => {
    const result = await copyShareLink(
      {
        title: "short-title",
        mediaType: "movie",
        batch: ["batch title"],
        overrides: buildLongOverrides(250),
      },
      "https://example.test/score-simulator/db-1",
    );

    assertEquals(result.success, true);
    assertEquals(result.truncated, true);
    assertEquals(writes.length, 1);

    const shareUrl = new URL(writes[0]);
    assertEquals(shareUrl.searchParams.has("overrides"), false);
    assertEquals(shareUrl.searchParams.has("batch"), true);
  });
});

Deno.test("copyShareLink drops batch after overrides when URL is still too long", async () => {
  await withMockClipboard(async (writes) => {
    const result = await copyShareLink(
      {
        title: "short-title",
        mediaType: "movie",
        batch: Array.from(
          { length: 120 },
          (_, i) => `very-long-batch-title-${i}-${"x".repeat(30)}`,
        ),
        overrides: buildLongOverrides(250),
      },
      "https://example.test/score-simulator/db-1",
    );

    assertEquals(result.success, true);
    assertEquals(result.truncated, true);
    assertEquals(writes.length, 1);

    const shareUrl = new URL(writes[0]);
    assertEquals(shareUrl.searchParams.has("overrides"), false);
    assertEquals(shareUrl.searchParams.has("batch"), false);
    assert(shareUrl.toString().includes("mediaType=movie"));
    assertExists(shareUrl.searchParams.get("title"));
  });
});
