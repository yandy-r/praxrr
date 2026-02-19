-- @operation: export
-- @entity: batch
-- @name: Delete Remux Quality Match CF
-- @exportedAt: 2026-01-31T20:44:36.920Z
-- @opIds: 178, 179, 180, 181, 182, 183, 184, 185, 186, 187

-- --- BEGIN op 178 ( update quality_profile "1080p Balanced" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '1080p Balanced' and "custom_format_name" = 'Remux (Quality Match)' and "arr_type" = 'radarr' and "score" = -999999;
-- --- END op 178

-- --- BEGIN op 179 ( update quality_profile "1080p Compact" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '1080p Compact' and "custom_format_name" = 'Remux (Quality Match)' and "arr_type" = 'radarr' and "score" = -999999;
-- --- END op 179

-- --- BEGIN op 180 ( update quality_profile "1080p Efficient" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '1080p Efficient' and "custom_format_name" = 'Remux (Quality Match)' and "arr_type" = 'radarr' and "score" = -999999;
-- --- END op 180

-- --- BEGIN op 181 ( update quality_profile "1080p Quality" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '1080p Quality' and "custom_format_name" = 'Remux (Quality Match)' and "arr_type" = 'radarr' and "score" = -999999;
-- --- END op 181

-- --- BEGIN op 182 ( update quality_profile "1080p Quality HDR" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '1080p Quality HDR' and "custom_format_name" = 'Remux (Quality Match)' and "arr_type" = 'radarr' and "score" = -999999;
-- --- END op 182

-- --- BEGIN op 183 ( update quality_profile "2160p Balanced" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '2160p Balanced' and "custom_format_name" = 'Remux (Quality Match)' and "arr_type" = 'radarr' and "score" = -999999;
-- --- END op 183

-- --- BEGIN op 184 ( update quality_profile "2160p Efficient" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '2160p Efficient' and "custom_format_name" = 'Remux (Quality Match)' and "arr_type" = 'radarr' and "score" = -999999;
-- --- END op 184

-- --- BEGIN op 185 ( update quality_profile "2160p Quality" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '2160p Quality' and "custom_format_name" = 'Remux (Quality Match)' and "arr_type" = 'radarr' and "score" = -999999;
-- --- END op 185

-- --- BEGIN op 186 ( update quality_profile "720p Quality" )
delete from "quality_profile_custom_formats" where "quality_profile_name" = '720p Quality' and "custom_format_name" = 'Remux (Quality Match)' and "arr_type" = 'radarr' and "score" = -999999;
-- --- END op 186

-- --- BEGIN op 187 ( delete custom_format "Remux (Quality Match)" )
delete from "custom_formats" where "name" = 'Remux (Quality Match)';
-- --- END op 187
