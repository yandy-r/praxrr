-- @operation: export
-- @entity: batch
-- @name: Add 2160p Negation to SDTV CFs
-- @exportedAt: 2026-02-11T18:40:33.734Z
-- @opIds: 54, 55

-- --- BEGIN op 54 ( update custom_format "SDTV" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('SDTV', 'Not 2160p', 'resolution', 'all', 1, 1);

INSERT INTO condition_resolutions (custom_format_name, condition_name, resolution) VALUES ('SDTV', 'Not 2160p', '2160p');
-- --- END op 54

-- --- BEGIN op 55 ( update custom_format "SDTV Tier 1" )
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('SDTV Tier 1', 'Not 2160p', 'resolution', 'all', 1, 1);

INSERT INTO condition_resolutions (custom_format_name, condition_name, resolution) VALUES ('SDTV Tier 1', 'Not 2160p', '2160p');
-- --- END op 55
