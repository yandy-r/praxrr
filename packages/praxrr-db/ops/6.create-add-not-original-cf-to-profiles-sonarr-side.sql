-- @operation: export
-- @entity: batch
-- @name: Create / Add Not Original CF to Profiles Sonarr Side
-- @exportedAt: 2026-01-31T19:26:40.749Z
-- @opIds: 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85

-- --- BEGIN op 71 ( create custom_format "Not Original" )
insert into "custom_formats" ("name", "description", "include_in_rename") values ('Not Original', NULL, 0);
-- --- END op 71

-- --- BEGIN op 72 ( update custom_format "Not Original" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('Not Original', 'Not Original', 'language', 'sonarr', 0, 1);

INSERT INTO condition_languages (custom_format_name, condition_name, language_name, except_language) VALUES ('Not Original', 'Not Original', 'Original', 1);
-- --- END op 72

-- --- BEGIN op 73 ( update custom_format "Not Original" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('Not Original', 'Original', 'language', 'sonarr', 1, 1);

INSERT INTO condition_languages (custom_format_name, condition_name, language_name, except_language) VALUES ('Not Original', 'Original', 'Original', 0);
-- --- END op 73

-- --- BEGIN op 74 ( update quality_profile "1080p Balanced" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Balanced', 'Not Original', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Balanced'
    AND custom_format_name = 'Not Original'
    AND arr_type = 'sonarr'
);
-- --- END op 74

-- --- BEGIN op 75 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Compact', 'Not Original', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Compact'
    AND custom_format_name = 'Not Original'
    AND arr_type = 'sonarr'
);
-- --- END op 75

-- --- BEGIN op 76 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', 'Not Original', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = 'Not Original'
    AND arr_type = 'sonarr'
);
-- --- END op 76

-- --- BEGIN op 77 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Quality', 'Not Original', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Quality'
    AND custom_format_name = 'Not Original'
    AND arr_type = 'sonarr'
);
-- --- END op 77

-- --- BEGIN op 78 ( update quality_profile "1080p Quality HDR" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Quality HDR', 'Not Original', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Quality HDR'
    AND custom_format_name = 'Not Original'
    AND arr_type = 'sonarr'
);
-- --- END op 78

-- --- BEGIN op 79 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Remux', 'Not Original', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Remux'
    AND custom_format_name = 'Not Original'
    AND arr_type = 'sonarr'
);
-- --- END op 79

-- --- BEGIN op 80 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Balanced', 'Not Original', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Balanced'
    AND custom_format_name = 'Not Original'
    AND arr_type = 'sonarr'
);
-- --- END op 80

-- --- BEGIN op 81 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', 'Not Original', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = 'Not Original'
    AND arr_type = 'sonarr'
);
-- --- END op 81

-- --- BEGIN op 82 ( update quality_profile "2160p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Quality', 'Not Original', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Quality'
    AND custom_format_name = 'Not Original'
    AND arr_type = 'sonarr'
);
-- --- END op 82

-- --- BEGIN op 83 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Remux', 'Not Original', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Remux'
    AND custom_format_name = 'Not Original'
    AND arr_type = 'sonarr'
);
-- --- END op 83

-- --- BEGIN op 84 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', 'Not Original', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = 'Not Original'
    AND arr_type = 'sonarr'
);
-- --- END op 84

-- --- BEGIN op 85 ( update custom_format "Not Original" )
UPDATE custom_format_conditions
SET arr_type = 'all'
WHERE custom_format_name = 'Not Original'
  AND name = 'Not Original'
  AND type = 'language'
  AND arr_type = 'sonarr'
  AND negate = 0
  AND required = 1;

UPDATE custom_format_conditions
SET arr_type = 'all'
WHERE custom_format_name = 'Not Original'
  AND name = 'Original'
  AND type = 'language'
  AND arr_type = 'sonarr'
  AND negate = 1
  AND required = 1;
-- --- END op 85
