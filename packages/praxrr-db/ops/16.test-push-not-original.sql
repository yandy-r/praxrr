-- @operation: export
-- @entity: batch
-- @name: Test Push Not Original
-- @exportedAt: 2026-02-04T04:18:05.427Z
-- @opIds: 263, 264, 281, 282

-- --- BEGIN op 263 ( update custom_format "Not Original" )
update "custom_formats" set "description" = 'Matches releases that don''t include the Original language track. Dual audio is allowed.' where "name" = 'Not Original' and "description" = '';
-- --- END op 263

-- --- BEGIN op 264 ( update custom_format "Not Original" )
update "custom_formats" set "description" = 'Matches releases that don''t include the Original language track. Dual audio is allowed.' where "name" = 'Not Original' and "description" = '';
-- --- END op 264

-- --- BEGIN op 281 ( update custom_format "Not Original" )
insert into "tags" ("name") values ('Language') on conflict ("name") do nothing;

INSERT INTO custom_format_tags (custom_format_name, tag_name) VALUES ('Not Original', 'Language');
-- --- END op 281

-- --- BEGIN op 282 ( update custom_format "Not Original" )
update "custom_formats" set "description" = 'Matches releases that don''t include the Original language track. Dual audio is allowed' where "name" = 'Not Original' and "description" = '';
-- --- END op 282
