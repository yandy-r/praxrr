-- @operation: export
-- @entity: batch
-- @name: Merge Upscale CFs and Rescore
-- @exportedAt: 2026-01-31T19:49:13.980Z
-- @opIds: 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125

-- --- BEGIN op 95 ( update regular_expression "Upscale" )
update "regular_expressions" set "name" = 'Upscale' where "name" = 'Upscaled';
-- --- END op 95

-- --- BEGIN op 96 ( update custom_format "Upscale" )
update "condition_patterns" set "regular_expression_name" = 'Upscale' where "custom_format_name" = 'Upscale' and "condition_name" = 'Upscaled' and "regular_expression_name" = 'Upscaled';
-- --- END op 96

-- --- BEGIN op 97 ( update custom_format "Upscaled" )
update "condition_patterns" set "regular_expression_name" = 'Upscale' where "custom_format_name" = 'Upscaled' and "condition_name" = 'Upscaled' and "regular_expression_name" = 'Upscaled';
-- --- END op 97

-- --- BEGIN op 98 ( update regular_expression "AI Movie Upscale" )
update "regular_expressions" set "name" = 'AI Movie Upscale' where "name" = 'AI Movies';
-- --- END op 98

-- --- BEGIN op 99 ( update custom_format "Upscale" )
update "condition_patterns" set "regular_expression_name" = 'AI Movie Upscale' where "custom_format_name" = 'Upscale' and "condition_name" = 'AI Movies' and "regular_expression_name" = 'AI Movies';
-- --- END op 99

-- --- BEGIN op 100 ( update regular_expression "AI TV Upscale" )
update "regular_expressions" set "name" = 'AI TV Upscale' where "name" = 'AI TV';
-- --- END op 100

-- --- BEGIN op 101 ( update custom_format "Upscaled" )
update "condition_patterns" set "regular_expression_name" = 'AI TV Upscale' where "custom_format_name" = 'Upscaled' and "condition_name" = 'AI TV' and "regular_expression_name" = 'AI TV';
-- --- END op 101

-- --- BEGIN op 102 ( update quality_profile "1080p Balanced" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '1080p Balanced' and "custom_format_name" = 'Upscaled' and "arr_type" = 'sonarr' and "score" = -999999;
-- --- END op 102

-- --- BEGIN op 103 ( update quality_profile "1080p Compact" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '1080p Compact' and "custom_format_name" = 'Upscaled' and "arr_type" = 'sonarr' and "score" = -999999;
-- --- END op 103

-- --- BEGIN op 104 ( update quality_profile "1080p Efficient" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '1080p Efficient' and "custom_format_name" = 'Upscaled' and "arr_type" = 'sonarr' and "score" = -999999;
-- --- END op 104

-- --- BEGIN op 105 ( update quality_profile "1080p Quality" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '1080p Quality' and "custom_format_name" = 'Upscaled' and "arr_type" = 'sonarr' and "score" = -999999;
-- --- END op 105

-- --- BEGIN op 106 ( update quality_profile "1080p Quality HDR" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '1080p Quality HDR' and "custom_format_name" = 'Upscaled' and "arr_type" = 'sonarr' and "score" = -999999;
-- --- END op 106

-- --- BEGIN op 107 ( update quality_profile "1080p Remux" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '1080p Remux' and "custom_format_name" = 'Upscaled' and "arr_type" = 'sonarr' and "score" = -999999;
-- --- END op 107

-- --- BEGIN op 108 ( update quality_profile "2160p Balanced" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '2160p Balanced' and "custom_format_name" = 'Upscaled' and "arr_type" = 'sonarr' and "score" = -999999;
-- --- END op 108

-- --- BEGIN op 109 ( update quality_profile "2160p Efficient" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '2160p Efficient' and "custom_format_name" = 'Upscaled' and "arr_type" = 'sonarr' and "score" = -999999;
-- --- END op 109

-- --- BEGIN op 110 ( update quality_profile "2160p Quality" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '2160p Quality' and "custom_format_name" = 'Upscaled' and "arr_type" = 'sonarr' and "score" = -999999;
-- --- END op 110

-- --- BEGIN op 111 ( update quality_profile "2160p Remux" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '2160p Remux' and "custom_format_name" = 'Upscaled' and "arr_type" = 'sonarr' and "score" = -999999;
-- --- END op 111

-- --- BEGIN op 112 ( update quality_profile "720p Quality" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '720p Quality' and "custom_format_name" = 'Upscaled' and "arr_type" = 'sonarr' and "score" = -999999;
-- --- END op 112

-- --- BEGIN op 113 ( delete custom_format "Upscaled" )
delete from "custom_formats" where "name" = 'Upscaled';
-- --- END op 113

-- --- BEGIN op 114 ( update custom_format "Upscale" )
DELETE FROM custom_format_conditions
WHERE custom_format_name = 'Upscale'
  AND name = 'AI Movies'
  AND type = 'release_title'
  AND arr_type = 'all'
  AND negate = 0
  AND required = 0;

DELETE FROM custom_format_conditions
WHERE custom_format_name = 'Upscale'
  AND name = 'Upscaled'
  AND type = 'release_title'
  AND arr_type = 'all'
  AND negate = 0
  AND required = 0;

INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('Upscale', 'AI Movies Upscale', 'release_title', 'radarr', 0, 0);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES ('Upscale', 'AI Movies Upscale', 'AI Movie Upscale');

INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('Upscale', 'Upscale', 'release_title', 'all', 0, 0);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES ('Upscale', 'Upscale', 'Upscale');

INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('Upscale', 'AI TV Upscale', 'release_title', 'sonarr', 0, 0);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES ('Upscale', 'AI TV Upscale', 'AI TV Upscale');
-- --- END op 114

-- --- BEGIN op 115 ( update quality_profile "1080p Balanced" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Balanced', 'Upscale', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Balanced'
    AND custom_format_name = 'Upscale'
    AND arr_type = 'sonarr'
);
-- --- END op 115

-- --- BEGIN op 116 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Compact', 'Upscale', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Compact'
    AND custom_format_name = 'Upscale'
    AND arr_type = 'sonarr'
);
-- --- END op 116

-- --- BEGIN op 117 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', 'Upscale', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = 'Upscale'
    AND arr_type = 'sonarr'
);
-- --- END op 117

-- --- BEGIN op 118 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Quality', 'Upscale', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Quality'
    AND custom_format_name = 'Upscale'
    AND arr_type = 'sonarr'
);
-- --- END op 118

-- --- BEGIN op 119 ( update quality_profile "1080p Quality HDR" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Quality HDR', 'Upscale', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Quality HDR'
    AND custom_format_name = 'Upscale'
    AND arr_type = 'sonarr'
);
-- --- END op 119

-- --- BEGIN op 120 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Remux', 'Upscale', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Remux'
    AND custom_format_name = 'Upscale'
    AND arr_type = 'sonarr'
);
-- --- END op 120

-- --- BEGIN op 121 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Balanced', 'Upscale', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Balanced'
    AND custom_format_name = 'Upscale'
    AND arr_type = 'sonarr'
);
-- --- END op 121

-- --- BEGIN op 122 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', 'Upscale', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = 'Upscale'
    AND arr_type = 'sonarr'
);
-- --- END op 122

-- --- BEGIN op 123 ( update quality_profile "2160p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Quality', 'Upscale', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Quality'
    AND custom_format_name = 'Upscale'
    AND arr_type = 'sonarr'
);
-- --- END op 123

-- --- BEGIN op 124 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Remux', 'Upscale', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Remux'
    AND custom_format_name = 'Upscale'
    AND arr_type = 'sonarr'
);
-- --- END op 124

-- --- BEGIN op 125 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', 'Upscale', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = 'Upscale'
    AND arr_type = 'sonarr'
);
-- --- END op 125
