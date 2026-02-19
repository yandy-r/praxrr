-- @operation: export
-- @entity: delay_profile
-- @name: Add Default Delay Profile - Prefer Usenet
-- @exportedAt: 2026-01-31T19:14:49.000Z
-- @opIds: 66

-- --- BEGIN op 66 ( create delay_profile "Prefer Usenet" )
insert into "delay_profiles" ("name", "preferred_protocol", "usenet_delay", "torrent_delay", "bypass_if_highest_quality", "bypass_if_above_custom_format_score", "minimum_custom_format_score") values ('Prefer Usenet', 'prefer_usenet', 5, 10, 0, 0, NULL);
-- --- END op 66
