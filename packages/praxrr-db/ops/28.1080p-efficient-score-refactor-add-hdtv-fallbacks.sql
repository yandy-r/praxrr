-- @operation: export
-- @entity: batch
-- @name: 1080p Efficient Score Refactor / Add HDTV Fallbacks
-- @exportedAt: 2026-02-08T23:52:02.315Z
-- @opIds: 1123, 1124, 1125, 1126, 1127, 1128, 1129, 1130, 1131, 1132, 1133, 1134, 1135, 1136, 1137, 1138, 1139, 1140, 1141, 1142, 1143, 1144, 1145, 1146, 1147, 1148, 1149, 1150, 1151, 1152, 1153, 1154, 1155, 1156, 1157, 1158, 1159, 1160, 1161, 1162, 1163, 1164, 1165, 1166, 1167, 1168, 1169, 1170, 1171, 1172, 1173, 1174, 1175, 1176, 1177, 1178, 1179, 1180, 1181, 1182, 1183, 1184, 1185, 1186, 1187, 1188, 1189, 1190, 1191, 1192, 1193, 1194, 1195, 1196, 1197, 1198, 1199, 1200, 1201, 1202, 1203, 1204, 1205, 1206, 1207, 1208, 1209, 1210, 1211, 1212, 1213, 1214, 1215, 1216, 1217, 1218, 1219, 1220, 1221, 1222, 1223, 1224, 1225, 1226, 1227, 1228, 1229, 1230, 1231, 1232, 1233, 1234, 1235, 1236

-- --- BEGIN op 1123 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '1080p HDTV', 'radarr', 340000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '1080p HDTV'
    AND arr_type = 'radarr'
);
-- --- END op 1123

-- --- BEGIN op 1124 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '1080p HDTV', 'sonarr', 340000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '1080p HDTV'
    AND arr_type = 'sonarr'
);
-- --- END op 1124

-- --- BEGIN op 1125 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '1080p WEB-DL (h264)', 'radarr', 640000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '1080p WEB-DL (h264)'
    AND arr_type = 'radarr'
);
-- --- END op 1125

-- --- BEGIN op 1126 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '1080p WEB-DL (h264)', 'sonarr', 640000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '1080p WEB-DL (h264)'
    AND arr_type = 'sonarr'
);
-- --- END op 1126

-- --- BEGIN op 1127 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '480p Bluray', 'radarr', 100000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '480p Bluray'
    AND arr_type = 'radarr'
);
-- --- END op 1127

-- --- BEGIN op 1128 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '480p Bluray', 'sonarr', 100000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '480p Bluray'
    AND arr_type = 'sonarr'
);
-- --- END op 1128

-- --- BEGIN op 1129 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '480p WEB-DL', 'radarr', 80000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '480p WEB-DL'
    AND arr_type = 'radarr'
);
-- --- END op 1129

-- --- BEGIN op 1130 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '480p WEB-DL', 'sonarr', 80000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '480p WEB-DL'
    AND arr_type = 'sonarr'
);
-- --- END op 1130

-- --- BEGIN op 1131 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '576p Bluray', 'radarr', 160000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '576p Bluray'
    AND arr_type = 'radarr'
);
-- --- END op 1131

-- --- BEGIN op 1132 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '576p Bluray', 'sonarr', 160000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '576p Bluray'
    AND arr_type = 'sonarr'
);
-- --- END op 1132

-- --- BEGIN op 1133 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p Bluray', 'radarr', 460000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p Bluray'
    AND arr_type = 'radarr'
);
-- --- END op 1133

-- --- BEGIN op 1134 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p Bluray', 'sonarr', 460000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p Bluray'
    AND arr_type = 'sonarr'
);
-- --- END op 1134

-- --- BEGIN op 1135 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p HDTV', 'radarr', 240000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p HDTV'
    AND arr_type = 'radarr'
);
-- --- END op 1135

-- --- BEGIN op 1136 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p HDTV', 'sonarr', 240000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p HDTV'
    AND arr_type = 'sonarr'
);
-- --- END op 1136

-- --- BEGIN op 1137 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p WEB-DL', 'radarr', 560000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p WEB-DL'
    AND arr_type = 'radarr'
);
-- --- END op 1137

-- --- BEGIN op 1138 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p WEB-DL', 'sonarr', 560000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p WEB-DL'
    AND arr_type = 'sonarr'
);
-- --- END op 1138

-- --- BEGIN op 1139 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p WEBRip', 'radarr', 460000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p WEBRip'
    AND arr_type = 'radarr'
);
-- --- END op 1139

-- --- BEGIN op 1140 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p WEBRip', 'sonarr', 460000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p WEBRip'
    AND arr_type = 'sonarr'
);
-- --- END op 1140

-- --- BEGIN op 1141 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', 'DVD', 'radarr', 40000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = 'DVD'
    AND arr_type = 'radarr'
);
-- --- END op 1141

-- --- BEGIN op 1142 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', 'DVD', 'sonarr', 40000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = 'DVD'
    AND arr_type = 'sonarr'
);
-- --- END op 1142

-- --- BEGIN op 1143 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', 'SDTV', 'radarr', 20000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = 'SDTV'
    AND arr_type = 'radarr'
);
-- --- END op 1143

-- --- BEGIN op 1144 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', 'SDTV', 'sonarr', 20000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = 'SDTV'
    AND arr_type = 'sonarr'
);
-- --- END op 1144

-- --- BEGIN op 1145 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 640000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '1080p Balanced Tier 1'
  AND arr_type = 'radarr'
  AND score = 281000;
-- --- END op 1145

-- --- BEGIN op 1146 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '1080p Balanced Tier 1', 'sonarr', 640000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '1080p Balanced Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 1146

-- --- BEGIN op 1147 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 640000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '1080p Balanced Tier 2'
  AND arr_type = 'radarr'
  AND score = 280000;
-- --- END op 1147

-- --- BEGIN op 1148 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '1080p Balanced Tier 2', 'sonarr', 640000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '1080p Balanced Tier 2'
    AND arr_type = 'sonarr'
);
-- --- END op 1148

-- --- BEGIN op 1149 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '1080p HDTV Tier 1', 'radarr', 102000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '1080p HDTV Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 1149

-- --- BEGIN op 1150 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '1080p HDTV Tier 1', 'sonarr', 102000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '1080p HDTV Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 1150

-- --- BEGIN op 1151 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '1080p HDTV Tier 2', 'radarr', 101000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '1080p HDTV Tier 2'
    AND arr_type = 'radarr'
);
-- --- END op 1151

-- --- BEGIN op 1152 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '1080p HDTV Tier 2', 'sonarr', 101000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '1080p HDTV Tier 2'
    AND arr_type = 'sonarr'
);
-- --- END op 1152

-- --- BEGIN op 1153 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '1080p HDTV Tier 3', 'radarr', 100000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '1080p HDTV Tier 3'
    AND arr_type = 'radarr'
);
-- --- END op 1153

-- --- BEGIN op 1154 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '1080p HDTV Tier 3', 'sonarr', 100000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '1080p HDTV Tier 3'
    AND arr_type = 'sonarr'
);
-- --- END op 1154

-- --- BEGIN op 1155 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '480p Quality Tier 1', 'radarr', 43000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '480p Quality Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 1155

-- --- BEGIN op 1156 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '480p Quality Tier 1', 'sonarr', 43000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '480p Quality Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 1156

-- --- BEGIN op 1157 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '480p Quality Tier 2', 'radarr', 42000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '480p Quality Tier 2'
    AND arr_type = 'radarr'
);
-- --- END op 1157

-- --- BEGIN op 1158 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '480p Quality Tier 2', 'sonarr', 42000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '480p Quality Tier 2'
    AND arr_type = 'sonarr'
);
-- --- END op 1158

-- --- BEGIN op 1159 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '480p Quality Tier 3', 'radarr', 41000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '480p Quality Tier 3'
    AND arr_type = 'radarr'
);
-- --- END op 1159

-- --- BEGIN op 1160 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '480p Quality Tier 3', 'sonarr', 41000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '480p Quality Tier 3'
    AND arr_type = 'sonarr'
);
-- --- END op 1160

-- --- BEGIN op 1161 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '480p Quality Tier 4', 'radarr', 40000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '480p Quality Tier 4'
    AND arr_type = 'radarr'
);
-- --- END op 1161

-- --- BEGIN op 1162 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '480p Quality Tier 4', 'sonarr', 40000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '480p Quality Tier 4'
    AND arr_type = 'sonarr'
);
-- --- END op 1162

-- --- BEGIN op 1163 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '576p Quality Tier 1', 'radarr', 63000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '576p Quality Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 1163

-- --- BEGIN op 1164 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '576p Quality Tier 1', 'sonarr', 63000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '576p Quality Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 1164

-- --- BEGIN op 1165 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '576p Quality Tier 2', 'radarr', 62000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '576p Quality Tier 2'
    AND arr_type = 'radarr'
);
-- --- END op 1165

-- --- BEGIN op 1166 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '576p Quality Tier 2', 'sonarr', 62000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '576p Quality Tier 2'
    AND arr_type = 'sonarr'
);
-- --- END op 1166

-- --- BEGIN op 1167 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '576p Quality Tier 3', 'radarr', 61000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '576p Quality Tier 3'
    AND arr_type = 'radarr'
);
-- --- END op 1167

-- --- BEGIN op 1168 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '576p Quality Tier 3', 'sonarr', 61000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '576p Quality Tier 3'
    AND arr_type = 'sonarr'
);
-- --- END op 1168

-- --- BEGIN op 1169 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '576p Quality Tier 4', 'radarr', 60000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '576p Quality Tier 4'
    AND arr_type = 'radarr'
);
-- --- END op 1169

-- --- BEGIN op 1170 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '576p Quality Tier 4', 'sonarr', 60000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '576p Quality Tier 4'
    AND arr_type = 'sonarr'
);
-- --- END op 1170

-- --- BEGIN op 1171 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 120000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '720p Balanced Tier 1'
  AND arr_type = 'radarr'
  AND score = 60000;
-- --- END op 1171

-- --- BEGIN op 1172 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p Balanced Tier 1', 'sonarr', 120000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p Balanced Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 1172

-- --- BEGIN op 1173 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p HDTV Tier 1', 'radarr', 82000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p HDTV Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 1173

-- --- BEGIN op 1174 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p HDTV Tier 1', 'sonarr', 82000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p HDTV Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 1174

-- --- BEGIN op 1175 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p HDTV Tier 2', 'radarr', 81000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p HDTV Tier 2'
    AND arr_type = 'radarr'
);
-- --- END op 1175

-- --- BEGIN op 1176 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p HDTV Tier 2', 'sonarr', 81000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p HDTV Tier 2'
    AND arr_type = 'sonarr'
);
-- --- END op 1176

-- --- BEGIN op 1177 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p HDTV Tier 3', 'radarr', 80000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p HDTV Tier 3'
    AND arr_type = 'radarr'
);
-- --- END op 1177

-- --- BEGIN op 1178 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p HDTV Tier 3', 'sonarr', 80000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p HDTV Tier 3'
    AND arr_type = 'sonarr'
);
-- --- END op 1178

-- --- BEGIN op 1179 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p Quality Tier 1', 'radarr', 145000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p Quality Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 1179

-- --- BEGIN op 1180 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p Quality Tier 1', 'sonarr', 145000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p Quality Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 1180

-- --- BEGIN op 1181 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p Quality Tier 2', 'radarr', 144000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p Quality Tier 2'
    AND arr_type = 'radarr'
);
-- --- END op 1181

-- --- BEGIN op 1182 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p Quality Tier 2', 'sonarr', 144000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p Quality Tier 2'
    AND arr_type = 'sonarr'
);
-- --- END op 1182

-- --- BEGIN op 1183 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p Quality Tier 3', 'radarr', 143000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p Quality Tier 3'
    AND arr_type = 'radarr'
);
-- --- END op 1183

-- --- BEGIN op 1184 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p Quality Tier 3', 'sonarr', 143000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p Quality Tier 3'
    AND arr_type = 'sonarr'
);
-- --- END op 1184

-- --- BEGIN op 1185 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p Quality Tier 4', 'radarr', 142000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p Quality Tier 4'
    AND arr_type = 'radarr'
);
-- --- END op 1185

-- --- BEGIN op 1186 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p Quality Tier 4', 'sonarr', 142000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p Quality Tier 4'
    AND arr_type = 'sonarr'
);
-- --- END op 1186

-- --- BEGIN op 1187 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p Quality Tier 5', 'radarr', 141000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p Quality Tier 5'
    AND arr_type = 'radarr'
);
-- --- END op 1187

-- --- BEGIN op 1188 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p Quality Tier 5', 'sonarr', 141000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p Quality Tier 5'
    AND arr_type = 'sonarr'
);
-- --- END op 1188

-- --- BEGIN op 1189 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p Quality Tier 6', 'radarr', 140000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p Quality Tier 6'
    AND arr_type = 'radarr'
);
-- --- END op 1189

-- --- BEGIN op 1190 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '720p Quality Tier 6', 'sonarr', 140000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '720p Quality Tier 6'
    AND arr_type = 'sonarr'
);
-- --- END op 1190

-- --- BEGIN op 1191 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', 'SD Quality Tier 1', 'radarr', 21000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = 'SD Quality Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 1191

-- --- BEGIN op 1192 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', 'SD Quality Tier 1', 'sonarr', 21000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = 'SD Quality Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 1192

-- --- BEGIN op 1193 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', 'SD Quality Tier 2', 'radarr', 20000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = 'SD Quality Tier 2'
    AND arr_type = 'radarr'
);
-- --- END op 1193

-- --- BEGIN op 1194 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', 'SD Quality Tier 2', 'sonarr', 20000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = 'SD Quality Tier 2'
    AND arr_type = 'sonarr'
);
-- --- END op 1194

-- --- BEGIN op 1195 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', 'SDTV Tier 1', 'radarr', 10000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = 'SDTV Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 1195

-- --- BEGIN op 1196 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', 'SDTV Tier 1', 'sonarr', 10000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = 'SDTV Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 1196

-- --- BEGIN op 1197 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '1080p Bluray HEVC Tier 1', 'radarr', 720000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '1080p Bluray HEVC Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 1197

-- --- BEGIN op 1198 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 683000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '1080p Efficient Movie Bluray Tier 1'
  AND arr_type = 'radarr'
  AND score = 323000;
-- --- END op 1198

-- --- BEGIN op 1199 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 682000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '1080p Efficient Movie Bluray Tier 2'
  AND arr_type = 'radarr'
  AND score = 322000;
-- --- END op 1199

-- --- BEGIN op 1200 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 681000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '1080p Efficient Movie Bluray Tier 3'
  AND arr_type = 'radarr'
  AND score = 321000;
-- --- END op 1200

-- --- BEGIN op 1201 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 680000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '1080p Efficient Movie Bluray Tier 4'
  AND arr_type = 'radarr'
  AND score = 320000;
-- --- END op 1201

-- --- BEGIN op 1202 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 663000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '1080p Efficient Movie WEB Tier 1'
  AND arr_type = 'radarr'
  AND score = 303000;
-- --- END op 1202

-- --- BEGIN op 1203 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 662000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '1080p Efficient Movie WEB Tier 2'
  AND arr_type = 'radarr'
  AND score = 302000;
-- --- END op 1203

-- --- BEGIN op 1204 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 661000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '1080p Efficient Movie WEB Tier 3'
  AND arr_type = 'radarr'
  AND score = 301000;
-- --- END op 1204

-- --- BEGIN op 1205 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 660000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '1080p Efficient Movie WEB Tier 4'
  AND arr_type = 'radarr'
  AND score = 300000;
-- --- END op 1205

-- --- BEGIN op 1206 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '1080p WEB-DL HEVC Tier 1', 'radarr', 700000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '1080p WEB-DL HEVC Tier 1'
    AND arr_type = 'radarr'
);
-- --- END op 1206

-- --- BEGIN op 1207 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', 'HONE Bluray', 'radarr', 720000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = 'HONE Bluray'
    AND arr_type = 'radarr'
);
-- --- END op 1207

-- --- BEGIN op 1208 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', 'HONE WEB', 'radarr', 700000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = 'HONE WEB'
    AND arr_type = 'radarr'
);
-- --- END op 1208

-- --- BEGIN op 1209 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 683000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = 'QxR Bluray'
  AND arr_type = 'radarr'
  AND score = 323000;
-- --- END op 1209

-- --- BEGIN op 1210 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 663000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = 'QxR WEB'
  AND arr_type = 'radarr'
  AND score = 303000;
-- --- END op 1210

-- --- BEGIN op 1211 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 683000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = 'TAoE Bluray'
  AND arr_type = 'radarr'
  AND score = 323000;
-- --- END op 1211

-- --- BEGIN op 1212 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 663000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = 'TAoE WEB'
  AND arr_type = 'radarr'
  AND score = 303000;
-- --- END op 1212

-- --- BEGIN op 1213 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 682000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = 'Vialle Bluray'
  AND arr_type = 'radarr'
  AND score = 322000;
-- --- END op 1213

-- --- BEGIN op 1214 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 663000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = 'Weasley WEB'
  AND arr_type = 'radarr'
  AND score = 303000;
-- --- END op 1214

-- --- BEGIN op 1215 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '1080p Bluray HEVC Tier 1', 'sonarr', 720000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '1080p Bluray HEVC Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 1215

-- --- BEGIN op 1216 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 684000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '1080p Efficient TV Bluray Tier 1'
  AND arr_type = 'sonarr'
  AND score = 324000;
-- --- END op 1216

-- --- BEGIN op 1217 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 683000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '1080p Efficient TV Bluray Tier 2'
  AND arr_type = 'sonarr'
  AND score = 323000;
-- --- END op 1217

-- --- BEGIN op 1218 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 682000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '1080p Efficient TV Bluray Tier 3'
  AND arr_type = 'sonarr'
  AND score = 322000;
-- --- END op 1218

-- --- BEGIN op 1219 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 681000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '1080p Efficient TV Bluray Tier 4'
  AND arr_type = 'sonarr'
  AND score = 321000;
-- --- END op 1219

-- --- BEGIN op 1220 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 680000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '1080p Efficient TV Bluray Tier 5'
  AND arr_type = 'sonarr'
  AND score = 320000;
-- --- END op 1220

-- --- BEGIN op 1221 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 661000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '1080p Efficient TV Bluray Tier 6'
  AND arr_type = 'sonarr'
  AND score = 301000;
-- --- END op 1221

-- --- BEGIN op 1222 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 665000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '1080p Efficient TV WEB Tier 1'
  AND arr_type = 'sonarr'
  AND score = 305000;
-- --- END op 1222

-- --- BEGIN op 1223 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 664000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '1080p Efficient TV WEB Tier 2'
  AND arr_type = 'sonarr'
  AND score = 304000;
-- --- END op 1223

-- --- BEGIN op 1224 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 663000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '1080p Efficient TV WEB Tier 3'
  AND arr_type = 'sonarr'
  AND score = 303000;
-- --- END op 1224

-- --- BEGIN op 1225 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 662000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '1080p Efficient TV WEB Tier 4'
  AND arr_type = 'sonarr'
  AND score = 302000;
-- --- END op 1225

-- --- BEGIN op 1226 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 660000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = '1080p Efficient TV WEB Tier 5'
  AND arr_type = 'sonarr'
  AND score = 300000;
-- --- END op 1226

-- --- BEGIN op 1227 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', '1080p WEB-DL HEVC Tier 1', 'sonarr', 700000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = '1080p WEB-DL HEVC Tier 1'
    AND arr_type = 'sonarr'
);
-- --- END op 1227

-- --- BEGIN op 1228 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', 'HONE Bluray', 'sonarr', 720000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = 'HONE Bluray'
    AND arr_type = 'sonarr'
);
-- --- END op 1228

-- --- BEGIN op 1229 ( update quality_profile "1080p Efficient" )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Efficient', 'HONE WEB', 'sonarr', 700000
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Efficient'
    AND custom_format_name = 'HONE WEB'
    AND arr_type = 'sonarr'
);
-- --- END op 1229

-- --- BEGIN op 1230 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 684000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = 'QxR Bluray'
  AND arr_type = 'sonarr'
  AND score = 324000;
-- --- END op 1230

-- --- BEGIN op 1231 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 665000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = 'QxR WEB'
  AND arr_type = 'sonarr'
  AND score = 305000;
-- --- END op 1231

-- --- BEGIN op 1232 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 684000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = 'TAoE Bluray'
  AND arr_type = 'sonarr'
  AND score = 324000;
-- --- END op 1232

-- --- BEGIN op 1233 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 665000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = 'TAoE WEB'
  AND arr_type = 'sonarr'
  AND score = 305000;
-- --- END op 1233

-- --- BEGIN op 1234 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 684000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = 'Vialle Bluray'
  AND arr_type = 'sonarr'
  AND score = 324000;
-- --- END op 1234

-- --- BEGIN op 1235 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 665000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = 'Vialle WEB'
  AND arr_type = 'sonarr'
  AND score = 305000;
-- --- END op 1235

-- --- BEGIN op 1236 ( update quality_profile "1080p Efficient" )
UPDATE quality_profile_custom_formats
SET score = 665000
WHERE quality_profile_name = '1080p Efficient'
  AND custom_format_name = 'Weasley WEB'
  AND arr_type = 'sonarr'
  AND score = 305000;
-- --- END op 1236
