-- @operation: export
-- @entity: batch
-- @name: Add Back Quality Match and Source Conditions to Original Remux CF
-- @exportedAt: 2026-01-31T20:46:19.670Z
-- @opIds: 189

-- --- BEGIN op 189 ( update custom_format "Remux" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('Remux', 'Remux Quality Match', 'quality_modifier', 'radarr', 0, 0);

INSERT INTO condition_quality_modifiers (custom_format_name, condition_name, quality_modifier) VALUES ('Remux', 'Remux Quality Match', 'remux');

INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('Remux', 'Remux Source', 'source', 'sonarr', 0, 0);

INSERT INTO condition_sources (custom_format_name, condition_name, source) VALUES ('Remux', 'Remux Source', 'bluray_raw');

UPDATE custom_format_conditions
SET required = 0
WHERE custom_format_name = 'Remux'
  AND name = 'Remux'
  AND type = 'release_title'
  AND arr_type = 'all'
  AND negate = 0
  AND required = 1;
-- --- END op 189
