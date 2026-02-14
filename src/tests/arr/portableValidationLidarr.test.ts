import { assertEquals } from "@std/assert";
import { validatePortableData } from "$pcd/entities/validate.ts";

Deno.test("validatePortableData: accepts valid lidarr_naming payload", () => {
  const result = validatePortableData("lidarr_naming", {
    name: "Lidarr Default",
    rename: true,
    standardEpisodeFormat: "{Artist Name} - {Album Title}",
    dailyEpisodeFormat: "{Artist Name} - {Album Title}",
    animeEpisodeFormat: "{Artist Name} - {Album Title}",
    seriesFolderFormat: "{Artist Name}",
    seasonFolderFormat: "{Release Year}",
    replaceIllegalCharacters: true,
    colonReplacementFormat: "dash",
    customColonReplacementFormat: null,
    multiEpisodeStyle: "extend",
  });

  assertEquals(result, null);
});

Deno.test("validatePortableData: accepts valid lidarr_media_settings payload", () => {
  const result = validatePortableData("lidarr_media_settings", {
    name: "Lidarr Media",
    propersRepacks: "preferAndUpgrade",
    enableMediaInfo: true,
  });

  assertEquals(result, null);
});

Deno.test("validatePortableData: rejects legacy snake_case lidarr_media_settings propersRepacks values", () => {
  const result = validatePortableData("lidarr_media_settings", {
    name: "Lidarr Media",
    propersRepacks: "prefer_and_upgrade",
    enableMediaInfo: true,
  });

  assertEquals(
    result,
    "data.propersRepacks must be one of: doNotPrefer, preferAndUpgrade, doNotUpgradeAutomatically",
  );
});

Deno.test("validatePortableData: accepts valid lidarr_quality_definitions payload", () => {
  const result = validatePortableData("lidarr_quality_definitions", {
    name: "Lidarr Quality",
    entries: [
      {
        quality_name: "FLAC",
        min_size: 10,
        max_size: 100,
        preferred_size: 50,
      },
    ],
  });

  assertEquals(result, null);
});

Deno.test("validatePortableData: rejects mixed lidarr_naming payloads with Radarr fields", () => {
  const result = validatePortableData("lidarr_naming", {
    name: "Invalid Lidarr Naming",
    rename: true,
    standardEpisodeFormat: "{Artist Name} - {Album Title}",
    dailyEpisodeFormat: "{Artist Name} - {Album Title}",
    animeEpisodeFormat: "{Artist Name} - {Album Title}",
    seriesFolderFormat: "{Artist Name}",
    seasonFolderFormat: "{Release Year}",
    replaceIllegalCharacters: true,
    colonReplacementFormat: "dash",
    customColonReplacementFormat: null,
    multiEpisodeStyle: "extend",
    movieFormat: "{Movie Title}",
    movieFolderFormat: "{Movie Title}",
  });

  assertEquals(
    result,
    "Mixed payload for lidarr_naming: unsupported fields from another model: movieFolderFormat, movieFormat",
  );
});

Deno.test("validatePortableData: rejects lidarr_media_settings payload missing required fields", () => {
  const result = validatePortableData("lidarr_media_settings", {
    name: "Invalid Lidarr Media",
    propersRepacks: "preferAndUpgrade",
  });

  assertEquals(
    result,
    "Unsupported payload for lidarr_media_settings: missing required fields: enableMediaInfo",
  );
});

Deno.test("validatePortableData: rejects lidarr_quality_definitions payload with unsupported fields", () => {
  const result = validatePortableData("lidarr_quality_definitions", {
    name: "Invalid Lidarr Quality",
    entries: [],
    standardEpisodeFormat: "{Artist Name} - {Album Title}",
  });

  assertEquals(
    result,
    "Unsupported payload for lidarr_quality_definitions: unsupported fields: standardEpisodeFormat",
  );
});

Deno.test("validatePortableData: preserves non-Lidarr validation behavior", () => {
  const result = validatePortableData("radarr_naming", {
    name: "Radarr Default",
    rename: true,
    movieFormat: "{Movie Title}",
    movieFolderFormat: "{Movie Title}",
    replaceIllegalCharacters: true,
    colonReplacementFormat: "dash",
    extraNonPortableField: "kept for backward-compat behavior",
  });

  assertEquals(result, null);
});
