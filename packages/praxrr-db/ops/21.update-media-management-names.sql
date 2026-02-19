-- @operation: export
-- @entity: batch
-- @name: Update Media Management Names
-- @exportedAt: 2026-02-06T02:11:42.601Z
-- @opIds: 463, 464, 465, 466, 467, 468

-- --- BEGIN op 463 ( update radarr_naming "Radarr" )
update "radarr_naming" set "name" = 'Radarr' where "name" = 'Praxrr - Radarr';
-- --- END op 463

-- --- BEGIN op 464 ( update sonarr_naming "Sonarr" )
update "sonarr_naming" set "name" = 'Sonarr' where "name" = 'Praxrr - Sonarr';
-- --- END op 464

-- --- BEGIN op 465 ( update radarr_quality_definitions "Radarr" )
delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'BR-DISK' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'Bluray-1080p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'Bluray-2160p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'Bluray-480p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'Bluray-576p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'Bluray-720p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'CAM' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'DVD' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'DVD-R' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'DVDSCR' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'HDTV-1080p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'HDTV-2160p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'HDTV-720p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'REGIONAL' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'Raw-HD' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'Remux-1080p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'Remux-2160p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'SDTV' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'TELECINE' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'TELESYNC' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'Unknown' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'WEBDL-1080p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'WEBDL-2160p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'WEBDL-480p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'WEBDL-720p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'WEBRip-1080p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'WEBRip-2160p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'WEBRip-480p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'WEBRip-720p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

delete from "radarr_quality_definitions" where "name" = 'Praxrr - Radarr' and "quality_name" = 'WORKPRINT' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 1990;

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'BR-DISK', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'Bluray-1080p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'Bluray-2160p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'Bluray-480p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'Bluray-576p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'Bluray-720p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'CAM', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'DVD', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'DVD-R', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'DVDSCR', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'HDTV-1080p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'HDTV-2160p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'HDTV-720p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'REGIONAL', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'Raw-HD', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'Remux-1080p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'Remux-2160p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'SDTV', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'TELECINE', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'TELESYNC', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'Unknown', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'WEBDL-1080p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'WEBDL-2160p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'WEBDL-480p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'WEBDL-720p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'WEBRip-1080p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'WEBRip-2160p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'WEBRip-480p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'WEBRip-720p', 0, 0, 1990);

insert into "radarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Radarr', 'WORKPRINT', 0, 0, 1990);
-- --- END op 465

-- --- BEGIN op 466 ( update sonarr_quality_definitions "Sonarr" )
delete from "sonarr_quality_definitions" where "name" = 'Praxrr - Sonarr' and "quality_name" = 'Bluray-1080p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'Praxrr - Sonarr' and "quality_name" = 'Bluray-2160p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'Praxrr - Sonarr' and "quality_name" = 'Bluray-480p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'Praxrr - Sonarr' and "quality_name" = 'Bluray-576p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'Praxrr - Sonarr' and "quality_name" = 'Bluray-720p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'Praxrr - Sonarr' and "quality_name" = 'DVD' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'Praxrr - Sonarr' and "quality_name" = 'HDTV-1080p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'Praxrr - Sonarr' and "quality_name" = 'HDTV-2160p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'Praxrr - Sonarr' and "quality_name" = 'HDTV-720p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'Praxrr - Sonarr' and "quality_name" = 'Raw-HD' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'Praxrr - Sonarr' and "quality_name" = 'Remux-1080p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'Praxrr - Sonarr' and "quality_name" = 'Remux-2160p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'Praxrr - Sonarr' and "quality_name" = 'SDTV' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'Praxrr - Sonarr' and "quality_name" = 'Unknown' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'Praxrr - Sonarr' and "quality_name" = 'WEBDL-1080p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'Praxrr - Sonarr' and "quality_name" = 'WEBDL-2160p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'Praxrr - Sonarr' and "quality_name" = 'WEBDL-480p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'Praxrr - Sonarr' and "quality_name" = 'WEBDL-720p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'Praxrr - Sonarr' and "quality_name" = 'WEBRip-1080p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'Praxrr - Sonarr' and "quality_name" = 'WEBRip-2160p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'Praxrr - Sonarr' and "quality_name" = 'WEBRip-480p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

delete from "sonarr_quality_definitions" where "name" = 'Praxrr - Sonarr' and "quality_name" = 'WEBRip-720p' and "min_size" = 0 and "max_size" = 0 and "preferred_size" = 990;

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Sonarr', 'Bluray-1080p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Sonarr', 'Bluray-2160p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Sonarr', 'Bluray-480p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Sonarr', 'Bluray-576p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Sonarr', 'Bluray-720p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Sonarr', 'DVD', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Sonarr', 'HDTV-1080p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Sonarr', 'HDTV-2160p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Sonarr', 'HDTV-720p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Sonarr', 'Raw-HD', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Sonarr', 'Remux-1080p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Sonarr', 'Remux-2160p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Sonarr', 'SDTV', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Sonarr', 'Unknown', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Sonarr', 'WEBDL-1080p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Sonarr', 'WEBDL-2160p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Sonarr', 'WEBDL-480p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Sonarr', 'WEBDL-720p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Sonarr', 'WEBRip-1080p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Sonarr', 'WEBRip-2160p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Sonarr', 'WEBRip-480p', 0, 0, 990);

insert into "sonarr_quality_definitions" ("name", "quality_name", "min_size", "max_size", "preferred_size") values ('Sonarr', 'WEBRip-720p', 0, 0, 990);
-- --- END op 466

-- --- BEGIN op 467 ( update radarr_media_settings "Radarr" )
update "radarr_media_settings" set "name" = 'Radarr' where "name" = 'Praxrr - Radarr';
-- --- END op 467

-- --- BEGIN op 468 ( update sonarr_media_settings "Sonarr" )
update "sonarr_media_settings" set "name" = 'Sonarr' where "name" = 'Praxrr - Sonarr';
-- --- END op 468
