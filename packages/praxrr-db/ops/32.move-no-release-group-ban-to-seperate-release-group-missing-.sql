-- @operation: export
-- @entity: batch
-- @name: Move No Release Group Ban to Seperate Release Group (Missing) CF and Negate DVD/HDTV to account for Sources common to No Release Group
-- @exportedAt: 2026-02-09T00:48:26.006Z
-- @opIds: 1395, 1396, 1397, 1398, 1399, 1400, 1401, 1402, 1403, 1404, 1405, 1406, 1407, 1408, 1409, 1410, 1411, 1412, 1413, 1414, 1415, 1416, 1417, 1418

-- --- BEGIN op 1395 ( update custom_format "Banned Groups" )
DELETE FROM custom_format_conditions
	WHERE custom_format_name = 'Banned Groups'
	  AND name = 'Release Group (Missing)'
	  AND type = 'release_group'
	  AND arr_type = 'all'
	  AND negate = 1
	  AND required = 0;
-- --- END op 1395

-- --- BEGIN op 1396 ( create custom_format "No Release Group" )
insert into "custom_formats" ("name", "description") values ('No Release Group', '');
-- --- END op 1396

-- --- BEGIN op 1397 ( update custom_format "No Release Group" )
update "custom_formats" set "description" = 'Matches releases with no group. Common Sources with no release group are negated' where "name" = 'No Release Group' and "description" = '';
-- --- END op 1397

-- --- BEGIN op 1398 ( update custom_format "No Release Group" )
insert into "tags" ("name") values ('Banned') on conflict ("name") do nothing;

insert into "custom_format_tags" ("custom_format_name", "tag_name") values ('No Release Group', 'Banned');

insert into "tags" ("name") values ('Release Group') on conflict ("name") do nothing;

insert into "custom_format_tags" ("custom_format_name", "tag_name") values ('No Release Group', 'Release Group');
-- --- END op 1398

-- --- BEGIN op 1399 ( update custom_format "No Release Group" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('No Release Group', 'Release Group (Missing)', 'release_title', 'all', 1, 0);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES ('No Release Group', 'Release Group (Missing)', 'Release Group (Missing)');
-- --- END op 1399

-- --- BEGIN op 1400 ( update custom_format "Release Group (Missing)" )
update "custom_formats" set "name" = 'Release Group (Missing)' where "name" = 'No Release Group';
-- --- END op 1400

-- --- BEGIN op 1401 ( update custom_format "Release Group (Missing)" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('Release Group (Missing)', 'HDTV', 'source', 'all', 1, 0);

INSERT INTO condition_sources (custom_format_name, condition_name, source) VALUES ('Release Group (Missing)', 'HDTV', 'television');
-- --- END op 1401

-- --- BEGIN op 1402 ( update custom_format "Release Group (Missing)" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('Release Group (Missing)', 'DVD', 'source', 'all', 1, 0);

INSERT INTO condition_sources (custom_format_name, condition_name, source) VALUES ('Release Group (Missing)', 'DVD', 'dvd');
-- --- END op 1402

-- --- BEGIN op 1403 ( update quality_profile "1080p Balanced" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Balanced', 'Release Group (Missing)', 'radarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Balanced'
    AND custom_format_name = 'Release Group (Missing)'
    AND arr_type = 'radarr'
);
-- --- END op 1403

-- --- BEGIN op 1404 ( update quality_profile "1080p Balanced" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Balanced', 'Release Group (Missing)', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Balanced'
    AND custom_format_name = 'Release Group (Missing)'
    AND arr_type = 'sonarr'
);
-- --- END op 1404

-- --- BEGIN op 1405 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Quality', 'Release Group (Missing)', 'radarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Quality'
    AND custom_format_name = 'Release Group (Missing)'
    AND arr_type = 'radarr'
);
-- --- END op 1405

-- --- BEGIN op 1406 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Quality', 'Release Group (Missing)', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Quality'
    AND custom_format_name = 'Release Group (Missing)'
    AND arr_type = 'sonarr'
);
-- --- END op 1406

-- --- BEGIN op 1407 ( update quality_profile "1080p Quality HDR" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Quality HDR', 'Release Group (Missing)', 'radarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Quality HDR'
    AND custom_format_name = 'Release Group (Missing)'
    AND arr_type = 'radarr'
);
-- --- END op 1407

-- --- BEGIN op 1408 ( update quality_profile "1080p Quality HDR" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Quality HDR', 'Release Group (Missing)', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Quality HDR'
    AND custom_format_name = 'Release Group (Missing)'
    AND arr_type = 'sonarr'
);
-- --- END op 1408

-- --- BEGIN op 1409 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Remux', 'Release Group (Missing)', 'radarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Remux'
    AND custom_format_name = 'Release Group (Missing)'
    AND arr_type = 'radarr'
);
-- --- END op 1409

-- --- BEGIN op 1410 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Remux', 'Release Group (Missing)', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Remux'
    AND custom_format_name = 'Release Group (Missing)'
    AND arr_type = 'sonarr'
);
-- --- END op 1410

-- --- BEGIN op 1411 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Balanced', 'Release Group (Missing)', 'radarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Balanced'
    AND custom_format_name = 'Release Group (Missing)'
    AND arr_type = 'radarr'
);
-- --- END op 1411

-- --- BEGIN op 1412 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Balanced', 'Release Group (Missing)', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Balanced'
    AND custom_format_name = 'Release Group (Missing)'
    AND arr_type = 'sonarr'
);
-- --- END op 1412

-- --- BEGIN op 1413 ( update quality_profile "2160p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Quality', 'Release Group (Missing)', 'radarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Quality'
    AND custom_format_name = 'Release Group (Missing)'
    AND arr_type = 'radarr'
);
-- --- END op 1413

-- --- BEGIN op 1414 ( update quality_profile "2160p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Quality', 'Release Group (Missing)', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Quality'
    AND custom_format_name = 'Release Group (Missing)'
    AND arr_type = 'sonarr'
);
-- --- END op 1414

-- --- BEGIN op 1415 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Remux', 'Release Group (Missing)', 'radarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Remux'
    AND custom_format_name = 'Release Group (Missing)'
    AND arr_type = 'radarr'
);
-- --- END op 1415

-- --- BEGIN op 1416 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Remux', 'Release Group (Missing)', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Remux'
    AND custom_format_name = 'Release Group (Missing)'
    AND arr_type = 'sonarr'
);
-- --- END op 1416

-- --- BEGIN op 1417 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', 'Release Group (Missing)', 'radarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = 'Release Group (Missing)'
    AND arr_type = 'radarr'
);
-- --- END op 1417

-- --- BEGIN op 1418 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', 'Release Group (Missing)', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = 'Release Group (Missing)'
    AND arr_type = 'sonarr'
);
-- --- END op 1418
