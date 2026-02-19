-- @operation: export
-- @entity: batch
-- @name: Remove WEBRip Source CFs from Sonarr Side of All Profiles
-- @exportedAt: 2026-02-09T17:54:21.273Z
-- @opIds: 1447, 1448, 1449, 1450, 1451, 1452, 1453, 1454, 1455, 1456, 1457, 1458, 1459, 1460, 1461, 1462, 1463, 1464, 1465, 1466, 1467, 1468, 1469, 1470, 1471, 1472, 1473, 1474, 1475, 1476, 1477, 1478, 1479, 1480, 1481, 1482, 1483, 1484, 1485, 1486, 1487, 1488, 1489, 1490

-- --- BEGIN op 1447 ( update quality_profile "1080p Balanced" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Balanced'
  AND custom_format_name = '720p WEBRip'
  AND arr_type = 'all'
  AND score = 180000;
-- --- END op 1447

-- --- BEGIN op 1448 ( update quality_profile "1080p Balanced" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Balanced'
  AND custom_format_name = '720p WEBRip'
  AND arr_type = 'sonarr'
  AND score = 460000;
-- --- END op 1448

-- --- BEGIN op 1449 ( update quality_profile "1080p Quality" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Quality'
  AND custom_format_name = '1080p WEBRip'
  AND arr_type = 'all'
  AND score = 280000;
-- --- END op 1449

-- --- BEGIN op 1450 ( update quality_profile "1080p Quality" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Quality'
  AND custom_format_name = '720p WEBRip'
  AND arr_type = 'all'
  AND score = 180000;
-- --- END op 1450

-- --- BEGIN op 1451 ( update quality_profile "1080p Quality" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Quality'
  AND custom_format_name = '1080p WEBRip'
  AND arr_type = 'sonarr'
  AND score = 620000;
-- --- END op 1451

-- --- BEGIN op 1452 ( update quality_profile "1080p Quality" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Quality'
  AND custom_format_name = '720p WEBRip'
  AND arr_type = 'sonarr'
  AND score = 460000;
-- --- END op 1452

-- --- BEGIN op 1453 ( update quality_profile "1080p Quality HDR" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Quality HDR'
  AND custom_format_name = '1080p WEBRip'
  AND arr_type = 'all'
  AND score = 280000;
-- --- END op 1453

-- --- BEGIN op 1454 ( update quality_profile "1080p Quality HDR" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Quality HDR'
  AND custom_format_name = '720p WEBRip'
  AND arr_type = 'all'
  AND score = 180000;
-- --- END op 1454

-- --- BEGIN op 1455 ( update quality_profile "1080p Quality HDR" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Quality HDR'
  AND custom_format_name = '1080p WEBRip'
  AND arr_type = 'sonarr'
  AND score = 620000;
-- --- END op 1455

-- --- BEGIN op 1456 ( update quality_profile "1080p Quality HDR" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Quality HDR'
  AND custom_format_name = '720p WEBRip'
  AND arr_type = 'sonarr'
  AND score = 460000;
-- --- END op 1456

-- --- BEGIN op 1457 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Remux', '1080p WEBRip', 'radarr', 280000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Remux'
    AND custom_format_name = '1080p WEBRip'
    AND arr_type = 'radarr'
);
-- --- END op 1457

-- --- BEGIN op 1458 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Remux', '1080p WEBRip', 'sonarr', 280000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Remux'
    AND custom_format_name = '1080p WEBRip'
    AND arr_type = 'sonarr'
);
-- --- END op 1458

-- --- BEGIN op 1459 ( update quality_profile "1080p Remux" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Remux'
  AND custom_format_name = '1080p WEBRip'
  AND arr_type = 'all'
  AND score = 280000;
-- --- END op 1459

-- --- BEGIN op 1460 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Remux', '720p WEBRip', 'radarr', 180000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Remux'
    AND custom_format_name = '720p WEBRip'
    AND arr_type = 'radarr'
);
-- --- END op 1460

-- --- BEGIN op 1461 ( update quality_profile "1080p Remux" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Remux', '720p WEBRip', 'sonarr', 180000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Remux'
    AND custom_format_name = '720p WEBRip'
    AND arr_type = 'sonarr'
);
-- --- END op 1461

-- --- BEGIN op 1462 ( update quality_profile "1080p Remux" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Remux'
  AND custom_format_name = '720p WEBRip'
  AND arr_type = 'all'
  AND score = 180000;
-- --- END op 1462

-- --- BEGIN op 1463 ( update quality_profile "1080p Remux" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Remux'
  AND custom_format_name = '1080p WEBRip'
  AND arr_type = 'sonarr'
  AND score = 280000;
-- --- END op 1463

-- --- BEGIN op 1464 ( update quality_profile "1080p Remux" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Remux'
  AND custom_format_name = '720p WEBRip'
  AND arr_type = 'sonarr'
  AND score = 180000;
-- --- END op 1464

-- --- BEGIN op 1465 ( update quality_profile "2160p Balanced" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '2160p Balanced'
  AND custom_format_name = '1080p WEBRip'
  AND arr_type = 'all'
  AND score = 280000;
-- --- END op 1465

-- --- BEGIN op 1466 ( update quality_profile "2160p Balanced" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '2160p Balanced'
  AND custom_format_name = '720p WEBRip'
  AND arr_type = 'all'
  AND score = 180000;
-- --- END op 1466

-- --- BEGIN op 1467 ( update quality_profile "2160p Balanced" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '2160p Balanced'
  AND custom_format_name = '1080p WEBRip'
  AND arr_type = 'sonarr'
  AND score = 620000;
-- --- END op 1467

-- --- BEGIN op 1468 ( update quality_profile "2160p Balanced" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '2160p Balanced'
  AND custom_format_name = '720p WEBRip'
  AND arr_type = 'sonarr'
  AND score = 460000;
-- --- END op 1468

-- --- BEGIN op 1469 ( update quality_profile "2160p Quality" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '2160p Quality'
  AND custom_format_name = '1080p WEBRip'
  AND arr_type = 'all'
  AND score = 280000;
-- --- END op 1469

-- --- BEGIN op 1470 ( update quality_profile "2160p Quality" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '2160p Quality'
  AND custom_format_name = '720p WEBRip'
  AND arr_type = 'all'
  AND score = 180000;
-- --- END op 1470

-- --- BEGIN op 1471 ( update quality_profile "2160p Quality" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '2160p Quality'
  AND custom_format_name = '1080p WEBRip'
  AND arr_type = 'sonarr'
  AND score = 620000;
-- --- END op 1471

-- --- BEGIN op 1472 ( update quality_profile "2160p Quality" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '2160p Quality'
  AND custom_format_name = '720p WEBRip'
  AND arr_type = 'sonarr'
  AND score = 460000;
-- --- END op 1472

-- --- BEGIN op 1473 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Remux', '1080p WEBRip', 'radarr', 280000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Remux'
    AND custom_format_name = '1080p WEBRip'
    AND arr_type = 'radarr'
);
-- --- END op 1473

-- --- BEGIN op 1474 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Remux', '1080p WEBRip', 'sonarr', 280000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Remux'
    AND custom_format_name = '1080p WEBRip'
    AND arr_type = 'sonarr'
);
-- --- END op 1474

-- --- BEGIN op 1475 ( update quality_profile "2160p Remux" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '2160p Remux'
  AND custom_format_name = '1080p WEBRip'
  AND arr_type = 'all'
  AND score = 280000;
-- --- END op 1475

-- --- BEGIN op 1476 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Remux', '720p WEBRip', 'radarr', 180000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Remux'
    AND custom_format_name = '720p WEBRip'
    AND arr_type = 'radarr'
);
-- --- END op 1476

-- --- BEGIN op 1477 ( update quality_profile "2160p Remux" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Remux', '720p WEBRip', 'sonarr', 180000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Remux'
    AND custom_format_name = '720p WEBRip'
    AND arr_type = 'sonarr'
);
-- --- END op 1477

-- --- BEGIN op 1478 ( update quality_profile "2160p Remux" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '2160p Remux'
  AND custom_format_name = '720p WEBRip'
  AND arr_type = 'all'
  AND score = 180000;
-- --- END op 1478

-- --- BEGIN op 1479 ( update quality_profile "2160p Remux" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '2160p Remux'
  AND custom_format_name = '1080p WEBRip'
  AND arr_type = 'sonarr'
  AND score = 280000;
-- --- END op 1479

-- --- BEGIN op 1480 ( update quality_profile "2160p Remux" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '2160p Remux'
  AND custom_format_name = '720p WEBRip'
  AND arr_type = 'sonarr'
  AND score = 180000;
-- --- END op 1480

-- --- BEGIN op 1481 ( update quality_profile "720p Quality" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '720p Quality'
  AND custom_format_name = '720p WEBRip'
  AND arr_type = 'all'
  AND score = 180000;
-- --- END op 1481

-- --- BEGIN op 1482 ( update quality_profile "720p Quality" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '720p Quality'
  AND custom_format_name = '720p WEBRip'
  AND arr_type = 'sonarr'
  AND score = 460000;
-- --- END op 1482

-- --- BEGIN op 1483 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Compact', '720p WEBRip', 'radarr', 460000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Compact'
    AND custom_format_name = '720p WEBRip'
    AND arr_type = 'radarr'
);
-- --- END op 1483

-- --- BEGIN op 1484 ( update quality_profile "1080p Compact" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Compact', '720p WEBRip', 'sonarr', 460000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Compact'
    AND custom_format_name = '720p WEBRip'
    AND arr_type = 'sonarr'
);
-- --- END op 1484

-- --- BEGIN op 1485 ( update quality_profile "1080p Compact" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Compact'
  AND custom_format_name = '720p WEBRip'
  AND arr_type = 'all'
  AND score = 460000;
-- --- END op 1485

-- --- BEGIN op 1486 ( update quality_profile "1080p Compact" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Compact'
  AND custom_format_name = '720p WEBRip'
  AND arr_type = 'sonarr'
  AND score = 460000;
-- --- END op 1486

-- --- BEGIN op 1487 ( update quality_profile "1080p Efficient" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '720p WEBRip'
  AND arr_type = 'all'
  AND score = 180000;
-- --- END op 1487

-- --- BEGIN op 1488 ( update quality_profile "1080p Efficient" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '720p WEBRip'
  AND arr_type = 'sonarr'
  AND score = 460000;
-- --- END op 1488

-- --- BEGIN op 1489 ( update quality_profile "2160p Efficient" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '720p WEBRip'
  AND arr_type = 'all'
  AND score = 180000;
-- --- END op 1489

-- --- BEGIN op 1490 ( update quality_profile "2160p Efficient" )
DELETE FROM quality_profile_custom_formats
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '720p WEBRip'
  AND arr_type = 'sonarr'
  AND score = 460000;
-- --- END op 1490
