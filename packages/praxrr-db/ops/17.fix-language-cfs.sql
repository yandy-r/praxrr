-- @operation: export
-- @entity: batch
-- @name: Fix Language CFs
-- @exportedAt: 2026-02-04T19:18:18.544Z
-- @opIds: 290, 294, 295, 296, 297, 298, 299, 300, 301, 302, 303, 304, 305

-- --- BEGIN op 290 ( update custom_format "Not Original" )
update "custom_formats" set "description" = 'Matches releases that don''''t include the Original language track. Dual audio is allowed' where "name" = 'Not Original' and "description" is null;
-- --- END op 290

-- --- BEGIN op 294 ( create custom_format "Only Original" )
insert into "custom_formats" ("name", "description") values ('Only Original', '');
-- --- END op 294

-- --- BEGIN op 295 ( update custom_format "Only Original" )
update "custom_formats" set "description" = 'Matches releases that don''t include an Original language track. Dual audio is NOT allowed.' where "name" = 'Only Original' and "description" = '';
-- --- END op 295

-- --- BEGIN op 296 ( update custom_format "Only Original" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('Only Original', 'Original', 'language', 'all', 0, 1);

INSERT INTO condition_languages (custom_format_name, condition_name, language_name, except_language) VALUES ('Only Original', 'Original', 'Original', 0);
-- --- END op 296

-- --- BEGIN op 297 ( update custom_format "Only Original" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('Only Original', 'Not Original', 'language', 'all', 0, 1);

INSERT INTO condition_languages (custom_format_name, condition_name, language_name, except_language) VALUES ('Only Original', 'Not Original', 'Original', 1);
-- --- END op 297

-- --- BEGIN op 298 ( update custom_format "Only Original" )
update "custom_formats" set "description" = 'Matches releases that don''t include the Original language track. Dual audio is NOT allowed.' where "name" = 'Only Original' and "description" = 'Matches releases that don''t include an Original language track. Dual audio is NOT allowed.';
-- --- END op 298

-- --- BEGIN op 299 ( update custom_format "Not Only Original" )
update "custom_formats" set "name" = 'Not Only Original' where "name" = 'Only Original';
-- --- END op 299

-- --- BEGIN op 300 ( delete custom_format "Not Only English (Missing)" )
delete from "custom_formats" where "name" = 'Not Only English (Missing)';
-- --- END op 300

-- --- BEGIN op 301 ( delete custom_format "Not English" )
delete from "custom_formats" where "name" = 'Not English';
-- --- END op 301

-- --- BEGIN op 302 ( delete custom_format "Not Only English" )
delete from "custom_formats" where "name" = 'Not Only English';
-- --- END op 302

-- --- BEGIN op 303 ( update custom_format "Not Original" )
update "custom_formats" set "description" = 'Matches releases that don''''t include the Original language track. Multiple audio tracks is allowed' where "name" = 'Not Original' and "description" = 'Matches releases that don''''t include the Original language track. Dual audio is allowed';
-- --- END op 303

-- --- BEGIN op 304 ( update custom_format "Not Only Original" )
update "custom_formats" set "description" = 'Matches releases that don''t include the Original language track. Multiple audio tracks is NOT allowed.' where "name" = 'Not Only Original' and "description" = 'Matches releases that don''t include the Original language track. Dual audio is NOT allowed.';
-- --- END op 304

-- --- BEGIN op 305 ( update custom_format "Not Only Original" )
insert into "tags" ("name") values ('Language') on conflict ("name") do nothing;

INSERT INTO custom_format_tags (custom_format_name, tag_name) VALUES ('Not Only Original', 'Language');
-- --- END op 305
