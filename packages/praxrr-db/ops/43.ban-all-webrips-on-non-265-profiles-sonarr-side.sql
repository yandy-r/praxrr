-- @operation: export
-- @entity: batch
-- @name: Ban All WEBRips on non 265 Profiles Sonarr Side
-- @exportedAt: 2026-02-11T18:17:31.938Z
-- @opIds: 44

-- --- BEGIN op 44 ( update custom_format "Banned WEBRip" )
UPDATE custom_format_conditions
SET arr_type = 'radarr'
WHERE custom_format_name = 'Banned WEBRip'
  AND name = 'Release Groups'
  AND type = 'release_group'
  AND arr_type = 'all'
  AND negate = 1
  AND required = 1;
-- --- END op 44
