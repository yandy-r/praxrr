-- @operation: export
-- @entity: batch
-- @name: Seed Lidarr Quality Definitions
-- @exportedAt: 2026-02-16T20:00:00.000Z
-- @opIds: 5601

-- Source for Lidarr quality names and default sizes:
-- https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Qualities/Quality.cs

-- --- BEGIN op 5601 ( insert lidarr_quality_definitions defaults )
WITH lidarr_qd (quality, min_size, max_size, preferred_size) AS (
  VALUES
    ('Unknown',        0, 350, 195),
    ('MP3-8',          0,  10,   5),
    ('MP3-16',         0,  20,  15),
    ('MP3-24',         0,  30,  25),
    ('MP3-32',         0,  40,  35),
    ('MP3-40',         0,  45,  40),
    ('MP3-48',         0,  55,  50),
    ('MP3-56',         0,  65,  60),
    ('MP3-64',         0,  75,  70),
    ('MP3-80',         0,  95,  90),
    ('MP3-96',         0, 110,  95),
    ('MP3-112',        0, 125,  95),
    ('MP3-128',        0, 140,  95),
    ('OGG Vorbis Q5',  0, 175,  95),
    ('MP3-160',        0, 175,  95),
    ('MP3-192',        0, 210,  95),
    ('OGG Vorbis Q6',  0, 210,  95),
    ('AAC-192',        0, 210,  95),
    ('WMA',            0, 350, 195),
    ('MP3-224',        0, 245,  95),
    ('OGG Vorbis Q7',  0, 245,  95),
    ('MP3-VBR-V2',     0, 280,  95),
    ('MP3-256',        0, 280,  95),
    ('OGG Vorbis Q8',  0, 280,  95),
    ('AAC-256',        0, 280,  95),
    ('MP3-VBR-V0',     0, 350, 195),
    ('AAC-VBR',        0, 350, 195),
    ('MP3-320',        0, 350, 195),
    ('OGG Vorbis Q9',  0, 350, 195),
    ('AAC-320',        0, 350, 195),
    ('OGG Vorbis Q10', 0, 550, 295),
    ('FLAC',           99.9,   0, 895),
    ('ALAC',           99.9,   0, 895),
    ('APE',            99.9,   0, 895),
    ('WavPack',        99.9,   0, 895),
    ('FLAC 24bit',     99.9,   0, 895),
    ('ALAC 24bit',     99.9,   0, 895),
    ('WAV',            0,   0, 895)
)
INSERT INTO lidarr_quality_definitions (name, quality_name, min_size, max_size, preferred_size)
SELECT 'Lidarr', q.name, d.min_size, d.max_size, d.preferred_size
FROM lidarr_qd d
JOIN qualities q
  ON q.name = d.quality
WHERE NOT EXISTS (
  SELECT 1
  FROM lidarr_quality_definitions lqd
  WHERE lqd.name = 'Lidarr'
    AND lqd.quality_name = q.name
);
-- --- END op 5601
