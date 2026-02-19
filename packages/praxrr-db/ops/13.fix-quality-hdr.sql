-- @operation: export
-- @entity: batch
-- @name: Fix Quality HDR
-- @exportedAt: 2026-02-01T20:25:16.251Z
-- @opIds: 194

-- --- BEGIN op 194 ( update quality_profile "1080p Quality HDR" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '1080p Quality HDR'
  AND quality_name IS NULL
  AND position = 0
  AND enabled = 0
  AND upgrade_until = 1;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'BR-DISK'
  AND quality_group_name IS NULL
  AND position = 1
  AND enabled = 0
  AND upgrade_until = 0;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'Bluray-2160p'
  AND quality_group_name IS NULL
  AND position = 2
  AND enabled = 0
  AND upgrade_until = 0;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'CAM'
  AND quality_group_name IS NULL
  AND position = 3
  AND enabled = 0
  AND upgrade_until = 0;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'DVD-R'
  AND quality_group_name IS NULL
  AND position = 4
  AND enabled = 0
  AND upgrade_until = 0;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'DVDSCR'
  AND quality_group_name IS NULL
  AND position = 5
  AND enabled = 0
  AND upgrade_until = 0;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'HDTV-1080p'
  AND quality_group_name IS NULL
  AND position = 6
  AND enabled = 0
  AND upgrade_until = 0;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'HDTV-2160p'
  AND quality_group_name IS NULL
  AND position = 7
  AND enabled = 0
  AND upgrade_until = 0;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'HDTV-480p'
  AND quality_group_name IS NULL
  AND position = 8
  AND enabled = 0
  AND upgrade_until = 0;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'HDTV-720p'
  AND quality_group_name IS NULL
  AND position = 9
  AND enabled = 0
  AND upgrade_until = 0;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'REGIONAL'
  AND quality_group_name IS NULL
  AND position = 10
  AND enabled = 0
  AND upgrade_until = 0;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'Raw-HD'
  AND quality_group_name IS NULL
  AND position = 11
  AND enabled = 0
  AND upgrade_until = 0;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'Remux-1080p'
  AND quality_group_name IS NULL
  AND position = 12
  AND enabled = 0
  AND upgrade_until = 0;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'Remux-2160p'
  AND quality_group_name IS NULL
  AND position = 13
  AND enabled = 0
  AND upgrade_until = 0;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'SDTV'
  AND quality_group_name IS NULL
  AND position = 14
  AND enabled = 0
  AND upgrade_until = 0;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'TELECINE'
  AND quality_group_name IS NULL
  AND position = 15
  AND enabled = 0
  AND upgrade_until = 0;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'TELESYNC'
  AND quality_group_name IS NULL
  AND position = 16
  AND enabled = 0
  AND upgrade_until = 0;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'Unknown'
  AND quality_group_name IS NULL
  AND position = 17
  AND enabled = 0
  AND upgrade_until = 0;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'WEBDL-2160p'
  AND quality_group_name IS NULL
  AND position = 18
  AND enabled = 0
  AND upgrade_until = 0;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'WEBRip-2160p'
  AND quality_group_name IS NULL
  AND position = 19
  AND enabled = 0
  AND upgrade_until = 0;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'WEBRip-480p'
  AND quality_group_name IS NULL
  AND position = 20
  AND enabled = 0
  AND upgrade_until = 0;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_name = 'WORKPRINT'
  AND quality_group_name IS NULL
  AND position = 21
  AND enabled = 0
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '1080p Quality HDR'
  AND quality_name = 'Bluray-1080p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '1080p Quality HDR'
  AND quality_name = 'Bluray-480p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '1080p Quality HDR'
  AND quality_name = 'Bluray-576p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '1080p Quality HDR'
  AND quality_name = 'Bluray-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '1080p Quality HDR'
  AND quality_name = 'DVD';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '1080p Quality HDR'
  AND quality_name = 'WEBDL-1080p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '1080p Quality HDR'
  AND quality_name = 'WEBDL-480p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '1080p Quality HDR'
  AND quality_name = 'WEBDL-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '1080p Quality HDR'
  AND quality_name = 'WEBRip-1080p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '1080p Quality HDR'
  AND quality_name = 'WEBRip-720p';

DELETE FROM quality_groups
WHERE quality_profile_name = '1080p Quality HDR'
  AND name = '1080p Quality HDR';

INSERT INTO quality_groups (quality_profile_name, name) VALUES ('1080p Quality HDR', '1080p Quality HDR');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Quality HDR', '1080p Quality HDR', 'Bluray-1080p');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Quality HDR', '1080p Quality HDR', 'Bluray-480p');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Quality HDR', '1080p Quality HDR', 'Bluray-576p');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Quality HDR', '1080p Quality HDR', 'Bluray-720p');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Quality HDR', '1080p Quality HDR', 'DVD');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Quality HDR', '1080p Quality HDR', 'WEBDL-1080p');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Quality HDR', '1080p Quality HDR', 'WEBDL-480p');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Quality HDR', '1080p Quality HDR', 'WEBDL-720p');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Quality HDR', '1080p Quality HDR', 'WEBRip-1080p');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Quality HDR', '1080p Quality HDR', 'WEBRip-720p');

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Quality HDR', NULL, '1080p Quality HDR', 0, 1, 1);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Quality HDR', 'BR-DISK', NULL, 1, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Quality HDR', 'Bluray-2160p', NULL, 2, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Quality HDR', 'CAM', NULL, 3, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Quality HDR', 'DVD-R', NULL, 4, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Quality HDR', 'DVDSCR', NULL, 5, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Quality HDR', 'HDTV-1080p', NULL, 6, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Quality HDR', 'HDTV-2160p', NULL, 7, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Quality HDR', 'HDTV-480p', NULL, 8, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Quality HDR', 'HDTV-720p', NULL, 9, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Quality HDR', 'REGIONAL', NULL, 10, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Quality HDR', 'Raw-HD', NULL, 11, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Quality HDR', 'Remux-1080p', NULL, 12, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Quality HDR', 'Remux-2160p', NULL, 13, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Quality HDR', 'SDTV', NULL, 14, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Quality HDR', 'TELECINE', NULL, 15, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Quality HDR', 'TELESYNC', NULL, 16, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Quality HDR', 'Unknown', NULL, 17, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Quality HDR', 'WEBDL-2160p', NULL, 18, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Quality HDR', 'WEBRip-2160p', NULL, 19, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Quality HDR', 'WEBRip-480p', NULL, 20, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Quality HDR', 'WORKPRINT', NULL, 21, 0, 0);
-- --- END op 194
