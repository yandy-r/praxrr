-- @operation: export
-- @entity: batch
-- @name: Designate WEBRips to Radarr Side Only for 720p Quality Tiers
-- @exportedAt: 2026-01-31T19:33:27.663Z
-- @opIds: 88, 89, 90, 91, 92, 93

-- --- BEGIN op 88 ( update custom_format "720p Quality Tier 1" )
UPDATE custom_format_conditions
SET arr_type = 'radarr'
WHERE custom_format_name = '720p Quality Tier 1'
  AND name = 'WEBRip'
  AND type = 'source'
  AND arr_type = 'all'
  AND negate = 0
  AND required = 0;
-- --- END op 88

-- --- BEGIN op 89 ( update custom_format "720p Quality Tier 2" )
UPDATE custom_format_conditions
SET arr_type = 'radarr'
WHERE custom_format_name = '720p Quality Tier 2'
  AND name = 'WEBRip'
  AND type = 'source'
  AND arr_type = 'all'
  AND negate = 0
  AND required = 0;
-- --- END op 89

-- --- BEGIN op 90 ( update custom_format "720p Quality Tier 3" )
UPDATE custom_format_conditions
SET arr_type = 'radarr'
WHERE custom_format_name = '720p Quality Tier 3'
  AND name = 'WEBRip'
  AND type = 'source'
  AND arr_type = 'all'
  AND negate = 0
  AND required = 0;
-- --- END op 90

-- --- BEGIN op 91 ( update custom_format "720p Quality Tier 4" )
UPDATE custom_format_conditions
SET arr_type = 'radarr'
WHERE custom_format_name = '720p Quality Tier 4'
  AND name = 'WEBRip'
  AND type = 'source'
  AND arr_type = 'all'
  AND negate = 0
  AND required = 0;
-- --- END op 91

-- --- BEGIN op 92 ( update custom_format "720p Quality Tier 5" )
UPDATE custom_format_conditions
SET arr_type = 'radarr'
WHERE custom_format_name = '720p Quality Tier 5'
  AND name = 'WEBRip'
  AND type = 'source'
  AND arr_type = 'all'
  AND negate = 0
  AND required = 0;
-- --- END op 92

-- --- BEGIN op 93 ( update custom_format "720p Quality Tier 6" )
UPDATE custom_format_conditions
SET arr_type = 'radarr'
WHERE custom_format_name = '720p Quality Tier 6'
  AND name = 'WEBRip'
  AND type = 'source'
  AND arr_type = 'all'
  AND negate = 0
  AND required = 0;
-- --- END op 93
