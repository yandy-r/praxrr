-- @operation: export
-- @entity: batch
-- @name: Fix Release Group (Missing) CF
-- @exportedAt: 2026-02-09T01:06:11.523Z
-- @opIds: 1420

-- --- BEGIN op 1420 ( update custom_format "Release Group (Missing)" )
UPDATE custom_format_conditions
SET type = 'release_group'
WHERE custom_format_name = 'Release Group (Missing)'
  AND name = 'Release Group (Missing)'
  AND type = 'release_title'
  AND arr_type = 'all'
  AND negate = 1
  AND required = 0;

DELETE FROM condition_patterns WHERE custom_format_name = 'Release Group (Missing)' AND condition_name = 'Release Group (Missing)' AND regular_expression_name = 'Release Group (Missing)';

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES ('Release Group (Missing)', 'Release Group (Missing)', 'Release Group (Missing)');
-- --- END op 1420
