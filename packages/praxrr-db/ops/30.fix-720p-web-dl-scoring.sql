-- @operation: export
-- @entity: batch
-- @name: Rebalance 720p WEB-DL Scoring
-- @exportedAt: 2026-02-09T00:03:19.180Z
-- @opIds: 1251, 1252, 1253, 1254, 1255, 1256, 1257, 1258, 1259, 1260, 1261, 1262, 1263, 1264, 1265, 1266

-- --- BEGIN op 1251 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_custom_formats
SET score = 480000
WHERE quality_profile_name = '1080p Balanced'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'radarr'
  AND score = 580000;
-- --- END op 1251

-- --- BEGIN op 1252 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_custom_formats
SET score = 480000
WHERE quality_profile_name = '1080p Balanced'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'sonarr'
  AND score = 580000;
-- --- END op 1252

-- --- BEGIN op 1253 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Compact', '720p WEB-DL', 'radarr', 480000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Compact'
    AND custom_format_name = '720p WEB-DL'
    AND arr_type = 'radarr'
);
-- --- END op 1253

-- --- BEGIN op 1254 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Compact', '720p WEB-DL', 'sonarr', 480000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Compact'
    AND custom_format_name = '720p WEB-DL'
    AND arr_type = 'sonarr'
);
-- --- END op 1254

-- --- BEGIN op 1255 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 480000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'radarr'
  AND score = 580000;
-- --- END op 1255

-- --- BEGIN op 1256 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 480000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'sonarr'
  AND score = 580000;
-- --- END op 1256

-- --- BEGIN op 1257 ( update quality_profile "1080p Quality" )
UPDATE quality_profile_custom_formats
SET score = 480000
WHERE quality_profile_name = '1080p Quality'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'radarr'
  AND score = 580000;
-- --- END op 1257

-- --- BEGIN op 1258 ( update quality_profile "1080p Quality" )
UPDATE quality_profile_custom_formats
SET score = 480000
WHERE quality_profile_name = '1080p Quality'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'sonarr'
  AND score = 580000;
-- --- END op 1258

-- --- BEGIN op 1259 ( update quality_profile "1080p Quality HDR" )
UPDATE quality_profile_custom_formats
SET score = 480000
WHERE quality_profile_name = '1080p Quality HDR'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'radarr'
  AND score = 580000;
-- --- END op 1259

-- --- BEGIN op 1260 ( update quality_profile "1080p Quality HDR" )
UPDATE quality_profile_custom_formats
SET score = 480000
WHERE quality_profile_name = '1080p Quality HDR'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'sonarr'
  AND score = 580000;
-- --- END op 1260

-- --- BEGIN op 1261 ( update quality_profile "2160p Balanced" )
UPDATE quality_profile_custom_formats
SET score = 480000
WHERE quality_profile_name = '2160p Balanced'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'radarr'
  AND score = 580000;
-- --- END op 1261

-- --- BEGIN op 1262 ( update quality_profile "2160p Balanced" )
UPDATE quality_profile_custom_formats
SET score = 480000
WHERE quality_profile_name = '2160p Balanced'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'sonarr'
  AND score = 580000;
-- --- END op 1262

-- --- BEGIN op 1263 ( update quality_profile "2160p Quality" )
UPDATE quality_profile_custom_formats
SET score = 480000
WHERE quality_profile_name = '2160p Quality'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'radarr'
  AND score = 580000;
-- --- END op 1263

-- --- BEGIN op 1264 ( update quality_profile "2160p Quality" )
UPDATE quality_profile_custom_formats
SET score = 480000
WHERE quality_profile_name = '2160p Quality'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'sonarr'
  AND score = 580000;
-- --- END op 1264

-- --- BEGIN op 1265 ( update quality_profile "720p Quality" )
UPDATE quality_profile_custom_formats
SET score = 480000
WHERE quality_profile_name = '720p Quality'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'radarr'
  AND score = 580000;
-- --- END op 1265

-- --- BEGIN op 1266 ( update quality_profile "720p Quality" )
UPDATE quality_profile_custom_formats
SET score = 480000
WHERE quality_profile_name = '720p Quality'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'sonarr'
  AND score = 580000;
-- --- END op 1266
