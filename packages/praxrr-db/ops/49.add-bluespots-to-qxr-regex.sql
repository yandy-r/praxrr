-- @operation: export
-- @entity: batch
-- @name: Add Bluespots to QxR Regex
-- @exportedAt: 2026-02-12T14:54:36.723Z
-- @opIds: 91

-- --- BEGIN op 91 ( update regular_expression "QxR" )
update "regular_expressions" set "pattern" = '(?<=^|[\s.-])(QxR|afm72|Bandi|Bluespots|Celdra|FreetheFish|Garshasp|Ghost|Ime|Kappa|Langbard|LION|Panda|MONOLITH|Natty|r00t|RCVR|RZeroX|SAMPA|Silence|t3nzin|Tigole|YOGI)\b' where "name" = 'QxR' and "pattern" = '(?<=^|[\s.-])(QxR|afm72|Bandi|Celdra|FreetheFish|Garshasp|Ghost|Ime|Kappa|Langbard|LION|Panda|MONOLITH|Natty|r00t|RCVR|RZeroX|SAMPA|Silence|t3nzin|Tigole|YOGI)\b';
-- --- END op 91
