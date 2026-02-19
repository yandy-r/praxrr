-- @operation: export
-- @entity: batch
-- @name: Fix 720p WEB-DL Scoring
-- @exportedAt: 2026-02-08T23:59:04.024Z
-- @opIds: 1238, 1239, 1240, 1241, 1242, 1243, 1244, 1245, 1246, 1247, 1248, 1249

-- --- BEGIN op 1238 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_custom_formats
SET score = 580000
WHERE quality_profile_name = '1080p Balanced'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'radarr'
  AND score = 560000;
-- --- END op 1238

-- --- BEGIN op 1239 ( update quality_profile "1080p Balanced" )
UPDATE quality_profile_custom_formats
SET score = 580000
WHERE quality_profile_name = '1080p Balanced'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'sonarr'
  AND score = 560000;
-- --- END op 1239

-- --- BEGIN op 1240 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 580000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'radarr'
  AND score = 560000;
-- --- END op 1240

-- --- BEGIN op 1241 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 580000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'sonarr'
  AND score = 560000;
-- --- END op 1241

-- --- BEGIN op 1242 ( update quality_profile "1080p Quality" )
UPDATE quality_profile_custom_formats
SET score = 580000
WHERE quality_profile_name = '1080p Quality'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'radarr'
  AND score = 560000;
-- --- END op 1242

-- --- BEGIN op 1243 ( update quality_profile "1080p Quality" )
UPDATE quality_profile_custom_formats
SET score = 580000
WHERE quality_profile_name = '1080p Quality'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'sonarr'
  AND score = 560000;
-- --- END op 1243

-- --- BEGIN op 1244 ( update quality_profile "1080p Quality HDR" )
UPDATE quality_profile_custom_formats
SET score = 580000
WHERE quality_profile_name = '1080p Quality HDR'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'radarr'
  AND score = 560000;
-- --- END op 1244

-- --- BEGIN op 1245 ( update quality_profile "1080p Quality HDR" )
UPDATE quality_profile_custom_formats
SET score = 580000
WHERE quality_profile_name = '1080p Quality HDR'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'sonarr'
  AND score = 560000;
-- --- END op 1245

-- --- BEGIN op 1246 ( update quality_profile "2160p Balanced" )
UPDATE quality_profile_custom_formats
SET score = 580000
WHERE quality_profile_name = '2160p Balanced'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'radarr'
  AND score = 560000;
-- --- END op 1246

-- --- BEGIN op 1247 ( update quality_profile "2160p Balanced" )
UPDATE quality_profile_custom_formats
SET score = 580000
WHERE quality_profile_name = '2160p Balanced'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'sonarr'
  AND score = 560000;
-- --- END op 1247

-- --- BEGIN op 1248 ( update quality_profile "2160p Quality" )
UPDATE quality_profile_custom_formats
SET score = 580000
WHERE quality_profile_name = '2160p Quality'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'radarr'
  AND score = 560000;
-- --- END op 1248

-- --- BEGIN op 1249 ( update quality_profile "2160p Quality" )
UPDATE quality_profile_custom_formats
SET score = 580000
WHERE quality_profile_name = '2160p Quality'
  AND custom_format_name = '720p WEB-DL'
  AND arr_type = 'sonarr'
  AND score = 560000;
-- --- END op 1249
