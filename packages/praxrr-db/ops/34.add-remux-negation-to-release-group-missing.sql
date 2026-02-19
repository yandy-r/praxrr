-- @operation: export
-- @entity: batch
-- @name: Add Remux Negation to Release Group (Missing)
-- @exportedAt: 2026-02-09T01:11:39.739Z
-- @opIds: 1422, 1423, 1424

-- --- BEGIN op 1422 ( update custom_format "Release Group (Missing)" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('Release Group (Missing)', 'Remux Quality Match', 'quality_modifier', 'radarr', 1, 0);

INSERT INTO condition_quality_modifiers (custom_format_name, condition_name, quality_modifier) VALUES ('Release Group (Missing)', 'Remux Quality Match', 'remux');
-- --- END op 1422

-- --- BEGIN op 1423 ( update custom_format "Release Group (Missing)" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('Release Group (Missing)', 'Remux Source', 'source', 'sonarr', 1, 0);

INSERT INTO condition_sources (custom_format_name, condition_name, source) VALUES ('Release Group (Missing)', 'Remux Source', 'bluray_raw');
-- --- END op 1423

-- --- BEGIN op 1424 ( update custom_format "Release Group (Missing)" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('Release Group (Missing)', 'Remux', 'release_title', 'all', 1, 0);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES ('Release Group (Missing)', 'Remux', 'Remux');
-- --- END op 1424
