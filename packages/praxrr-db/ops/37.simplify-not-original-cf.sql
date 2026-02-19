-- @operation: export
-- @entity: batch
-- @name: Simplify Not Original CF
-- @exportedAt: 2026-02-10T00:52:40.489Z
-- @opIds: 1492

-- --- BEGIN op 1492 ( update custom_format "Not Original" )
DELETE FROM custom_format_conditions
	WHERE custom_format_name = 'Not Original'
	  AND name = 'Not Original'
	  AND type = 'language'
	  AND arr_type = 'all'
	  AND negate = 0
	  AND required = 1;
-- --- END op 1492
