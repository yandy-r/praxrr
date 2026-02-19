-- @operation: export
-- @entity: batch
-- @name: Remove RARBG from 265 Profile Ban and add to Compact TV Trash Tiers
-- @exportedAt: 2026-02-12T14:48:59.791Z
-- @opIds: 87, 88, 89

-- --- BEGIN op 87 ( update custom_format "Banned Groups (Efficient)" )
DELETE FROM custom_format_conditions
	WHERE custom_format_name = 'Banned Groups (Efficient)'
	  AND name = 'RARBG'
	  AND type = 'release_group'
	  AND arr_type = 'all'
	  AND negate = 0
	  AND required = 0;
-- --- END op 87

-- --- BEGIN op 88 ( update custom_format "1080p Compact TV Trash Tier 1" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('1080p Compact TV Trash Tier 1', 'RARBG', 'release_group', 'all', 0, 0);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES ('1080p Compact TV Trash Tier 1', 'RARBG', 'RARBG');
-- --- END op 88

-- --- BEGIN op 89 ( update custom_format "1080p Compact TV Trash Tier 2" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('1080p Compact TV Trash Tier 2', 'RARBG', 'release_group', 'all', 0, 0);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES ('1080p Compact TV Trash Tier 2', 'RARBG', 'RARBG');
-- --- END op 89
