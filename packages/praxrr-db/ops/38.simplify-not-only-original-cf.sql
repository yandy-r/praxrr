-- @operation: export
-- @entity: batch
-- @name: Simplify Not Only Original CF
-- @exportedAt: 2026-02-10T00:55:56.267Z
-- @opIds: 1494

-- --- BEGIN op 1494 ( update custom_format "Not Only Original" )
DELETE FROM custom_format_conditions
	WHERE custom_format_name = 'Not Only Original'
	  AND name = 'Original'
	  AND type = 'language'
	  AND arr_type = 'all'
	  AND negate = 0
	  AND required = 1;
-- --- END op 1494
