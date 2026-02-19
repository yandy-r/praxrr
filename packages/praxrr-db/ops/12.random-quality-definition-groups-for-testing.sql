-- @operation: export
-- @entity: batch
-- @name: Random Quality Definition Groups for Testing
-- @exportedAt: 2026-02-01T20:22:55.082Z
-- @opIds: 191, 192

-- --- BEGIN op 191 ( update quality_profile "1080p Balanced" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '1080p Balanced'
  AND quality_name IS NULL
  AND position = 0
  AND enabled = 1
  AND upgrade_until = 1;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '720p Quality'
  AND quality_name IS NULL
  AND position = 1
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '480p Quality'
  AND quality_name IS NULL
  AND position = 2
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '1080p Balanced'
  AND quality_name = 'Bluray-1080p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '1080p Balanced'
  AND quality_name = 'WEBDL-1080p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-480p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-576p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'DVD';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'WEBDL-480p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'Bluray-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBDL-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Balanced'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBRip-720p';

DELETE FROM quality_groups
WHERE quality_profile_name = '1080p Balanced'
  AND name = '1080p Balanced';

DELETE FROM quality_groups
WHERE quality_profile_name = '1080p Balanced'
  AND name = '480p Quality';

DELETE FROM quality_groups
WHERE quality_profile_name = '1080p Balanced'
  AND name = '720p Quality';

INSERT INTO quality_groups (quality_profile_name, name) VALUES ('1080p Balanced', '1080p Balanced');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Balanced', '1080p Balanced', 'Bluray-1080p');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Balanced', '1080p Balanced', 'WEBDL-1080p');

INSERT INTO quality_groups (quality_profile_name, name) VALUES ('1080p Balanced', '720p Quality');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Balanced', '720p Quality', 'Bluray-720p');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Balanced', '720p Quality', 'WEBDL-720p');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Balanced', '720p Quality', 'WEBRip-720p');

INSERT INTO quality_groups (quality_profile_name, name) VALUES ('1080p Balanced', '480p Quality');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Balanced', '480p Quality', 'Bluray-480p');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Balanced', '480p Quality', 'Bluray-576p');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Balanced', '480p Quality', 'DVD');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Balanced', '480p Quality', 'WEBDL-480p');

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', 'Remux-2160p', NULL, 0, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', 'Bluray-2160p', NULL, 1, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', 'WEBDL-2160p', NULL, 2, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', NULL, '1080p Balanced', 3, 1, 1);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', NULL, '720p Quality', 4, 1, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', NULL, '480p Quality', 5, 1, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', 'BR-DISK', NULL, 6, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', 'CAM', NULL, 7, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', 'DVD-R', NULL, 8, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', 'DVDSCR', NULL, 9, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', 'HDTV-1080p', NULL, 10, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', 'HDTV-2160p', NULL, 11, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', 'HDTV-480p', NULL, 12, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', 'HDTV-720p', NULL, 13, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', 'REGIONAL', NULL, 14, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', 'Raw-HD', NULL, 15, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', 'Remux-1080p', NULL, 16, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', 'SDTV', NULL, 17, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', 'TELECINE', NULL, 18, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', 'TELESYNC', NULL, 19, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', 'Unknown', NULL, 20, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', 'WEBRip-1080p', NULL, 21, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', 'WEBRip-2160p', NULL, 22, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', 'WEBRip-480p', NULL, 23, 0, 0);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Balanced', 'WORKPRINT', NULL, 24, 0, 0);
-- --- END op 191

-- --- BEGIN op 192 ( update quality_profile "1080p Quality HDR" )
DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '1080p Quality HDR'
  AND quality_name IS NULL
  AND position = 0
  AND enabled = 1
  AND upgrade_until = 1;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '720p Quality'
  AND quality_name IS NULL
  AND position = 1
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_profile_qualities
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '480p Quality'
  AND quality_name IS NULL
  AND position = 2
  AND enabled = 1
  AND upgrade_until = 0;

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '1080p Quality HDR'
  AND quality_name = 'Bluray-1080p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '1080p Quality HDR'
  AND quality_name = 'WEBDL-1080p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '1080p Quality HDR'
  AND quality_name = 'WEBRip-1080p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-480p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'Bluray-576p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'DVD';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '480p Quality'
  AND quality_name = 'WEBDL-480p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'Bluray-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBDL-720p';

DELETE FROM quality_group_members
WHERE quality_profile_name = '1080p Quality HDR'
  AND quality_group_name = '720p Quality'
  AND quality_name = 'WEBRip-720p';

DELETE FROM quality_groups
WHERE quality_profile_name = '1080p Quality HDR'
  AND name = '1080p Quality HDR';

DELETE FROM quality_groups
WHERE quality_profile_name = '1080p Quality HDR'
  AND name = '480p Quality';

DELETE FROM quality_groups
WHERE quality_profile_name = '1080p Quality HDR'
  AND name = '720p Quality';

INSERT INTO quality_groups (quality_profile_name, name) VALUES ('1080p Quality HDR', '1080p Quality HDR');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Quality HDR', '1080p Quality HDR', 'Bluray-1080p');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Quality HDR', '1080p Quality HDR', 'WEBDL-1080p');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Quality HDR', '1080p Quality HDR', 'WEBRip-1080p');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Quality HDR', '1080p Quality HDR', 'Bluray-720p');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Quality HDR', '1080p Quality HDR', 'WEBDL-720p');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Quality HDR', '1080p Quality HDR', 'WEBRip-720p');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Quality HDR', '1080p Quality HDR', 'Bluray-480p');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Quality HDR', '1080p Quality HDR', 'Bluray-576p');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Quality HDR', '1080p Quality HDR', 'DVD');

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name) VALUES ('1080p Quality HDR', '1080p Quality HDR', 'WEBDL-480p');

INSERT INTO quality_profile_qualities (quality_profile_name, quality_name, quality_group_name, position, enabled, upgrade_until) VALUES ('1080p Quality HDR', NULL, '1080p Quality HDR', 0, 0, 1);

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
-- --- END op 192
