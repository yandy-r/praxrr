-- @operation: export
-- @entity: batch
-- @name: Increase Max Upgrade Until Score for all Profiles to 1,000,0000 (Yay OCD?)
-- @exportedAt: 2026-02-09T01:21:52.358Z
-- @opIds: 1426, 1427, 1428, 1429, 1430, 1431, 1432, 1433, 1434, 1435, 1436

-- --- BEGIN op 1426 ( update quality_profile "1080p Balanced" )
update "quality_profiles" set "upgrade_until_score" = 1000000 where "name" = '1080p Balanced' and "upgrade_until_score" = 888888;
-- --- END op 1426

-- --- BEGIN op 1427 ( update quality_profile "1080p Compact" )
update "quality_profiles" set "upgrade_until_score" = 1000000 where "name" = '1080p Compact' and "upgrade_until_score" = 888888;
-- --- END op 1427

-- --- BEGIN op 1428 ( update quality_profile "1080p Efficient" )
update "quality_profiles" set "upgrade_until_score" = 1000000 where "name" = '1080p Efficient' and "upgrade_until_score" = 888888;
-- --- END op 1428

-- --- BEGIN op 1429 ( update quality_profile "1080p Quality" )
update "quality_profiles" set "upgrade_until_score" = 1000000 where "name" = '1080p Quality' and "upgrade_until_score" = 888888;
-- --- END op 1429

-- --- BEGIN op 1430 ( update quality_profile "1080p Quality HDR" )
update "quality_profiles" set "upgrade_until_score" = 1000000 where "name" = '1080p Quality HDR' and "upgrade_until_score" = 888888;
-- --- END op 1430

-- --- BEGIN op 1431 ( update quality_profile "1080p Remux" )
update "quality_profiles" set "upgrade_until_score" = 1000000 where "name" = '1080p Remux' and "upgrade_until_score" = 888888;
-- --- END op 1431

-- --- BEGIN op 1432 ( update quality_profile "2160p Balanced" )
update "quality_profiles" set "upgrade_until_score" = 1000000 where "name" = '2160p Balanced' and "upgrade_until_score" = 888888;
-- --- END op 1432

-- --- BEGIN op 1433 ( update quality_profile "2160p Efficient" )
update "quality_profiles" set "upgrade_until_score" = 1000000 where "name" = '2160p Efficient' and "upgrade_until_score" = 888888;
-- --- END op 1433

-- --- BEGIN op 1434 ( update quality_profile "2160p Quality" )
update "quality_profiles" set "upgrade_until_score" = 1000000 where "name" = '2160p Quality' and "upgrade_until_score" = 888888;
-- --- END op 1434

-- --- BEGIN op 1435 ( update quality_profile "2160p Remux" )
update "quality_profiles" set "upgrade_until_score" = 1000000 where "name" = '2160p Remux' and "upgrade_until_score" = 888888;
-- --- END op 1435

-- --- BEGIN op 1436 ( update quality_profile "720p Quality" )
update "quality_profiles" set "upgrade_until_score" = 1000000 where "name" = '720p Quality' and "upgrade_until_score" = 888888;
-- --- END op 1436
