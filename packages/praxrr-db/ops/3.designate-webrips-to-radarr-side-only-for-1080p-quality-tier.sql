-- @operation: export
-- @entity: batch
-- @name: Designate WEBRips to Radarr Side Only for 1080p Quality Tiers
-- @exportedAt: 2026-01-31T18:51:38.827Z
-- @opIds: 45, 46, 47, 48, 49, 50

-- --- BEGIN op 45 ( update custom_format "1080p Quality Tier 1" )
UPDATE custom_format_conditions
SET arr_type = 'radarr'
WHERE custom_format_name = '1080p Quality Tier 1'
  AND name = 'WEBRip'
  AND type = 'source'
  AND arr_type = 'all'
  AND negate = 0
  AND required = 0;
-- --- END op 45

-- --- BEGIN op 46 ( update custom_format "1080p Quality Tier 2" )
UPDATE custom_format_conditions
SET arr_type = 'radarr'
WHERE custom_format_name = '1080p Quality Tier 2'
  AND name = 'WEBRip'
  AND type = 'source'
  AND arr_type = 'all'
  AND negate = 0
  AND required = 0;
-- --- END op 46

-- --- BEGIN op 47 ( update custom_format "1080p Quality Tier 3" )
UPDATE custom_format_conditions
SET arr_type = 'radarr'
WHERE custom_format_name = '1080p Quality Tier 3'
  AND name = 'WEBRip'
  AND type = 'source'
  AND arr_type = 'all'
  AND negate = 0
  AND required = 0;
-- --- END op 47

-- --- BEGIN op 48 ( update custom_format "1080p Quality Tier 4" )
UPDATE custom_format_conditions
SET arr_type = 'radarr'
WHERE custom_format_name = '1080p Quality Tier 4'
  AND name = 'WEBRip'
  AND type = 'source'
  AND arr_type = 'all'
  AND negate = 0
  AND required = 0;
-- --- END op 48

-- --- BEGIN op 49 ( update custom_format "1080p Quality Tier 5" )
UPDATE custom_format_conditions
SET arr_type = 'radarr'
WHERE custom_format_name = '1080p Quality Tier 5'
  AND name = 'WEBRip'
  AND type = 'source'
  AND arr_type = 'all'
  AND negate = 0
  AND required = 0;
-- --- END op 49

-- --- BEGIN op 50 ( update custom_format "1080p Quality Tier 6" )
UPDATE custom_format_conditions
SET arr_type = 'radarr'
WHERE custom_format_name = '1080p Quality Tier 6'
  AND name = 'WEBRip'
  AND type = 'source'
  AND arr_type = 'all'
  AND negate = 0
  AND required = 0;
-- --- END op 50
