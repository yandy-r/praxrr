-- @operation: export
-- @entity: batch
-- @name: Add BLOOM to WEB-DL Tier 4
-- @exportedAt: 2026-02-04T01:34:49.323Z
-- @opIds: 196, 197

-- --- BEGIN op 196 ( create regular_expression "BLOOM" )
insert into "regular_expressions" ("name", "pattern", "description", "regex101_id") values ('BLOOM', '(?<=^|[\s.-])BLOOM\b', 'Matches "<group>" when preceded by whitespace, a hyphen or dot', NULL);

insert into "tags" ("name") values ('Release Group') on conflict ("name") do nothing;

INSERT INTO regular_expression_tags (regular_expression_name, tag_name) VALUES ('BLOOM', 'Release Group');

insert into "tags" ("name") values ('WEB-DL') on conflict ("name") do nothing;

INSERT INTO regular_expression_tags (regular_expression_name, tag_name) VALUES ('BLOOM', 'WEB-DL');
-- --- END op 196

-- --- BEGIN op 197 ( update custom_format "WEB-DL Tier 4" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('WEB-DL Tier 4', 'BLOOM', 'release_group', 'all', 0, 0);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES ('WEB-DL Tier 4', 'BLOOM', 'BLOOM');
-- --- END op 197
