-- @operation: export
-- @entity: batch
-- @name: update: include AMZN custom format in renames
-- @exportedAt: 2026-01-31T00:22:56.654Z
-- @opIds: 436

-- --- BEGIN op 436 ( update custom_format "AMZN" )
update "custom_formats" set "include_in_rename" = 1 where "name" = 'AMZN' and "include_in_rename" = 0;
-- --- END op 436
