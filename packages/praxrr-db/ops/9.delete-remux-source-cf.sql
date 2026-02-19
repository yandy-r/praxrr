-- @operation: export
-- @entity: batch
-- @name: Delete Remux Source CF
-- @exportedAt: 2026-01-31T20:44:15.510Z
-- @opIds: 167, 168, 169, 170, 171, 172, 173, 174, 175, 176

-- --- BEGIN op 167 ( update quality_profile "1080p Balanced" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '1080p Balanced' and "custom_format_name" = 'Remux (Source)' and "arr_type" = 'sonarr' and "score" = -999999;
-- --- END op 167

-- --- BEGIN op 168 ( update quality_profile "1080p Compact" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '1080p Compact' and "custom_format_name" = 'Remux (Source)' and "arr_type" = 'sonarr' and "score" = -999999;
-- --- END op 168

-- --- BEGIN op 169 ( update quality_profile "1080p Efficient" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '1080p Efficient' and "custom_format_name" = 'Remux (Source)' and "arr_type" = 'sonarr' and "score" = -999999;
-- --- END op 169

-- --- BEGIN op 170 ( update quality_profile "1080p Quality" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '1080p Quality' and "custom_format_name" = 'Remux (Source)' and "arr_type" = 'sonarr' and "score" = -999999;
-- --- END op 170

-- --- BEGIN op 171 ( update quality_profile "1080p Quality HDR" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '1080p Quality HDR' and "custom_format_name" = 'Remux (Source)' and "arr_type" = 'sonarr' and "score" = -999999;
-- --- END op 171

-- --- BEGIN op 172 ( update quality_profile "2160p Balanced" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '2160p Balanced' and "custom_format_name" = 'Remux (Source)' and "arr_type" = 'sonarr' and "score" = -999999;
-- --- END op 172

-- --- BEGIN op 173 ( update quality_profile "2160p Efficient" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '2160p Efficient' and "custom_format_name" = 'Remux (Source)' and "arr_type" = 'sonarr' and "score" = -999999;
-- --- END op 173

-- --- BEGIN op 174 ( update quality_profile "2160p Quality" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '2160p Quality' and "custom_format_name" = 'Remux (Source)' and "arr_type" = 'sonarr' and "score" = -999999;
-- --- END op 174

-- --- BEGIN op 175 ( update quality_profile "720p Quality" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '720p Quality' and "custom_format_name" = 'Remux (Source)' and "arr_type" = 'sonarr' and "score" = -999999;
-- --- END op 175

-- --- BEGIN op 176 ( delete custom_format "Remux (Source)" )
delete from "custom_formats" where "name" = 'Remux (Source)';
-- --- END op 176
