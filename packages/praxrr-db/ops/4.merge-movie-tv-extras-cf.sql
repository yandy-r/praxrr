-- @operation: export
-- @entity: batch
-- @name: Merge Movie / TV Extras CF
-- @exportedAt: 2026-01-31T19:08:46.933Z
-- @opIds: 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65

-- --- BEGIN op 52 ( update regular_expression "Movie Extras" )
update "regular_expressions" set "name" = 'Movie Extras' where "name" = 'Extras';
-- --- END op 52

-- --- BEGIN op 53 ( update custom_format "Extras" )
update "condition_patterns" set "regular_expression_name" = 'Movie Extras' where "custom_format_name" = 'Extras' and "condition_name" = 'Extras' and "regular_expression_name" = 'Extras';
-- --- END op 53

-- --- BEGIN op 54 ( update custom_format "Extras" )
DELETE FROM custom_format_conditions
WHERE custom_format_name = 'Extras'
  AND name = 'Extras'
  AND type = 'release_title'
  AND arr_type = 'all'
  AND negate = 0
  AND required = 1;

INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('Extras', 'Movie Extras', 'release_title', 'radarr', 0, 1);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES ('Extras', 'Movie Extras', 'Movie Extras');

INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('Extras', 'TV Extras', 'release_title', 'sonarr', 0, 1);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES ('Extras', 'TV Extras', 'TV Extras');
-- --- END op 54

-- --- BEGIN op 55 ( update quality_profile "1080p Balanced" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Balanced', 'Extras', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Balanced'
    AND custom_format_name = 'Extras'
    AND arr_type = 'sonarr'
);

DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Balanced'
  AND custom_format_name = 'TV Extras'
  AND arr_type = 'sonarr'
  AND score = -999999;
-- --- END op 55

-- --- BEGIN op 56 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', 'Extras', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = 'Extras'
    AND arr_type = 'sonarr'
);

DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = 'TV Extras'
  AND arr_type = 'sonarr'
  AND score = -999999;
-- --- END op 56

-- --- BEGIN op 57 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Quality', 'Extras', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Quality'
    AND custom_format_name = 'Extras'
    AND arr_type = 'sonarr'
);

DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Quality'
  AND custom_format_name = 'TV Extras'
  AND arr_type = 'sonarr'
  AND score = -999999;
-- --- END op 57

-- --- BEGIN op 58 ( update quality_profile "1080p Quality HDR" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Quality HDR', 'Extras', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Quality HDR'
    AND custom_format_name = 'Extras'
    AND arr_type = 'sonarr'
);

DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Quality HDR'
  AND custom_format_name = 'TV Extras'
  AND arr_type = 'sonarr'
  AND score = -999999;
-- --- END op 58

-- --- BEGIN op 59 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Remux', 'Extras', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Remux'
    AND custom_format_name = 'Extras'
    AND arr_type = 'sonarr'
);

DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Remux'
  AND custom_format_name = 'TV Extras'
  AND arr_type = 'sonarr'
  AND score = -999999;
-- --- END op 59

-- --- BEGIN op 60 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Balanced', 'Extras', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Balanced'
    AND custom_format_name = 'Extras'
    AND arr_type = 'sonarr'
);

DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '2160p Balanced'
  AND custom_format_name = 'TV Extras'
  AND arr_type = 'sonarr'
  AND score = -999999;
-- --- END op 60

-- --- BEGIN op 61 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', 'Extras', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = 'Extras'
    AND arr_type = 'sonarr'
);

DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = 'TV Extras'
  AND arr_type = 'sonarr'
  AND score = -999999;
-- --- END op 61

-- --- BEGIN op 62 ( update quality_profile "2160p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Quality', 'Extras', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Quality'
    AND custom_format_name = 'Extras'
    AND arr_type = 'sonarr'
);

DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '2160p Quality'
  AND custom_format_name = 'TV Extras'
  AND arr_type = 'sonarr'
  AND score = -999999;
-- --- END op 62

-- --- BEGIN op 63 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Remux', 'Extras', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Remux'
    AND custom_format_name = 'Extras'
    AND arr_type = 'sonarr'
);

DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '2160p Remux'
  AND custom_format_name = 'TV Extras'
  AND arr_type = 'sonarr'
  AND score = -999999;
-- --- END op 63

-- --- BEGIN op 64 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', 'Extras', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = 'Extras'
    AND arr_type = 'sonarr'
);

DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '720p Quality'
  AND custom_format_name = 'TV Extras'
  AND arr_type = 'sonarr'
  AND score = -999999;
-- --- END op 64

-- --- BEGIN op 65 ( delete custom_format "TV Extras" )
delete from "custom_formats" where "name" = 'TV Extras';
-- --- END op 65
