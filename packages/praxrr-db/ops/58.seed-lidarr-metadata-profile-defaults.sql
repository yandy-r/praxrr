-- @operation: export
-- @entity: batch
-- @name: Seed Lidarr Metadata Profile Defaults
-- @exportedAt: 2026-02-24T00:00:00.000Z
-- @opIds: 5801

-- --- BEGIN op 5801 ( ensure lidarr_metadata_profile "Lidarr (Praxrr)" exists )
INSERT INTO lidarr_metadata_profiles (name, description)
VALUES ('Lidarr (Praxrr)', 'Default Lidarr metadata profile')
ON CONFLICT(name) DO NOTHING;

INSERT INTO lidarr_metadata_profile_primary_types (
  metadata_profile_name,
  type_id,
  name,
  allowed
)
VALUES
  ('Lidarr (Praxrr)', 0, 'Album', 1),
  ('Lidarr (Praxrr)', 1, 'EP', 1),
  ('Lidarr (Praxrr)', 2, 'Single', 1),
  ('Lidarr (Praxrr)', 3, 'Broadcast', 0),
  ('Lidarr (Praxrr)', 4, 'Other', 0)
ON CONFLICT(metadata_profile_name, type_id) DO NOTHING;

INSERT INTO lidarr_metadata_profile_secondary_types (
  metadata_profile_name,
  type_id,
  name,
  allowed
)
VALUES
  ('Lidarr (Praxrr)', 0, 'Studio', 1),
  ('Lidarr (Praxrr)', 1, 'Compilation', 1),
  ('Lidarr (Praxrr)', 2, 'Soundtrack', 0),
  ('Lidarr (Praxrr)', 3, 'Spokenword', 0),
  ('Lidarr (Praxrr)', 4, 'Interview', 0),
  ('Lidarr (Praxrr)', 6, 'Live', 0),
  ('Lidarr (Praxrr)', 7, 'Remix', 1),
  ('Lidarr (Praxrr)', 8, 'DJ-mix', 0),
  ('Lidarr (Praxrr)', 9, 'Mixtape/Street', 0),
  ('Lidarr (Praxrr)', 10, 'Demo', 0),
  ('Lidarr (Praxrr)', 11, 'Audio drama', 0)
ON CONFLICT(metadata_profile_name, type_id) DO NOTHING;

INSERT INTO lidarr_metadata_profile_release_statuses (
  metadata_profile_name,
  status_id,
  name,
  allowed
)
VALUES
  ('Lidarr (Praxrr)', 0, 'Official', 1),
  ('Lidarr (Praxrr)', 1, 'Promotion', 0),
  ('Lidarr (Praxrr)', 2, 'Bootleg', 0),
  ('Lidarr (Praxrr)', 3, 'Pseudo-Release', 0)
ON CONFLICT(metadata_profile_name, status_id) DO NOTHING;
-- --- END op 5801
