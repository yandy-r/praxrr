-- @operation: export
-- @entity: batch
-- @name: Change Default Language Settings/CF for all Profiles
-- @exportedAt: 2026-02-10T16:58:42.574Z
-- @opIds: 1513, 1514, 1515, 1516, 1517, 1518, 1519, 1520, 1521, 1522, 1523, 1524, 1530, 1531, 1532, 1533, 1534, 1535, 1536, 1537, 1538, 1539, 1540, 1541, 1542, 1543, 1544, 1545, 1546, 1547, 1548, 1549, 1550, 1551, 1552, 1553, 1554, 1555, 1556, 1557, 1558, 1559, 1560, 1561, 1562

-- --- BEGIN op 1513 ( update quality_profile "1080p Balanced" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '1080p Balanced' AND language_name = 'Original' AND type = 'simple';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '1080p Balanced', 'Any', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '1080p Balanced' AND type = 'simple'
);
-- --- END op 1513

-- --- BEGIN op 1514 ( update quality_profile "1080p Compact" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '1080p Compact' AND language_name = 'Original' AND type = 'simple';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '1080p Compact', 'Any', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '1080p Compact' AND type = 'simple'
);
-- --- END op 1514

-- --- BEGIN op 1515 ( update quality_profile "1080p Efficient" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '1080p Efficient' AND language_name = 'Original' AND type = 'simple';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '1080p Efficient', 'Any', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '1080p Efficient' AND type = 'simple'
);
-- --- END op 1515

-- --- BEGIN op 1516 ( update quality_profile "1080p Quality" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '1080p Quality' AND language_name = 'Original' AND type = 'simple';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '1080p Quality', 'Any', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '1080p Quality' AND type = 'simple'
);
-- --- END op 1516

-- --- BEGIN op 1517 ( update quality_profile "1080p Quality HDR" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '1080p Quality HDR' AND language_name = 'Original' AND type = 'simple';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '1080p Quality HDR', 'Any', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '1080p Quality HDR' AND type = 'simple'
);
-- --- END op 1517

-- --- BEGIN op 1518 ( update quality_profile "1080p Remux" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '1080p Remux' AND language_name = 'Original' AND type = 'simple';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '1080p Remux', 'Any', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '1080p Remux' AND type = 'simple'
);
-- --- END op 1518

-- --- BEGIN op 1519 ( update quality_profile "2160p Balanced" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '2160p Balanced' AND language_name = 'Original' AND type = 'simple';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '2160p Balanced', 'Any', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '2160p Balanced' AND type = 'simple'
);
-- --- END op 1519

-- --- BEGIN op 1520 ( update quality_profile "2160p Efficient" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '2160p Efficient' AND language_name = 'Original' AND type = 'simple';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '2160p Efficient', 'Any', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '2160p Efficient' AND type = 'simple'
);
-- --- END op 1520

-- --- BEGIN op 1521 ( update quality_profile "2160p Quality" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '2160p Quality' AND language_name = 'Original' AND type = 'simple';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '2160p Quality', 'Any', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '2160p Quality' AND type = 'simple'
);
-- --- END op 1521

-- --- BEGIN op 1522 ( update quality_profile "2160p Remux" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '2160p Remux' AND language_name = 'Original' AND type = 'simple';
-- --- END op 1522

-- --- BEGIN op 1523 ( update quality_profile "2160p Remux" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '2160p Remux' AND language_name = 'Original' AND type = 'simple';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '2160p Remux', 'Any', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '2160p Remux' AND type = 'simple'
);
-- --- END op 1523

-- --- BEGIN op 1524 ( update quality_profile "720p Quality" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '720p Quality' AND language_name = 'Original' AND type = 'simple';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '720p Quality', 'Any', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '720p Quality' AND type = 'simple'
);
-- --- END op 1524

-- --- BEGIN op 1530 ( update quality_profile "1080p Balanced" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Balanced'
  AND custom_format_name = 'Not Original'
  AND arr_type = 'sonarr'
  AND score = -999999;
-- --- END op 1530

-- --- BEGIN op 1531 ( update quality_profile "1080p Balanced" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Balanced', 'Not Original or English', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Balanced'
    AND custom_format_name = 'Not Original or English'
    AND arr_type = 'sonarr'
);
-- --- END op 1531

-- --- BEGIN op 1532 ( update quality_profile "1080p Compact" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Compact'
  AND custom_format_name = 'Not Original'
  AND arr_type = 'sonarr'
  AND score = -999999;
-- --- END op 1532

-- --- BEGIN op 1533 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Compact', 'Not Original or English', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Compact'
    AND custom_format_name = 'Not Original or English'
    AND arr_type = 'sonarr'
);
-- --- END op 1533

-- --- BEGIN op 1534 ( update quality_profile "1080p Balanced" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Balanced', 'Not Original or English', 'radarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Balanced'
    AND custom_format_name = 'Not Original or English'
    AND arr_type = 'radarr'
);
-- --- END op 1534

-- --- BEGIN op 1535 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Compact', 'Not Original or English', 'radarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Compact'
    AND custom_format_name = 'Not Original or English'
    AND arr_type = 'radarr'
);
-- --- END op 1535

-- --- BEGIN op 1536 ( update quality_profile "1080p Efficient" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = 'Not Original'
  AND arr_type = 'sonarr'
  AND score = -999999;
-- --- END op 1536

-- --- BEGIN op 1537 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', 'Not Original or English', 'radarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = 'Not Original or English'
    AND arr_type = 'radarr'
);
-- --- END op 1537

-- --- BEGIN op 1538 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', 'Not Original or English', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = 'Not Original or English'
    AND arr_type = 'sonarr'
);
-- --- END op 1538

-- --- BEGIN op 1539 ( update quality_profile "1080p Quality" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Quality'
  AND custom_format_name = 'Not Original'
  AND arr_type = 'sonarr'
  AND score = -999999;
-- --- END op 1539

-- --- BEGIN op 1540 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Quality', 'Not Original or English', 'radarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Quality'
    AND custom_format_name = 'Not Original or English'
    AND arr_type = 'radarr'
);
-- --- END op 1540

-- --- BEGIN op 1541 ( update quality_profile "1080p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Quality', 'Not Original or English', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Quality'
    AND custom_format_name = 'Not Original or English'
    AND arr_type = 'sonarr'
);
-- --- END op 1541

-- --- BEGIN op 1542 ( update quality_profile "1080p Quality HDR" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Quality HDR'
  AND custom_format_name = 'Not Original'
  AND arr_type = 'sonarr'
  AND score = -999999;
-- --- END op 1542

-- --- BEGIN op 1543 ( update quality_profile "1080p Quality HDR" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Quality HDR', 'Not Original or English', 'radarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Quality HDR'
    AND custom_format_name = 'Not Original or English'
    AND arr_type = 'radarr'
);
-- --- END op 1543

-- --- BEGIN op 1544 ( update quality_profile "1080p Quality HDR" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Quality HDR', 'Not Original or English', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Quality HDR'
    AND custom_format_name = 'Not Original or English'
    AND arr_type = 'sonarr'
);
-- --- END op 1544

-- --- BEGIN op 1545 ( update quality_profile "1080p Remux" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Remux'
  AND custom_format_name = 'Not Original'
  AND arr_type = 'sonarr'
  AND score = -999999;
-- --- END op 1545

-- --- BEGIN op 1546 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Remux', 'Not Original or English', 'radarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Remux'
    AND custom_format_name = 'Not Original or English'
    AND arr_type = 'radarr'
);
-- --- END op 1546

-- --- BEGIN op 1547 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Remux', 'Not Original or English', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Remux'
    AND custom_format_name = 'Not Original or English'
    AND arr_type = 'sonarr'
);
-- --- END op 1547

-- --- BEGIN op 1548 ( update quality_profile "2160p Balanced" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '2160p Balanced'
  AND custom_format_name = 'Not Original'
  AND arr_type = 'sonarr'
  AND score = -999999;
-- --- END op 1548

-- --- BEGIN op 1549 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Balanced', 'Not Original or English', 'radarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Balanced'
    AND custom_format_name = 'Not Original or English'
    AND arr_type = 'radarr'
);
-- --- END op 1549

-- --- BEGIN op 1550 ( update quality_profile "2160p Balanced" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Balanced', 'Not Original or English', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Balanced'
    AND custom_format_name = 'Not Original or English'
    AND arr_type = 'sonarr'
);
-- --- END op 1550

-- --- BEGIN op 1551 ( update quality_profile "2160p Efficient" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = 'Not Original'
  AND arr_type = 'sonarr'
  AND score = -999999;
-- --- END op 1551

-- --- BEGIN op 1552 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', 'Not Original or English', 'radarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = 'Not Original or English'
    AND arr_type = 'radarr'
);
-- --- END op 1552

-- --- BEGIN op 1553 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', 'Not Original or English', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = 'Not Original or English'
    AND arr_type = 'sonarr'
);
-- --- END op 1553

-- --- BEGIN op 1554 ( update quality_profile "2160p Quality" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '2160p Quality'
  AND custom_format_name = 'Not Original'
  AND arr_type = 'sonarr'
  AND score = -999999;
-- --- END op 1554

-- --- BEGIN op 1555 ( update quality_profile "2160p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Quality', 'Not Original or English', 'radarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Quality'
    AND custom_format_name = 'Not Original or English'
    AND arr_type = 'radarr'
);
-- --- END op 1555

-- --- BEGIN op 1556 ( update quality_profile "2160p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Quality', 'Not Original or English', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Quality'
    AND custom_format_name = 'Not Original or English'
    AND arr_type = 'sonarr'
);
-- --- END op 1556

-- --- BEGIN op 1557 ( update quality_profile "2160p Remux" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '2160p Remux'
  AND custom_format_name = 'Not Original'
  AND arr_type = 'sonarr'
  AND score = -999999;
-- --- END op 1557

-- --- BEGIN op 1558 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Remux', 'Not Original or English', 'radarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Remux'
    AND custom_format_name = 'Not Original or English'
    AND arr_type = 'radarr'
);
-- --- END op 1558

-- --- BEGIN op 1559 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Remux', 'Not Original or English', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Remux'
    AND custom_format_name = 'Not Original or English'
    AND arr_type = 'sonarr'
);
-- --- END op 1559

-- --- BEGIN op 1560 ( update quality_profile "720p Quality" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '720p Quality'
  AND custom_format_name = 'Not Original'
  AND arr_type = 'sonarr'
  AND score = -999999;
-- --- END op 1560

-- --- BEGIN op 1561 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', 'Not Original or English', 'radarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = 'Not Original or English'
    AND arr_type = 'radarr'
);
-- --- END op 1561

-- --- BEGIN op 1562 ( update quality_profile "720p Quality" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '720p Quality', 'Not Original or English', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '720p Quality'
    AND custom_format_name = 'Not Original or English'
    AND arr_type = 'sonarr'
);
-- --- END op 1562
