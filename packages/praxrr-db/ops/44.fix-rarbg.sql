-- @operation: export
-- @entity: batch
-- @name: Fix RARBG
-- @exportedAt: 2026-02-11T18:21:00.406Z
-- @opIds: 46, 47, 48, 49, 50, 51, 52

-- --- BEGIN op 46 ( update regular_expression "RARBG" )
update "regular_expressions" set "name" = 'RARBG', "pattern" = '(?<=^|[\s.-])RARBG\b' where "name" = 'RARGB' and "pattern" = '(?<=^|[\s.-])RARGB\b';
-- --- END op 46

-- --- BEGIN op 47 ( update custom_format "Banned Groups" )
update "condition_patterns" set "regular_expression_name" = 'RARBG' where "custom_format_name" = 'Banned Groups' and "condition_name" = 'RARGB' and "regular_expression_name" = 'RARGB';
-- --- END op 47

-- --- BEGIN op 48 ( update custom_format "Banned Groups (Efficient)" )
update "condition_patterns" set "regular_expression_name" = 'RARBG' where "custom_format_name" = 'Banned Groups (Efficient)' and "condition_name" = 'RARGB' and "regular_expression_name" = 'RARGB';
-- --- END op 48

-- --- BEGIN op 49 ( update custom_format "Banned Groups" )
DELETE FROM custom_format_conditions
	WHERE custom_format_name = 'Banned Groups'
	  AND name = 'RARGB'
	  AND type = 'release_group'
	  AND arr_type = 'all'
	  AND negate = 0
	  AND required = 0;
-- --- END op 49

-- --- BEGIN op 50 ( update custom_format "Banned Groups" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('Banned Groups', 'RARBG', 'release_group', 'all', 0, 0);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES ('Banned Groups', 'RARBG', 'RARBG');
-- --- END op 50

-- --- BEGIN op 51 ( update custom_format "Banned Groups (Efficient)" )
DELETE FROM custom_format_conditions
	WHERE custom_format_name = 'Banned Groups (Efficient)'
	  AND name = 'RARGB'
	  AND type = 'release_group'
	  AND arr_type = 'all'
	  AND negate = 0
	  AND required = 0;
-- --- END op 51

-- --- BEGIN op 52 ( update custom_format "Banned Groups (Efficient)" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('Banned Groups (Efficient)', 'RARBG', 'release_group', 'all', 0, 0);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES ('Banned Groups (Efficient)', 'RARBG', 'RARBG');
-- --- END op 52
