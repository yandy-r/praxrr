-- @operation: export
-- @entity: batch
-- @name: Change Not Original or English Conditions
-- @exportedAt: 2026-02-10T01:47:14.030Z
-- @opIds: 1510, 1511

-- --- BEGIN op 1510 ( update custom_format "Not Original or English" )
UPDATE custom_format_conditions
SET required = 1
WHERE custom_format_name = 'Not Original or English'
  AND name = 'English'
  AND type = 'language'
  AND arr_type = 'all'
  AND negate = 1
  AND required = 0;
-- --- END op 1510

-- --- BEGIN op 1511 ( update custom_format "Not Original or English" )
UPDATE custom_format_conditions
SET required = 1
WHERE custom_format_name = 'Not Original or English'
  AND name = 'Original'
  AND type = 'language'
  AND arr_type = 'all'
  AND negate = 1
  AND required = 0;
-- --- END op 1511
