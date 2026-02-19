-- @operation: export
-- @entity: batch
-- @name: Create Not Original or English CF
-- @exportedAt: 2026-02-10T01:02:29.481Z
-- @opIds: 1496, 1497, 1498, 1499, 1500, 1501, 1502, 1503, 1504, 1505, 1506, 1507, 1508

-- --- BEGIN op 1496 ( create custom_format "Not Original or English" )
insert into "custom_formats" ("name", "description") values ('Not Original or English', '');
-- --- END op 1496

-- --- BEGIN op 1497 ( update custom_format "Not Original or English" )
update "custom_formats" set "description" = 'Matches releases that don''''t include the Original or English language track. Multiple audio tracks is allowed' where "name" = 'Not Original or English' and "description" = '';
-- --- END op 1497

-- --- BEGIN op 1498 ( update custom_format "Not Original or English" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('Not Original or English', 'Original', 'language', 'all', 1, 0);

INSERT INTO condition_languages (custom_format_name, condition_name, language_name, except_language) VALUES ('Not Original or English', 'Original', 'Original', 0);
-- --- END op 1498

-- --- BEGIN op 1499 ( update custom_format "Not Original or English" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('Not Original or English', 'English', 'language', 'all', 1, 0);

INSERT INTO condition_languages (custom_format_name, condition_name, language_name, except_language) VALUES ('Not Original or English', 'English', 'English', 0);
-- --- END op 1499

-- --- BEGIN op 1500 ( update custom_format "Not Original or English" )
insert into "tags" ("name") values ('Language') on conflict ("name") do nothing;

INSERT INTO custom_format_tags (custom_format_name, tag_name) VALUES ('Not Original or English', 'Language');
-- --- END op 1500

-- --- BEGIN op 1501 ( update custom_format "Not Only Original" )
update "custom_formats" set "description" = 'Matches releases that don''t include the Original language track. Multiple audio tracks are NOT allowed.' where "name" = 'Not Only Original' and "description" = 'Matches releases that don''t include the Original language track. Multiple audio tracks is NOT allowed.';
-- --- END op 1501

-- --- BEGIN op 1502 ( update custom_format "Not Only Original" )
update "custom_formats" set "description" = 'Matches releases that don''t include the Original language. Multiple audio tracks are NOT allowed.' where "name" = 'Not Only Original' and "description" = 'Matches releases that don''t include the Original language track. Multiple audio tracks are NOT allowed.';
-- --- END op 1502

-- --- BEGIN op 1503 ( update custom_format "Not Original" )
update "custom_formats" set "description" = 'Matches releases that don''''t include the Original language. Multiple audio tracks is allowed' where "name" = 'Not Original' and "description" = 'Matches releases that don''''t include the Original language track. Multiple audio tracks is allowed';
-- --- END op 1503

-- --- BEGIN op 1504 ( update custom_format "Not Original" )
update "custom_formats" set "description" = 'Matches releases that don''''t include the Original language. Multiple audio tracks are allowed' where "name" = 'Not Original' and "description" = 'Matches releases that don''''t include the Original language. Multiple audio tracks is allowed';
-- --- END op 1504

-- --- BEGIN op 1505 ( update custom_format "Not Original or English" )
update "custom_formats" set "description" = 'Matches releases that don''''t include the Original or English language. Multiple audio tracks is allowed' where "name" = 'Not Original or English' and "description" = 'Matches releases that don''''t include the Original or English language track. Multiple audio tracks is allowed';
-- --- END op 1505

-- --- BEGIN op 1506 ( update custom_format "Not Only Original" )
update "custom_formats" set "description" = 'Matches releases that don''t include the Original language. Other Languages are NOT allowed.' where "name" = 'Not Only Original' and "description" = 'Matches releases that don''t include the Original language. Multiple audio tracks are NOT allowed.';
-- --- END op 1506

-- --- BEGIN op 1507 ( update custom_format "Not Original" )
update "custom_formats" set "description" = 'Matches releases that don''''t include the Original language. Other Languages are allowed.' where "name" = 'Not Original' and "description" = 'Matches releases that don''''t include the Original language. Multiple audio tracks are allowed';
-- --- END op 1507

-- --- BEGIN op 1508 ( update custom_format "Not Original or English" )
update "custom_formats" set "description" = 'Matches releases that don''''t include the Original or English language. Other Languages are allowed.' where "name" = 'Not Original or English' and "description" = 'Matches releases that don''''t include the Original or English language. Multiple audio tracks is allowed';
-- --- END op 1508
