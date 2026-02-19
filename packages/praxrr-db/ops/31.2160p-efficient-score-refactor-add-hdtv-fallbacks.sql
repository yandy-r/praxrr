-- @operation: export
-- @entity: batch
-- @name: 2160p Efficient Score Refactor / Add HDTV Fallbacks
-- @exportedAt: 2026-02-09T00:16:28.653Z
-- @opIds: 1268, 1269, 1270, 1271, 1272, 1273, 1274, 1275, 1276, 1277, 1278, 1279, 1280, 1281, 1282, 1283, 1284, 1285, 1286, 1287, 1288, 1289, 1290, 1291, 1292, 1293, 1294, 1295, 1296, 1297, 1298, 1299, 1300, 1301, 1302, 1303, 1304, 1305, 1306, 1307, 1308, 1309, 1310, 1311, 1312, 1313, 1314, 1315, 1316, 1317, 1318, 1319, 1320, 1321, 1322, 1323, 1324, 1325, 1326, 1327, 1328, 1329, 1330, 1331, 1332, 1333, 1334, 1335, 1336, 1337, 1338, 1339, 1340, 1341, 1342, 1343, 1344, 1345, 1346, 1347, 1348, 1349, 1350, 1351, 1352, 1353, 1354, 1355, 1356, 1357, 1358, 1359, 1360, 1361, 1362, 1363, 1364, 1365, 1366, 1367, 1368, 1369, 1370, 1371, 1372, 1373, 1374, 1375, 1376, 1377, 1378, 1379, 1380, 1381, 1382, 1383, 1384, 1385, 1386, 1387, 1388, 1389, 1390, 1391, 1392, 1393

-- --- BEGIN op 1268 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '1080p HDTV', 'radarr', 340000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '1080p HDTV'
    AND arr_type = 'radarr'
);
-- --- END op 1268

-- --- BEGIN op 1269 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '1080p HDTV', 'sonarr', 340000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '1080p HDTV'
    AND arr_type = 'sonarr'
);
-- --- END op 1269

-- --- BEGIN op 1270 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '1080p WEB-DL (h264)', 'radarr', 640000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '1080p WEB-DL (h264)'
    AND arr_type = 'radarr'
);
-- --- END op 1270

-- --- BEGIN op 1271 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '1080p WEB-DL (h264)', 'sonarr', 640000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '1080p WEB-DL (h264)'
    AND arr_type = 'sonarr'
);
-- --- END op 1271

-- --- BEGIN op 1272 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '2160p WEB-DL (Efficient)', 'radarr', 740000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '2160p WEB-DL (Efficient)'
    AND arr_type = 'radarr'
);
-- --- END op 1272

-- --- BEGIN op 1273 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '2160p WEB-DL (Efficient)', 'sonarr', 740000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '2160p WEB-DL (Efficient)'
    AND arr_type = 'sonarr'
);
-- --- END op 1273

-- --- BEGIN op 1274 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '480p Bluray', 'radarr', 100000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '480p Bluray'
    AND arr_type = 'radarr'
);
-- --- END op 1274

-- --- BEGIN op 1275 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '480p Bluray', 'sonarr', 100000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '480p Bluray'
    AND arr_type = 'sonarr'
);
-- --- END op 1275

-- --- BEGIN op 1276 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '480p WEB-DL', 'radarr', 80000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '480p WEB-DL'
    AND arr_type = 'radarr'
);
-- --- END op 1276

-- --- BEGIN op 1277 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '480p WEB-DL', 'sonarr', 80000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '480p WEB-DL'
    AND arr_type = 'sonarr'
);
-- --- END op 1277

-- --- BEGIN op 1278 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '576p Bluray', 'radarr', 160000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '576p Bluray'
    AND arr_type = 'radarr'
);
-- --- END op 1278

-- --- BEGIN op 1279 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '576p Bluray', 'sonarr', 160000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '576p Bluray'
    AND arr_type = 'sonarr'
);
-- --- END op 1279

-- --- BEGIN op 1280 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p Bluray', 'radarr', 460000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p Bluray'
    AND arr_type = 'radarr'
);
-- --- END op 1280

-- --- BEGIN op 1281 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p Bluray', 'sonarr', 460000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p Bluray'
    AND arr_type = 'sonarr'
);
-- --- END op 1281

-- --- BEGIN op 1282 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p HDTV', 'radarr', 240000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p HDTV'
    AND arr_type = 'radarr'
);
-- --- END op 1282

-- --- BEGIN op 1283 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p HDTV', 'sonarr', 240000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p HDTV'
    AND arr_type = 'sonarr'
);
-- --- END op 1283

-- --- BEGIN op 1284 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p WEB-DL', 'radarr', 480000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p WEB-DL'
    AND arr_type = 'radarr'
);
-- --- END op 1284

-- --- BEGIN op 1285 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p WEB-DL', 'sonarr', 480000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p WEB-DL'
    AND arr_type = 'sonarr'
);
-- --- END op 1285

-- --- BEGIN op 1286 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p WEBRip', 'radarr', 460000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p WEBRip'
    AND arr_type = 'radarr'
);
-- --- END op 1286

-- --- BEGIN op 1287 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p WEBRip', 'sonarr', 460000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p WEBRip'
    AND arr_type = 'sonarr'
);
-- --- END op 1287

-- --- BEGIN op 1288 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', 'DVD', 'radarr', 40000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = 'DVD'
    AND arr_type = 'radarr'
);
-- --- END op 1288

-- --- BEGIN op 1289 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', 'DVD', 'sonarr', 40000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = 'DVD'
    AND arr_type = 'sonarr'
);
-- --- END op 1289

-- --- BEGIN op 1290 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', 'SDTV', 'radarr', 20000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = 'SDTV'
    AND arr_type = 'radarr'
);
-- --- END op 1290

-- --- BEGIN op 1291 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', 'SDTV', 'sonarr', 20000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = 'SDTV'
    AND arr_type = 'sonarr'
);
-- --- END op 1291

-- --- BEGIN op 1292 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 641000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '1080p Balanced Tier 1'
  AND arr_type = 'radarr'
  AND score = 281000;
-- --- END op 1292

-- --- BEGIN op 1293 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '1080p Balanced Tier 1', 'sonarr', 641000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '1080p Balanced Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 1293

-- --- BEGIN op 1294 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 640000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '1080p Balanced Tier 2'
  AND arr_type = 'radarr'
  AND score = 280000;
-- --- END op 1294

-- --- BEGIN op 1295 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '1080p Balanced Tier 2', 'sonarr', 640000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '1080p Balanced Tier 2'
    AND arr_type = 'sonarr'
);
-- --- END op 1295

-- --- BEGIN op 1296 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '1080p HDTV Tier 1', 'radarr', 102000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '1080p HDTV Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 1296

-- --- BEGIN op 1297 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '1080p HDTV Tier 1', 'sonarr', 102000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '1080p HDTV Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 1297

-- --- BEGIN op 1298 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '1080p HDTV Tier 2', 'radarr', 101000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '1080p HDTV Tier 2'
    AND arr_type = 'radarr'
);
-- --- END op 1298

-- --- BEGIN op 1299 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '1080p HDTV Tier 2', 'sonarr', 101000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '1080p HDTV Tier 2'
    AND arr_type = 'sonarr'
);
-- --- END op 1299

-- --- BEGIN op 1300 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '1080p HDTV Tier 3', 'radarr', 100000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '1080p HDTV Tier 3'
    AND arr_type = 'radarr'
);
-- --- END op 1300

-- --- BEGIN op 1301 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '1080p HDTV Tier 3', 'sonarr', 100000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '1080p HDTV Tier 3'
    AND arr_type = 'sonarr'
);
-- --- END op 1301

-- --- BEGIN op 1302 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '480p Quality Tier 1', 'radarr', 43000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '480p Quality Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 1302

-- --- BEGIN op 1303 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '480p Quality Tier 1', 'sonarr', 43000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '480p Quality Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 1303

-- --- BEGIN op 1304 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '480p Quality Tier 2', 'radarr', 42000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '480p Quality Tier 2'
    AND arr_type = 'radarr'
);
-- --- END op 1304

-- --- BEGIN op 1305 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '480p Quality Tier 2', 'sonarr', 42000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '480p Quality Tier 2'
    AND arr_type = 'sonarr'
);
-- --- END op 1305

-- --- BEGIN op 1306 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '480p Quality Tier 3', 'radarr', 41000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '480p Quality Tier 3'
    AND arr_type = 'radarr'
);
-- --- END op 1306

-- --- BEGIN op 1307 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '480p Quality Tier 3', 'sonarr', 41000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '480p Quality Tier 3'
    AND arr_type = 'sonarr'
);
-- --- END op 1307

-- --- BEGIN op 1308 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '480p Quality Tier 4', 'radarr', 40000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '480p Quality Tier 4'
    AND arr_type = 'radarr'
);
-- --- END op 1308

-- --- BEGIN op 1309 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '480p Quality Tier 4', 'sonarr', 40000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '480p Quality Tier 4'
    AND arr_type = 'sonarr'
);
-- --- END op 1309

-- --- BEGIN op 1310 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '576p Quality Tier 1', 'radarr', 63000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '576p Quality Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 1310

-- --- BEGIN op 1311 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '576p Quality Tier 1', 'sonarr', 63000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '576p Quality Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 1311

-- --- BEGIN op 1312 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '576p Quality Tier 2', 'radarr', 62000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '576p Quality Tier 2'
    AND arr_type = 'radarr'
);
-- --- END op 1312

-- --- BEGIN op 1313 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '576p Quality Tier 2', 'sonarr', 62000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '576p Quality Tier 2'
    AND arr_type = 'sonarr'
);
-- --- END op 1313

-- --- BEGIN op 1314 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '576p Quality Tier 3', 'radarr', 61000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '576p Quality Tier 3'
    AND arr_type = 'radarr'
);
-- --- END op 1314

-- --- BEGIN op 1315 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '576p Quality Tier 3', 'sonarr', 61000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '576p Quality Tier 3'
    AND arr_type = 'sonarr'
);
-- --- END op 1315

-- --- BEGIN op 1316 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '576p Quality Tier 4', 'radarr', 60000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '576p Quality Tier 4'
    AND arr_type = 'radarr'
);
-- --- END op 1316

-- --- BEGIN op 1317 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '576p Quality Tier 4', 'sonarr', 60000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '576p Quality Tier 4'
    AND arr_type = 'sonarr'
);
-- --- END op 1317

-- --- BEGIN op 1318 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 120000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '720p Balanced Tier 1'
  AND arr_type = 'radarr'
  AND score = 60000;
-- --- END op 1318

-- --- BEGIN op 1319 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p Balanced Tier 1', 'sonarr', 120000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p Balanced Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 1319

-- --- BEGIN op 1320 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p HDTV Tier 1', 'radarr', 82000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p HDTV Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 1320

-- --- BEGIN op 1321 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p HDTV Tier 1', 'sonarr', 82000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p HDTV Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 1321

-- --- BEGIN op 1322 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p HDTV Tier 2', 'radarr', 81000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p HDTV Tier 2'
    AND arr_type = 'radarr'
);
-- --- END op 1322

-- --- BEGIN op 1323 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p HDTV Tier 2', 'sonarr', 81000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p HDTV Tier 2'
    AND arr_type = 'sonarr'
);
-- --- END op 1323

-- --- BEGIN op 1324 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p HDTV Tier 3', 'radarr', 80000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p HDTV Tier 3'
    AND arr_type = 'radarr'
);
-- --- END op 1324

-- --- BEGIN op 1325 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p HDTV Tier 3', 'sonarr', 80000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p HDTV Tier 3'
    AND arr_type = 'sonarr'
);
-- --- END op 1325

-- --- BEGIN op 1326 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p Quality Tier 1', 'radarr', 145000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p Quality Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 1326

-- --- BEGIN op 1327 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p Quality Tier 1', 'sonarr', 145000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p Quality Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 1327

-- --- BEGIN op 1328 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p Quality Tier 2', 'radarr', 144000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p Quality Tier 2'
    AND arr_type = 'radarr'
);
-- --- END op 1328

-- --- BEGIN op 1329 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p Quality Tier 2', 'sonarr', 144000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p Quality Tier 2'
    AND arr_type = 'sonarr'
);
-- --- END op 1329

-- --- BEGIN op 1330 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p Quality Tier 3', 'radarr', 143000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p Quality Tier 3'
    AND arr_type = 'radarr'
);
-- --- END op 1330

-- --- BEGIN op 1331 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p Quality Tier 3', 'sonarr', 143000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p Quality Tier 3'
    AND arr_type = 'sonarr'
);
-- --- END op 1331

-- --- BEGIN op 1332 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p Quality Tier 4', 'radarr', 142000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p Quality Tier 4'
    AND arr_type = 'radarr'
);
-- --- END op 1332

-- --- BEGIN op 1333 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p Quality Tier 4', 'sonarr', 142000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p Quality Tier 4'
    AND arr_type = 'sonarr'
);
-- --- END op 1333

-- --- BEGIN op 1334 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p Quality Tier 5', 'radarr', 141000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p Quality Tier 5'
    AND arr_type = 'radarr'
);
-- --- END op 1334

-- --- BEGIN op 1335 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p Quality Tier 5', 'sonarr', 141000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p Quality Tier 5'
    AND arr_type = 'sonarr'
);
-- --- END op 1335

-- --- BEGIN op 1336 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p Quality Tier 6', 'radarr', 140000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p Quality Tier 6'
    AND arr_type = 'radarr'
);
-- --- END op 1336

-- --- BEGIN op 1337 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '720p Quality Tier 6', 'sonarr', 140000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '720p Quality Tier 6'
    AND arr_type = 'sonarr'
);
-- --- END op 1337

-- --- BEGIN op 1338 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', 'SD Quality Tier 1', 'radarr', 21000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = 'SD Quality Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 1338

-- --- BEGIN op 1339 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', 'SD Quality Tier 1', 'sonarr', 21000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = 'SD Quality Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 1339

-- --- BEGIN op 1340 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', 'SD Quality Tier 2', 'radarr', 20000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = 'SD Quality Tier 2'
    AND arr_type = 'radarr'
);
-- --- END op 1340

-- --- BEGIN op 1341 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', 'SD Quality Tier 2', 'sonarr', 20000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = 'SD Quality Tier 2'
    AND arr_type = 'sonarr'
);
-- --- END op 1341

-- --- BEGIN op 1342 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', 'SDTV Tier 1', 'radarr', 10000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = 'SDTV Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 1342

-- --- BEGIN op 1343 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', 'SDTV Tier 1', 'sonarr', 10000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = 'SDTV Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 1343

-- --- BEGIN op 1344 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '1080p Bluray HEVC Tier 1', 'radarr', 720000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '1080p Bluray HEVC Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 1344

-- --- BEGIN op 1345 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 683000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '1080p Efficient Movie Bluray Tier 1'
  AND arr_type = 'radarr'
  AND score = 323000;
-- --- END op 1345

-- --- BEGIN op 1346 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 682000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '1080p Efficient Movie Bluray Tier 2'
  AND arr_type = 'radarr'
  AND score = 322000;
-- --- END op 1346

-- --- BEGIN op 1347 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 681000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '1080p Efficient Movie Bluray Tier 3'
  AND arr_type = 'radarr'
  AND score = 321000;
-- --- END op 1347

-- --- BEGIN op 1348 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 680000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '1080p Efficient Movie Bluray Tier 4'
  AND arr_type = 'radarr'
  AND score = 320000;
-- --- END op 1348

-- --- BEGIN op 1349 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 663000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '1080p Efficient Movie WEB Tier 1'
  AND arr_type = 'radarr'
  AND score = 303000;
-- --- END op 1349

-- --- BEGIN op 1350 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 662000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '1080p Efficient Movie WEB Tier 2'
  AND arr_type = 'radarr'
  AND score = 302000;
-- --- END op 1350

-- --- BEGIN op 1351 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 661000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '1080p Efficient Movie WEB Tier 3'
  AND arr_type = 'radarr'
  AND score = 301000;
-- --- END op 1351

-- --- BEGIN op 1352 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 660000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '1080p Efficient Movie WEB Tier 4'
  AND arr_type = 'radarr'
  AND score = 300000;
-- --- END op 1352

-- --- BEGIN op 1353 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '1080p WEB-DL HEVC Tier 1', 'radarr', 700000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '1080p WEB-DL HEVC Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 1353

-- --- BEGIN op 1354 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 742000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '2160p Balanced Tier 1'
  AND arr_type = 'radarr'
  AND score = 382000;
-- --- END op 1354

-- --- BEGIN op 1355 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 741000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '2160p Balanced Tier 2'
  AND arr_type = 'radarr'
  AND score = 381000;
-- --- END op 1355

-- --- BEGIN op 1356 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 740000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '2160p Balanced Tier 3'
  AND arr_type = 'radarr'
  AND score = 380000;
-- --- END op 1356

-- --- BEGIN op 1357 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', 'HONE Bluray', 'radarr', 720000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = 'HONE Bluray'
    AND arr_type = 'radarr'
);
-- --- END op 1357

-- --- BEGIN op 1358 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', 'HONE WEB', 'radarr', 700000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = 'HONE WEB'
    AND arr_type = 'radarr'
);
-- --- END op 1358

-- --- BEGIN op 1359 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 683000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = 'QxR Bluray'
  AND arr_type = 'radarr'
  AND score = 323000;
-- --- END op 1359

-- --- BEGIN op 1360 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 663000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = 'QxR WEB'
  AND arr_type = 'radarr'
  AND score = 303000;
-- --- END op 1360

-- --- BEGIN op 1361 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 683000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = 'TAoE Bluray'
  AND arr_type = 'radarr'
  AND score = 323000;
-- --- END op 1361

-- --- BEGIN op 1362 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 663000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = 'TAoE WEB'
  AND arr_type = 'radarr'
  AND score = 303000;
-- --- END op 1362

-- --- BEGIN op 1363 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 682000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = 'Vialle Bluray'
  AND arr_type = 'radarr'
  AND score = 322000;
-- --- END op 1363

-- --- BEGIN op 1364 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 663000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = 'Weasley WEB'
  AND arr_type = 'radarr'
  AND score = 303000;
-- --- END op 1364

-- --- BEGIN op 1365 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '1080p Bluray HEVC Tier 1', 'sonarr', 720000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '1080p Bluray HEVC Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 1365

-- --- BEGIN op 1366 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 684000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '1080p Efficient TV Bluray Tier 1'
  AND arr_type = 'sonarr'
  AND score = 324000;
-- --- END op 1366

-- --- BEGIN op 1367 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 683000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '1080p Efficient TV Bluray Tier 2'
  AND arr_type = 'sonarr'
  AND score = 323000;
-- --- END op 1367

-- --- BEGIN op 1368 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 682000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '1080p Efficient TV Bluray Tier 3'
  AND arr_type = 'sonarr'
  AND score = 322000;
-- --- END op 1368

-- --- BEGIN op 1369 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 681000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '1080p Efficient TV Bluray Tier 4'
  AND arr_type = 'sonarr'
  AND score = 321000;
-- --- END op 1369

-- --- BEGIN op 1370 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 680000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '1080p Efficient TV Bluray Tier 5'
  AND arr_type = 'sonarr'
  AND score = 320000;
-- --- END op 1370

-- --- BEGIN op 1371 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 661000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '1080p Efficient TV Bluray Tier 6'
  AND arr_type = 'sonarr'
  AND score = 301000;
-- --- END op 1371

-- --- BEGIN op 1372 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 665000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '1080p Efficient TV WEB Tier 1'
  AND arr_type = 'sonarr'
  AND score = 305000;
-- --- END op 1372

-- --- BEGIN op 1373 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 664000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '1080p Efficient TV WEB Tier 2'
  AND arr_type = 'sonarr'
  AND score = 304000;
-- --- END op 1373

-- --- BEGIN op 1374 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 663000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '1080p Efficient TV WEB Tier 3'
  AND arr_type = 'sonarr'
  AND score = 303000;
-- --- END op 1374

-- --- BEGIN op 1375 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 662000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '1080p Efficient TV WEB Tier 4'
  AND arr_type = 'sonarr'
  AND score = 302000;
-- --- END op 1375

-- --- BEGIN op 1376 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 660000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '1080p Efficient TV WEB Tier 5'
  AND arr_type = 'sonarr'
  AND score = 300000;
-- --- END op 1376

-- --- BEGIN op 1377 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', '1080p WEB-DL HEVC Tier 1', 'sonarr', 700000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = '1080p WEB-DL HEVC Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 1377

-- --- BEGIN op 1378 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 744000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '2160p Balanced Tier 1'
  AND arr_type = 'sonarr'
  AND score = 384000;
-- --- END op 1378

-- --- BEGIN op 1379 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 780000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '2160p Efficient TV Bluray Tier 1'
  AND arr_type = 'sonarr'
  AND score = 421000;
-- --- END op 1379

-- --- BEGIN op 1380 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 760000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = '2160p Efficient TV WEB Tier 1'
  AND arr_type = 'sonarr'
  AND score = 400000;
-- --- END op 1380

-- --- BEGIN op 1381 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', 'HONE Bluray', 'sonarr', 720000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = 'HONE Bluray'
    AND arr_type = 'sonarr'
);
-- --- END op 1381

-- --- BEGIN op 1382 ( update quality_profile "2160p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '2160p Efficient', 'HONE WEB', 'sonarr', 700000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '2160p Efficient'
    AND custom_format_name = 'HONE WEB'
    AND arr_type = 'sonarr'
);
-- --- END op 1382

-- --- BEGIN op 1383 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 684000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = 'QxR Bluray'
  AND arr_type = 'sonarr'
  AND score = 324000;
-- --- END op 1383

-- --- BEGIN op 1384 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 780000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = 'QxR Blurays'
  AND arr_type = 'sonarr'
  AND score = 421000;
-- --- END op 1384

-- --- BEGIN op 1385 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 665000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = 'QxR WEB'
  AND arr_type = 'sonarr'
  AND score = 305000;
-- --- END op 1385

-- --- BEGIN op 1386 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 760000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = 'QxR WEBs'
  AND arr_type = 'sonarr'
  AND score = 400000;
-- --- END op 1386

-- --- BEGIN op 1387 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 684000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = 'TAoE Bluray'
  AND arr_type = 'sonarr'
  AND score = 324000;
-- --- END op 1387

-- --- BEGIN op 1388 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 780000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = 'TAoE Blurays'
  AND arr_type = 'sonarr'
  AND score = 421000;
-- --- END op 1388

-- --- BEGIN op 1389 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 665000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = 'TAoE WEB'
  AND arr_type = 'sonarr'
  AND score = 305000;
-- --- END op 1389

-- --- BEGIN op 1390 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 760000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = 'TAoE WEBs'
  AND arr_type = 'sonarr'
  AND score = 400000;
-- --- END op 1390

-- --- BEGIN op 1391 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 684000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = 'Vialle Bluray'
  AND arr_type = 'sonarr'
  AND score = 324000;
-- --- END op 1391

-- --- BEGIN op 1392 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 665000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = 'Vialle WEB'
  AND arr_type = 'sonarr'
  AND score = 305000;
-- --- END op 1392

-- --- BEGIN op 1393 ( update quality_profile "2160p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 665000
WHERE quality_profile_name = '2160p Efficient'
  AND custom_format_name = 'Weasley WEB'
  AND arr_type = 'sonarr'
  AND score = 305000;
-- --- END op 1393
