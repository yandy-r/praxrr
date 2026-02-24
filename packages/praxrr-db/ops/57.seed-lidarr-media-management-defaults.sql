-- @operation: export
-- @entity: batch
-- @name: Seed Lidarr Media Management Defaults
-- @exportedAt: 2026-02-24T00:00:00.000Z
-- @opIds: 5701, 5702

-- --- BEGIN op 5701 ( ensure lidarr_naming "Lidarr" default exists and is normalized )
INSERT INTO lidarr_naming (
  name,
  rename,
  standard_track_format,
  artist_name,
  multi_disc_track_format,
  artist_folder_format,
  replace_illegal_characters,
  colon_replacement_format,
  custom_colon_replacement_format,
  created_at,
  updated_at
)
SELECT
  'Lidarr',
  rename,
  standard_track_format,
  artist_name,
  multi_disc_track_format,
  artist_folder_format,
  replace_illegal_characters,
  colon_replacement_format,
  custom_colon_replacement_format,
  created_at,
  updated_at
FROM lidarr_naming
WHERE name = 'Sonarr'
ON CONFLICT(name) DO NOTHING;

DELETE FROM lidarr_naming
WHERE name = 'Sonarr';

INSERT INTO lidarr_naming (
  name,
  rename,
  standard_track_format,
  artist_name,
  multi_disc_track_format,
  artist_folder_format,
  replace_illegal_characters,
  colon_replacement_format,
  custom_colon_replacement_format
)
VALUES (
  'Lidarr',
  1,
  '{Artist Name} - {Album Type} - {Album Title}  - {(Album Disambiguation)}/{Artist Name}_{Album Title}_{track:00}_{Track Title}',
  '{Artist Name}',
  '{Artist Name} - {Album Type} - {Album Title}  - {(Album Disambiguation)}/{Artist Name}_{Album Title}_{medium:00}-{track:00}_{Track Title}',
  '{Artist Name} ({Artist MbId})',
  1,
  4,
  NULL
)
ON CONFLICT(name) DO NOTHING;

UPDATE lidarr_naming
SET
  standard_track_format = '{Artist Name} - {Album Type} - {Album Title}  - {(Album Disambiguation)}/{Artist Name}_{Album Title}_{track:00}_{Track Title}',
  artist_name = '{Artist Name}',
  multi_disc_track_format = '{Artist Name} - {Album Type} - {Album Title}  - {(Album Disambiguation)}/{Artist Name}_{Album Title}_{medium:00}-{track:00}_{Track Title}',
  artist_folder_format = '{Artist Name} ({Artist MbId})',
  replace_illegal_characters = 1,
  colon_replacement_format = 4,
  custom_colon_replacement_format = NULL,
  updated_at = CURRENT_TIMESTAMP
WHERE name = 'Lidarr'
  AND (
    standard_track_format LIKE '%{Series TitleYear}%'
    OR standard_track_format LIKE '%S{season:00}E{episode:00}%'
    OR multi_disc_track_format LIKE '%{Series TitleYear}%'
    OR multi_disc_track_format LIKE '%S{season:00}E{episode:00}%'
    OR artist_folder_format LIKE '%{tvdb-%}%'
    OR replace_illegal_characters <> 1
    OR colon_replacement_format <> 4
    OR custom_colon_replacement_format IS NOT NULL
  );
-- --- END op 5701

-- --- BEGIN op 5702 ( ensure lidarr_media_settings "Lidarr" default exists and is normalized )
INSERT INTO lidarr_media_settings (
  name,
  propers_repacks,
  enable_media_info,
  created_at,
  updated_at
)
SELECT
  'Lidarr',
  propers_repacks,
  enable_media_info,
  created_at,
  updated_at
FROM lidarr_media_settings
WHERE name = 'Sonarr'
ON CONFLICT(name) DO NOTHING;

DELETE FROM lidarr_media_settings
WHERE name = 'Sonarr';

INSERT INTO lidarr_media_settings (name, propers_repacks, enable_media_info)
VALUES ('Lidarr', 'doNotPrefer', 1)
ON CONFLICT(name) DO NOTHING;
-- --- END op 5702
