-- @operation: export
-- @entity: batch
-- @name: Require HDTV CFs to match HDTV Regex
-- @exportedAt: 2026-02-04T23:41:40.202Z
-- @opIds: 336, 337, 338, 339, 340, 341, 342, 343, 344, 345, 346, 347

-- --- BEGIN op 336 ( create regular_expression "HDTV" )
insert into "regular_expressions" ("name", "pattern", "description", "regex101_id") values ('HDTV', '\b(HDTV)\b', NULL, NULL);
-- --- END op 336

-- --- BEGIN op 337 ( update custom_format "1080p HDTV Tier 1" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('1080p HDTV Tier 1', 'HDTV Regex', 'release_title', 'all', 0, 1);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES ('1080p HDTV Tier 1', 'HDTV Regex', 'HDTV');
-- --- END op 337

-- --- BEGIN op 338 ( update custom_format "1080p HDTV Tier 2" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('1080p HDTV Tier 2', 'HDTV Regex', 'release_title', 'all', 0, 1);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES ('1080p HDTV Tier 2', 'HDTV Regex', 'HDTV');
-- --- END op 338

-- --- BEGIN op 339 ( update custom_format "1080p HDTV Tier 3" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('1080p HDTV Tier 3', 'HDTV Regex', 'release_title', 'all', 0, 1);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES ('1080p HDTV Tier 3', 'HDTV Regex', 'HDTV');
-- --- END op 339

-- --- BEGIN op 340 ( update custom_format "720p HDTV" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('720p HDTV', 'HDTV Regex', 'release_title', 'all', 0, 0);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES ('720p HDTV', 'HDTV Regex', 'HDTV');
-- --- END op 340

-- --- BEGIN op 341 ( update custom_format "720p HDTV" )
DELETE FROM custom_format_conditions
WHERE custom_format_name = '720p HDTV'
  AND name = 'Sourceless Groups'
  AND type = 'release_title'
  AND arr_type = 'all'
  AND negate = 1
  AND required = 1;
-- --- END op 341

-- --- BEGIN op 342 ( update custom_format "720p HDTV" )
UPDATE custom_format_conditions
SET required = 1
WHERE custom_format_name = '720p HDTV'
  AND name = 'HDTV Regex'
  AND type = 'release_title'
  AND arr_type = 'all'
  AND negate = 0
  AND required = 0;
-- --- END op 342

-- --- BEGIN op 343 ( update custom_format "1080p HDTV" )
DELETE FROM custom_format_conditions
WHERE custom_format_name = '1080p HDTV'
  AND name = 'Sourceless Groups'
  AND type = 'release_group'
  AND arr_type = 'all'
  AND negate = 1
  AND required = 1;
-- --- END op 343

-- --- BEGIN op 344 ( update custom_format "1080p HDTV" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('1080p HDTV', 'HDTV Regex', 'release_title', 'all', 0, 1);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES ('1080p HDTV', 'HDTV Regex', 'HDTV');
-- --- END op 344

-- --- BEGIN op 345 ( update custom_format "720p HDTV Tier 1" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('720p HDTV Tier 1', 'HDTV Regex', 'release_title', 'all', 0, 1);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES ('720p HDTV Tier 1', 'HDTV Regex', 'HDTV');
-- --- END op 345

-- --- BEGIN op 346 ( update custom_format "720p HDTV Tier 2" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('720p HDTV Tier 2', 'HDTV Regex', 'release_title', 'all', 0, 1);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES ('720p HDTV Tier 2', 'HDTV Regex', 'HDTV');
-- --- END op 346

-- --- BEGIN op 347 ( update custom_format "720p HDTV Tier 3" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('720p HDTV Tier 3', 'HDTV Regex', 'release_title', 'all', 0, 1);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name) VALUES ('720p HDTV Tier 3', 'HDTV Regex', 'HDTV');
-- --- END op 347
