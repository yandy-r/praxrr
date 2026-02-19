-- @operation: export
-- @entity: batch
-- @name: Rename SD Tiers to DVD Tiers
-- @exportedAt: 2026-02-11T18:46:26.807Z
-- @opIds: 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84

-- --- BEGIN op 57 ( update custom_format "DVD Quality Tier 1" )
update "custom_formats" set "name" = 'DVD Quality Tier 1' where "name" = 'SD Quality Tier 1';
-- --- END op 57

-- --- BEGIN op 58 ( update quality_profile "1080p Balanced" )
update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '1080p Balanced' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'all' and "score" = 11000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '1080p Balanced' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'radarr' and "score" = 21000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '1080p Balanced' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'sonarr' and "score" = 21000;
-- --- END op 58

-- --- BEGIN op 59 ( update quality_profile "1080p Compact" )
update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '1080p Compact' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'all' and "score" = 21000;
-- --- END op 59

-- --- BEGIN op 60 ( update quality_profile "1080p Efficient" )
update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '1080p Efficient' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'all' and "score" = 11000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '1080p Efficient' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'radarr' and "score" = 21000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '1080p Efficient' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'sonarr' and "score" = 21000;
-- --- END op 60

-- --- BEGIN op 61 ( update quality_profile "1080p Quality" )
update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '1080p Quality' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'all' and "score" = 11000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '1080p Quality' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'radarr' and "score" = 21000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '1080p Quality' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'sonarr' and "score" = 21000;
-- --- END op 61

-- --- BEGIN op 62 ( update quality_profile "1080p Quality HDR" )
update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '1080p Quality HDR' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'all' and "score" = 11000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '1080p Quality HDR' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'radarr' and "score" = 21000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '1080p Quality HDR' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'sonarr' and "score" = 21000;
-- --- END op 62

-- --- BEGIN op 63 ( update quality_profile "1080p Remux" )
update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '1080p Remux' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'all' and "score" = 11000;
-- --- END op 63

-- --- BEGIN op 64 ( update quality_profile "2160p Balanced" )
update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '2160p Balanced' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'all' and "score" = 11000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '2160p Balanced' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'radarr' and "score" = 21000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '2160p Balanced' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'sonarr' and "score" = 21000;
-- --- END op 64

-- --- BEGIN op 65 ( update quality_profile "2160p Efficient" )
update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '2160p Efficient' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'all' and "score" = 11000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '2160p Efficient' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'radarr' and "score" = 21000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '2160p Efficient' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'sonarr' and "score" = 21000;
-- --- END op 65

-- --- BEGIN op 66 ( update quality_profile "2160p Quality" )
update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '2160p Quality' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'all' and "score" = 11000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '2160p Quality' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'radarr' and "score" = 21000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '2160p Quality' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'sonarr' and "score" = 21000;
-- --- END op 66

-- --- BEGIN op 67 ( update quality_profile "2160p Remux" )
update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '2160p Remux' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'all' and "score" = 11000;
-- --- END op 67

-- --- BEGIN op 68 ( update quality_profile "720p Quality" )
update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '720p Quality' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'all' and "score" = 11000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '720p Quality' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'radarr' and "score" = 21000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 1' where "quality_profile_name" = '720p Quality' and "custom_format_name" = 'SD Quality Tier 1' and "arr_type" = 'sonarr' and "score" = 21000;
-- --- END op 68

-- --- BEGIN op 69 ( update custom_format "DVD Quality Tier 1" )
update "custom_formats" set "description" = 'Matches release groups who fall under DVD GPPi Tier 1' where "name" = 'DVD Quality Tier 1' and "description" = 'Matches release groups who fall under SD GPPi Tier 1';
-- --- END op 69

-- --- BEGIN op 70 ( update custom_format "DVD Quality Tier 2" )
update "custom_formats" set "description" = 'Matches release groups who fall under DVD GPPi Tier 2' where "name" = 'SD Quality Tier 2' and "description" = 'Matches release groups who fall under SD GPPi Tier 2';
-- --- END op 70

-- --- BEGIN op 71 ( update custom_format "DVD Quality Tier 2" )
DELETE FROM custom_format_tags WHERE custom_format_name = 'SD Quality Tier 2' AND tag_name = 'SD';

insert into "tags" ("name") values ('DVD') on conflict ("name") do nothing;

INSERT INTO custom_format_tags (custom_format_name, tag_name) VALUES ('SD Quality Tier 2', 'DVD');
-- --- END op 71

-- --- BEGIN op 72 ( update custom_format "DVD Quality Tier 2" )
update "custom_formats" set "name" = 'DVD Quality Tier 2' where "name" = 'SD Quality Tier 2';
-- --- END op 72

-- --- BEGIN op 73 ( update quality_profile "1080p Balanced" )
update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '1080p Balanced' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'all' and "score" = 10000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '1080p Balanced' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'radarr' and "score" = 20000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '1080p Balanced' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'sonarr' and "score" = 20000;
-- --- END op 73

-- --- BEGIN op 74 ( update quality_profile "1080p Compact" )
update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '1080p Compact' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'all' and "score" = 20000;
-- --- END op 74

-- --- BEGIN op 75 ( update quality_profile "1080p Efficient" )
update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '1080p Efficient' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'all' and "score" = 10000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '1080p Efficient' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'radarr' and "score" = 20000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '1080p Efficient' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'sonarr' and "score" = 20000;
-- --- END op 75

-- --- BEGIN op 76 ( update quality_profile "1080p Quality" )
update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '1080p Quality' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'all' and "score" = 10000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '1080p Quality' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'radarr' and "score" = 20000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '1080p Quality' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'sonarr' and "score" = 20000;
-- --- END op 76

-- --- BEGIN op 77 ( update quality_profile "1080p Quality HDR" )
update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '1080p Quality HDR' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'all' and "score" = 10000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '1080p Quality HDR' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'radarr' and "score" = 20000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '1080p Quality HDR' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'sonarr' and "score" = 20000;
-- --- END op 77

-- --- BEGIN op 78 ( update quality_profile "1080p Remux" )
update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '1080p Remux' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'all' and "score" = 10000;
-- --- END op 78

-- --- BEGIN op 79 ( update quality_profile "2160p Balanced" )
update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '2160p Balanced' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'all' and "score" = 10000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '2160p Balanced' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'radarr' and "score" = 20000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '2160p Balanced' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'sonarr' and "score" = 20000;
-- --- END op 79

-- --- BEGIN op 80 ( update quality_profile "2160p Efficient" )
update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '2160p Efficient' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'all' and "score" = 10000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '2160p Efficient' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'radarr' and "score" = 20000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '2160p Efficient' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'sonarr' and "score" = 20000;
-- --- END op 80

-- --- BEGIN op 81 ( update quality_profile "2160p Quality" )
update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '2160p Quality' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'all' and "score" = 10000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '2160p Quality' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'radarr' and "score" = 20000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '2160p Quality' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'sonarr' and "score" = 20000;
-- --- END op 81

-- --- BEGIN op 82 ( update quality_profile "2160p Remux" )
update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '2160p Remux' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'all' and "score" = 10000;
-- --- END op 82

-- --- BEGIN op 83 ( update quality_profile "720p Quality" )
update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '720p Quality' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'all' and "score" = 10000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '720p Quality' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'radarr' and "score" = 20000;

update "quality_profile_custom_formats" set "custom_format_name" = 'DVD Quality Tier 2' where "quality_profile_name" = '720p Quality' and "custom_format_name" = 'SD Quality Tier 2' and "arr_type" = 'sonarr' and "score" = 20000;
-- --- END op 83

-- --- BEGIN op 84 ( update custom_format "DVD Quality Tier 1" )
DELETE FROM custom_format_tags WHERE custom_format_name = 'DVD Quality Tier 1' AND tag_name = 'SD';

insert into "tags" ("name") values ('DVD') on conflict ("name") do nothing;

INSERT INTO custom_format_tags (custom_format_name, tag_name) VALUES ('DVD Quality Tier 1', 'DVD');
-- --- END op 84
