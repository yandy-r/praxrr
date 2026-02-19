-- @operation: export
-- @entity: batch
-- @name: Updated media management names
-- @exportedAt: 2026-02-05T06:56:55.000Z
-- @opIds: 13742, 13743, 13744, 13745, 13746, 13747, 13749, 13750, 13751, 13752, 13753, 13754

-- --- BEGIN op 13742 ( update radarr_naming "renamed" )
update "radarr_naming" set "name" = 'renamed' where "name" = 'default';
-- --- END op 13742

-- --- BEGIN op 13743 ( update sonarr_naming "renamed" )
update "sonarr_naming" set "name" = 'renamed' where "name" = 'default';
-- --- END op 13743

-- --- BEGIN op 13744 ( update radarr_quality_definitions "renamed" )
delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'BR-DISK' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'Bluray-1080p' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'Bluray-2160p' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'Bluray-480p' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'Bluray-576p' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'Bluray-720p' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'CAM' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'DVD' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'DVD-R' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'DVDSCR' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'HDTV-1080p' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'HDTV-2160p' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'HDTV-720p' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'REGIONAL' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'Raw-HD' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'Remux-1080p' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'Remux-2160p' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'SDTV' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'TELECINE' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'TELESYNC' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'Unknown' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'WEBDL-1080p' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'WEBDL-2160p' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'WEBDL-480p' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'WEBDL-720p' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'WEBRip-1080p' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'WEBRip-2160p' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'WEBRip-480p' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'WEBRip-720p' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'default' and "quality_name" = 'WORKPRINT' and "min_size" = 0 and "max_size" = 2000 and "preferred_size" = 1990;

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'BR-DISK', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'Bluray-1080p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'Bluray-2160p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'Bluray-480p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'Bluray-576p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'Bluray-720p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'CAM', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'DVD', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'DVD-R', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'DVDSCR', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'HDTV-1080p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'HDTV-2160p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'HDTV-720p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'REGIONAL', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'Raw-HD', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'Remux-1080p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'Remux-2160p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'SDTV', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'TELECINE', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'TELESYNC', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'Unknown', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'WEBDL-1080p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'WEBDL-2160p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'WEBDL-480p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'WEBDL-720p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'WEBRip-1080p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'WEBRip-2160p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'WEBRip-480p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'WEBRip-720p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'WORKPRINT', 0, 0, 1990);
-- --- END op 13744

-- --- BEGIN op 13745 ( update sonarr_quality_definitions "renamed" )
delete from "sonarr_quality_definitions" where "name" = 'default' and "quality_name" = 'Bluray-1080p' and "min_size" = 0 and "max_size" = 1000 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'default' and "quality_name" = 'Bluray-2160p' and "min_size" = 0 and "max_size" = 1000 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'default' and "quality_name" = 'Bluray-480p' and "min_size" = 0 and "max_size" = 1000 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'default' and "quality_name" = 'Bluray-576p' and "min_size" = 0 and "max_size" = 1000 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'default' and "quality_name" = 'Bluray-720p' and "min_size" = 0 and "max_size" = 1000 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'default' and "quality_name" = 'DVD' and "min_size" = 0 and "max_size" = 1000 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'default' and "quality_name" = 'HDTV-1080p' and "min_size" = 0 and "max_size" = 1000 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'default' and "quality_name" = 'HDTV-2160p' and "min_size" = 0 and "max_size" = 1000 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'default' and "quality_name" = 'HDTV-720p' and "min_size" = 0 and "max_size" = 1000 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'default' and "quality_name" = 'Raw-HD' and "min_size" = 0 and "max_size" = 1000 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'default' and "quality_name" = 'Remux-1080p' and "min_size" = 0 and "max_size" = 1000 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'default' and "quality_name" = 'Remux-2160p' and "min_size" = 0 and "max_size" = 1000 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'default' and "quality_name" = 'SDTV' and "min_size" = 0 and "max_size" = 1000 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'default' and "quality_name" = 'Unknown' and "min_size" = 0 and "max_size" = 1000 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'default' and "quality_name" = 'WEBDL-1080p' and "min_size" = 0 and "max_size" = 1000 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'default' and "quality_name" = 'WEBDL-2160p' and "min_size" = 0 and "max_size" = 1000 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'default' and "quality_name" = 'WEBDL-480p' and "min_size" = 0 and "max_size" = 1000 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'default' and "quality_name" = 'WEBDL-720p' and "min_size" = 0 and "max_size" = 1000 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'default' and "quality_name" = 'WEBRip-1080p' and "min_size" = 0 and "max_size" = 1000 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'default' and "quality_name" = 'WEBRip-2160p' and "min_size" = 0 and "max_size" = 1000 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'default' and "quality_name" = 'WEBRip-480p' and "min_size" = 0 and "max_size" = 1000 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'default' and "quality_name" = 'WEBRip-720p' and "min_size" = 0 and "max_size" = 1000 and "preferred_size" = 990;

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'Bluray-1080p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'Bluray-2160p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'Bluray-480p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'Bluray-576p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'Bluray-720p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'DVD', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'HDTV-1080p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'HDTV-2160p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'HDTV-720p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'Raw-HD', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'Remux-1080p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'Remux-2160p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'SDTV', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'Unknown', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'WEBDL-1080p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'WEBDL-2160p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'WEBDL-480p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'WEBDL-720p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'WEBRip-1080p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'WEBRip-2160p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'WEBRip-480p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('renamed', 'WEBRip-720p', 0, 0, 990);
-- --- END op 13745

-- --- BEGIN op 13746 ( update radarr_media_settings "renamed" )
update "radarr_media_settings" set "name" = 'renamed' where "name" = 'default';
-- --- END op 13746

-- --- BEGIN op 13747 ( update sonarr_media_settings "renamed" )
update "sonarr_media_settings" set "name" = 'renamed' where "name" = 'default';
-- --- END op 13747

-- --- BEGIN op 13749 ( update radarr_naming "Praxrr - Radarr" )
update "radarr_naming" set "name" = 'Praxrr - Radarr' where "name" = 'renamed';
-- --- END op 13749

-- --- BEGIN op 13750 ( update sonarr_naming "Praxrr - Sonarr" )
update "sonarr_naming" set "name" = 'Praxrr - Sonarr' where "name" = 'renamed';
-- --- END op 13750

-- --- BEGIN op 13751 ( update radarr_quality_definitions "Praxrr - Radarr" )
delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'BR-DISK' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'Bluray-1080p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'Bluray-2160p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'Bluray-480p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'Bluray-576p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'Bluray-720p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'CAM' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'DVD' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'DVD-R' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'DVDSCR' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'HDTV-1080p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'HDTV-2160p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'HDTV-720p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'REGIONAL' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'Raw-HD' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'Remux-1080p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'Remux-2160p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'SDTV' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'TELECINE' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'TELESYNC' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'Unknown' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'WEBDL-1080p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'WEBDL-2160p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'WEBDL-480p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'WEBDL-720p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'WEBRip-1080p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'WEBRip-2160p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'WEBRip-480p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'WEBRip-720p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'WORKPRINT' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'BR-DISK', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'Bluray-1080p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'Bluray-2160p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'Bluray-480p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'Bluray-576p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'Bluray-720p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'CAM', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'DVD', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'DVD-R', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'DVDSCR', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'HDTV-1080p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'HDTV-2160p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'HDTV-720p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'REGIONAL', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'Raw-HD', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'Remux-1080p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'Remux-2160p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'SDTV', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'TELECINE', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'TELESYNC', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'Unknown', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'WEBDL-1080p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'WEBDL-2160p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'WEBDL-480p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'WEBDL-720p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'WEBRip-1080p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'WEBRip-2160p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'WEBRip-480p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'WEBRip-720p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Radarr', 'WORKPRINT', 0, 0, 1990);
-- --- END op 13751

-- --- BEGIN op 13752 ( update sonarr_quality_definitions "Praxrr - Sonarr" )
delete from "sonarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'Bluray-1080p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'Bluray-2160p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'Bluray-480p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'Bluray-576p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'Bluray-720p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'DVD' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'HDTV-1080p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'HDTV-2160p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'HDTV-720p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'Raw-HD' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'Remux-1080p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'Remux-2160p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'SDTV' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'Unknown' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'WEBDL-1080p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'WEBDL-2160p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'WEBDL-480p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'WEBDL-720p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'WEBRip-1080p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'WEBRip-2160p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'WEBRip-480p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'renamed' and "quality_name" = 'WEBRip-720p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Sonarr', 'Bluray-1080p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Sonarr', 'Bluray-2160p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Sonarr', 'Bluray-480p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Sonarr', 'Bluray-576p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Sonarr', 'Bluray-720p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Sonarr', 'DVD', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Sonarr', 'HDTV-1080p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Sonarr', 'HDTV-2160p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Sonarr', 'HDTV-720p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Sonarr', 'Raw-HD', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Sonarr', 'Remux-1080p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Sonarr', 'Remux-2160p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Sonarr', 'SDTV', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Sonarr', 'Unknown', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Sonarr', 'WEBDL-1080p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Sonarr', 'WEBDL-2160p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Sonarr', 'WEBDL-480p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Sonarr', 'WEBDL-720p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Sonarr', 'WEBRip-1080p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Sonarr', 'WEBRip-2160p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Sonarr', 'WEBRip-480p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Praxrr - Sonarr', 'WEBRip-720p', 0, 0, 990);
-- --- END op 13752

-- --- BEGIN op 13753 ( update radarr_media_settings "Praxrr - Radarr" )
update "radarr_media_settings" set "name" = 'Praxrr - Radarr' where "name" = 'renamed';
-- --- END op 13753

-- --- BEGIN op 13754 ( update sonarr_media_settings "Praxrr - Sonarr" )
update "sonarr_media_settings" set "name" = 'Praxrr - Sonarr' where "name" = 'renamed';
-- --- END op 13754
