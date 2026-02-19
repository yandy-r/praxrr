-- @operation: export
-- @entity: batch
-- @name: Seed Lidarr First-Class Defaults
-- @exportedAt: 2026-02-16T00:00:00.000Z
-- @opIds: 5501, 5502, 5503, 5504, 5505, 5506, 5507, 5508, 5509, 5510, 5511, 5512, 5513, 5514, 5515, 5516, 5517, 5518, 5519, 5520

-- =============================================================================
-- Custom Formats
-- =============================================================================

-- --- BEGIN op 5501 ( ensure custom_format "Lidarr - FLAC (Praxrr)" exists )
INSERT INTO custom_formats (name, description)
SELECT 'Lidarr - FLAC (Praxrr)', 'Matches FLAC lossless audio codec for Lidarr.'
WHERE NOT EXISTS (
  SELECT 1 FROM custom_formats WHERE name = 'Lidarr - FLAC (Praxrr)'
);
-- --- END op 5501

-- --- BEGIN op 5502 ( ensure custom_format "Lidarr - AAC (Praxrr)" exists )
INSERT INTO custom_formats (name, description)
SELECT 'Lidarr - AAC (Praxrr)', 'Matches AAC lossy audio codec for Lidarr.'
WHERE NOT EXISTS (
  SELECT 1 FROM custom_formats WHERE name = 'Lidarr - AAC (Praxrr)'
);
-- --- END op 5502

-- --- BEGIN op 5503 ( ensure custom_format "Lidarr - Opus (Praxrr)" exists )
INSERT INTO custom_formats (name, description)
SELECT 'Lidarr - Opus (Praxrr)', 'Matches Opus audio codec for Lidarr.'
WHERE NOT EXISTS (
  SELECT 1 FROM custom_formats WHERE name = 'Lidarr - Opus (Praxrr)'
);
-- --- END op 5503

-- =============================================================================
-- Custom Format Tags
-- =============================================================================

-- --- BEGIN op 5504 ( ensure custom_format_tag "Lidarr - FLAC (Praxrr)" -> "Audio" )
INSERT INTO custom_format_tags (custom_format_name, tag_name)
SELECT cf.name, t.name
FROM custom_formats cf, tags t
WHERE cf.name = 'Lidarr - FLAC (Praxrr)' AND t.name = 'Audio'
AND NOT EXISTS (
  SELECT 1 FROM custom_format_tags
  WHERE custom_format_name = 'Lidarr - FLAC (Praxrr)' AND tag_name = 'Audio'
);
-- --- END op 5504

-- --- BEGIN op 5505 ( ensure custom_format_tag "Lidarr - AAC (Praxrr)" -> "Audio" )
INSERT INTO custom_format_tags (custom_format_name, tag_name)
SELECT cf.name, t.name
FROM custom_formats cf, tags t
WHERE cf.name = 'Lidarr - AAC (Praxrr)' AND t.name = 'Audio'
AND NOT EXISTS (
  SELECT 1 FROM custom_format_tags
  WHERE custom_format_name = 'Lidarr - AAC (Praxrr)' AND tag_name = 'Audio'
);
-- --- END op 5505

-- --- BEGIN op 5506 ( ensure custom_format_tag "Lidarr - Opus (Praxrr)" -> "Audio" )
INSERT INTO custom_format_tags (custom_format_name, tag_name)
SELECT cf.name, t.name
FROM custom_formats cf, tags t
WHERE cf.name = 'Lidarr - Opus (Praxrr)' AND t.name = 'Audio'
AND NOT EXISTS (
  SELECT 1 FROM custom_format_tags
  WHERE custom_format_name = 'Lidarr - Opus (Praxrr)' AND tag_name = 'Audio'
);
-- --- END op 5506

-- =============================================================================
-- Quality Profiles
-- =============================================================================

-- --- BEGIN op 5507 ( ensure quality_profile "Lidarr - Lossless (Praxrr)" exists )
INSERT INTO quality_profiles (name, description, upgrades_allowed, minimum_custom_format_score, upgrade_until_score, upgrade_score_increment)
SELECT
  'Lidarr - Lossless (Praxrr)',
  'Targets lossless audio: FLAC, ALAC, APE, WavPack, FLAC 24bit, ALAC 24bit, and WAV.',
  1,
  0,
  999999,
  1
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profiles WHERE name = 'Lidarr - Lossless (Praxrr)'
);
-- --- END op 5507

-- --- BEGIN op 5508 ( ensure quality_profile "Lidarr - High Quality Lossy (Praxrr)" exists )
INSERT INTO quality_profiles (name, description, upgrades_allowed, minimum_custom_format_score, upgrade_until_score, upgrade_score_increment)
SELECT
  'Lidarr - High Quality Lossy (Praxrr)',
  'Targets high quality lossy audio: AAC-320, AAC-VBR, MP3-320, MP3-VBR-V0, OGG Vorbis Q9, OGG Vorbis Q10, and Opus.',
  1,
  0,
  999999,
  1
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profiles WHERE name = 'Lidarr - High Quality Lossy (Praxrr)'
);
-- --- END op 5508

-- --- BEGIN op 5509 ( ensure quality_profile "Lidarr - Lossy (Praxrr)" exists )
INSERT INTO quality_profiles (name, description, upgrades_allowed, minimum_custom_format_score, upgrade_until_score, upgrade_score_increment)
SELECT
  'Lidarr - Lossy (Praxrr)',
  'Targets lossy audio: AAC-192, AAC-256, MP3-192 through MP3-256, MP3-VBR-V2, and OGG Vorbis Q6-Q8.',
  1,
  0,
  999999,
  1
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profiles WHERE name = 'Lidarr - Lossy (Praxrr)'
);
-- --- END op 5509

-- =============================================================================
-- Quality Groups
-- =============================================================================

-- --- BEGIN op 5516 ( ensure quality_groups for Lidarr first-class profiles )
INSERT INTO quality_groups (quality_profile_name, name)
SELECT qp.name, 'Lossless'
FROM quality_profiles qp
WHERE qp.name = 'Lidarr - Lossless (Praxrr)'
AND NOT EXISTS (
  SELECT 1 FROM quality_groups
  WHERE quality_profile_name = 'Lidarr - Lossless (Praxrr)' AND name = 'Lossless'
);

INSERT INTO quality_groups (quality_profile_name, name)
SELECT qp.name, 'Lossless Hi-Res'
FROM quality_profiles qp
WHERE qp.name = 'Lidarr - Lossless (Praxrr)'
AND NOT EXISTS (
  SELECT 1 FROM quality_groups
  WHERE quality_profile_name = 'Lidarr - Lossless (Praxrr)' AND name = 'Lossless Hi-Res'
);

INSERT INTO quality_groups (quality_profile_name, name)
SELECT qp.name, 'High Quality Lossy'
FROM quality_profiles qp
WHERE qp.name = 'Lidarr - High Quality Lossy (Praxrr)'
AND NOT EXISTS (
  SELECT 1 FROM quality_groups
  WHERE quality_profile_name = 'Lidarr - High Quality Lossy (Praxrr)' AND name = 'High Quality Lossy'
);

INSERT INTO quality_groups (quality_profile_name, name)
SELECT qp.name, 'Lossy'
FROM quality_profiles qp
WHERE qp.name = 'Lidarr - Lossy (Praxrr)'
AND NOT EXISTS (
  SELECT 1 FROM quality_groups
  WHERE quality_profile_name = 'Lidarr - Lossy (Praxrr)' AND name = 'Lossy'
);
-- --- END op 5516

-- =============================================================================
-- Quality Group Members
-- =============================================================================

-- --- BEGIN op 5517 ( ensure quality_group_members for Lidarr first-class profiles )

-- Lidarr - Lossless (Praxrr) -> Lossless group members
INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT 'Lidarr - Lossless (Praxrr)', 'Lossless', q.name
FROM qualities q
WHERE q.name = 'FLAC'
AND NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = 'Lidarr - Lossless (Praxrr)' AND quality_group_name = 'Lossless' AND quality_name = 'FLAC'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT 'Lidarr - Lossless (Praxrr)', 'Lossless', q.name
FROM qualities q
WHERE q.name = 'ALAC'
AND NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = 'Lidarr - Lossless (Praxrr)' AND quality_group_name = 'Lossless' AND quality_name = 'ALAC'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT 'Lidarr - Lossless (Praxrr)', 'Lossless', q.name
FROM qualities q
WHERE q.name = 'APE'
AND NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = 'Lidarr - Lossless (Praxrr)' AND quality_group_name = 'Lossless' AND quality_name = 'APE'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT 'Lidarr - Lossless (Praxrr)', 'Lossless', q.name
FROM qualities q
WHERE q.name = 'WavPack'
AND NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = 'Lidarr - Lossless (Praxrr)' AND quality_group_name = 'Lossless' AND quality_name = 'WavPack'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT 'Lidarr - Lossless (Praxrr)', 'Lossless', q.name
FROM qualities q
WHERE q.name = 'WAV'
AND NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = 'Lidarr - Lossless (Praxrr)' AND quality_group_name = 'Lossless' AND quality_name = 'WAV'
);

-- Lidarr - Lossless (Praxrr) -> Lossless Hi-Res group members
INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT 'Lidarr - Lossless (Praxrr)', 'Lossless Hi-Res', q.name
FROM qualities q
WHERE q.name = 'FLAC 24bit'
AND NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = 'Lidarr - Lossless (Praxrr)' AND quality_group_name = 'Lossless Hi-Res' AND quality_name = 'FLAC 24bit'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT 'Lidarr - Lossless (Praxrr)', 'Lossless Hi-Res', q.name
FROM qualities q
WHERE q.name = 'ALAC 24bit'
AND NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = 'Lidarr - Lossless (Praxrr)' AND quality_group_name = 'Lossless Hi-Res' AND quality_name = 'ALAC 24bit'
);

-- Lidarr - High Quality Lossy (Praxrr) -> High Quality Lossy group members
INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT 'Lidarr - High Quality Lossy (Praxrr)', 'High Quality Lossy', q.name
FROM qualities q
WHERE q.name = 'AAC-320'
AND NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = 'Lidarr - High Quality Lossy (Praxrr)' AND quality_group_name = 'High Quality Lossy' AND quality_name = 'AAC-320'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT 'Lidarr - High Quality Lossy (Praxrr)', 'High Quality Lossy', q.name
FROM qualities q
WHERE q.name = 'AAC-VBR'
AND NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = 'Lidarr - High Quality Lossy (Praxrr)' AND quality_group_name = 'High Quality Lossy' AND quality_name = 'AAC-VBR'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT 'Lidarr - High Quality Lossy (Praxrr)', 'High Quality Lossy', q.name
FROM qualities q
WHERE q.name = 'MP3-320'
AND NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = 'Lidarr - High Quality Lossy (Praxrr)' AND quality_group_name = 'High Quality Lossy' AND quality_name = 'MP3-320'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT 'Lidarr - High Quality Lossy (Praxrr)', 'High Quality Lossy', q.name
FROM qualities q
WHERE q.name = 'MP3-VBR-V0'
AND NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = 'Lidarr - High Quality Lossy (Praxrr)' AND quality_group_name = 'High Quality Lossy' AND quality_name = 'MP3-VBR-V0'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT 'Lidarr - High Quality Lossy (Praxrr)', 'High Quality Lossy', q.name
FROM qualities q
WHERE q.name = 'OGG Vorbis Q9'
AND NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = 'Lidarr - High Quality Lossy (Praxrr)' AND quality_group_name = 'High Quality Lossy' AND quality_name = 'OGG Vorbis Q9'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT 'Lidarr - High Quality Lossy (Praxrr)', 'High Quality Lossy', q.name
FROM qualities q
WHERE q.name = 'OGG Vorbis Q10'
AND NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = 'Lidarr - High Quality Lossy (Praxrr)' AND quality_group_name = 'High Quality Lossy' AND quality_name = 'OGG Vorbis Q10'
);

-- Lidarr - Lossy (Praxrr) -> Lossy group members
INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT 'Lidarr - Lossy (Praxrr)', 'Lossy', q.name
FROM qualities q
WHERE q.name = 'AAC-192'
AND NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = 'Lidarr - Lossy (Praxrr)' AND quality_group_name = 'Lossy' AND quality_name = 'AAC-192'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT 'Lidarr - Lossy (Praxrr)', 'Lossy', q.name
FROM qualities q
WHERE q.name = 'AAC-256'
AND NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = 'Lidarr - Lossy (Praxrr)' AND quality_group_name = 'Lossy' AND quality_name = 'AAC-256'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT 'Lidarr - Lossy (Praxrr)', 'Lossy', q.name
FROM qualities q
WHERE q.name = 'MP3-192'
AND NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = 'Lidarr - Lossy (Praxrr)' AND quality_group_name = 'Lossy' AND quality_name = 'MP3-192'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT 'Lidarr - Lossy (Praxrr)', 'Lossy', q.name
FROM qualities q
WHERE q.name = 'MP3-224'
AND NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = 'Lidarr - Lossy (Praxrr)' AND quality_group_name = 'Lossy' AND quality_name = 'MP3-224'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT 'Lidarr - Lossy (Praxrr)', 'Lossy', q.name
FROM qualities q
WHERE q.name = 'MP3-256'
AND NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = 'Lidarr - Lossy (Praxrr)' AND quality_group_name = 'Lossy' AND quality_name = 'MP3-256'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT 'Lidarr - Lossy (Praxrr)', 'Lossy', q.name
FROM qualities q
WHERE q.name = 'MP3-VBR-V2'
AND NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = 'Lidarr - Lossy (Praxrr)' AND quality_group_name = 'Lossy' AND quality_name = 'MP3-VBR-V2'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT 'Lidarr - Lossy (Praxrr)', 'Lossy', q.name
FROM qualities q
WHERE q.name = 'OGG Vorbis Q6'
AND NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = 'Lidarr - Lossy (Praxrr)' AND quality_group_name = 'Lossy' AND quality_name = 'OGG Vorbis Q6'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT 'Lidarr - Lossy (Praxrr)', 'Lossy', q.name
FROM qualities q
WHERE q.name = 'OGG Vorbis Q7'
AND NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = 'Lidarr - Lossy (Praxrr)' AND quality_group_name = 'Lossy' AND quality_name = 'OGG Vorbis Q7'
);

INSERT INTO quality_group_members (quality_profile_name, quality_group_name, quality_name)
SELECT 'Lidarr - Lossy (Praxrr)', 'Lossy', q.name
FROM qualities q
WHERE q.name = 'OGG Vorbis Q8'
AND NOT EXISTS (
  SELECT 1 FROM quality_group_members
  WHERE quality_profile_name = 'Lidarr - Lossy (Praxrr)' AND quality_group_name = 'Lossy' AND quality_name = 'OGG Vorbis Q8'
);
-- --- END op 5517

-- =============================================================================
-- Custom Format Conditions
-- =============================================================================

-- --- BEGIN op 5510 ( ensure custom_format_conditions for "Lidarr - FLAC (Praxrr)" )
WITH flac_conditions (custom_format_name, name, type, negate, required) AS (
  VALUES
    ('Lidarr - FLAC (Praxrr)', 'FLAC', 'release_title', 0, 1),
    ('Lidarr - FLAC (Praxrr)', 'Not AAC', 'release_title', 1, 1)
)
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
SELECT seed.custom_format_name, seed.name, seed.type, 'lidarr', seed.negate, seed.required
FROM flac_conditions seed
WHERE EXISTS (
  SELECT 1
  FROM custom_formats cf
  WHERE cf.name = seed.custom_format_name
)
AND NOT EXISTS (
  SELECT 1
  FROM custom_format_conditions existing
  WHERE existing.custom_format_name = seed.custom_format_name
    AND existing.name = seed.name
    AND existing.arr_type = 'lidarr'
);
-- --- END op 5510

-- --- BEGIN op 5511 ( ensure custom_format_conditions for "Lidarr - AAC (Praxrr)" )
WITH aac_conditions (custom_format_name, name, type, negate, required) AS (
  VALUES
    ('Lidarr - AAC (Praxrr)', 'AAC', 'release_title', 0, 1),
    ('Lidarr - AAC (Praxrr)', 'Not FLAC', 'release_title', 1, 1)
)
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
SELECT seed.custom_format_name, seed.name, seed.type, 'lidarr', seed.negate, seed.required
FROM aac_conditions seed
WHERE EXISTS (
  SELECT 1
  FROM custom_formats cf
  WHERE cf.name = seed.custom_format_name
)
AND NOT EXISTS (
  SELECT 1
  FROM custom_format_conditions existing
  WHERE existing.custom_format_name = seed.custom_format_name
    AND existing.name = seed.name
    AND existing.arr_type = 'lidarr'
);
-- --- END op 5511

-- --- BEGIN op 5512 ( ensure custom_format_conditions for "Lidarr - Opus (Praxrr)" )
WITH opus_conditions (custom_format_name, name, type, negate, required) AS (
  VALUES
    ('Lidarr - Opus (Praxrr)', 'Opus', 'release_title', 0, 1),
    ('Lidarr - Opus (Praxrr)', 'Not OPUS Release Group', 'release_group', 1, 1)
)
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
SELECT seed.custom_format_name, seed.name, seed.type, 'lidarr', seed.negate, seed.required
FROM opus_conditions seed
WHERE EXISTS (
  SELECT 1
  FROM custom_formats cf
  WHERE cf.name = seed.custom_format_name
)
AND NOT EXISTS (
  SELECT 1
  FROM custom_format_conditions existing
  WHERE existing.custom_format_name = seed.custom_format_name
    AND existing.name = seed.name
    AND existing.arr_type = 'lidarr'
);
-- --- END op 5512

-- =============================================================================
-- Condition Patterns
-- =============================================================================

-- --- BEGIN op 5513 ( ensure condition_patterns for "Lidarr - FLAC (Praxrr)" )
INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
SELECT 'Lidarr - FLAC (Praxrr)', 'FLAC', re.name
FROM regular_expressions re
WHERE re.name = 'FLAC'
AND NOT EXISTS (
  SELECT 1 FROM condition_patterns
  WHERE custom_format_name = 'Lidarr - FLAC (Praxrr)' AND condition_name = 'FLAC' AND regular_expression_name = 'FLAC'
);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
SELECT 'Lidarr - FLAC (Praxrr)', 'Not AAC', re.name
FROM regular_expressions re
WHERE re.name = 'AAC'
AND NOT EXISTS (
  SELECT 1 FROM condition_patterns
  WHERE custom_format_name = 'Lidarr - FLAC (Praxrr)' AND condition_name = 'Not AAC' AND regular_expression_name = 'AAC'
);
-- --- END op 5513

-- --- BEGIN op 5514 ( ensure condition_patterns for "Lidarr - AAC (Praxrr)" )
INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
SELECT 'Lidarr - AAC (Praxrr)', 'AAC', re.name
FROM regular_expressions re
WHERE re.name = 'AAC'
AND NOT EXISTS (
  SELECT 1 FROM condition_patterns
  WHERE custom_format_name = 'Lidarr - AAC (Praxrr)' AND condition_name = 'AAC' AND regular_expression_name = 'AAC'
);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
SELECT 'Lidarr - AAC (Praxrr)', 'Not FLAC', re.name
FROM regular_expressions re
WHERE re.name = 'FLAC'
AND NOT EXISTS (
  SELECT 1 FROM condition_patterns
  WHERE custom_format_name = 'Lidarr - AAC (Praxrr)' AND condition_name = 'Not FLAC' AND regular_expression_name = 'FLAC'
);
-- --- END op 5514

-- --- BEGIN op 5515 ( ensure condition_patterns for "Lidarr - Opus (Praxrr)" )
INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
SELECT 'Lidarr - Opus (Praxrr)', 'Opus', re.name
FROM regular_expressions re
WHERE re.name = 'Opus'
AND NOT EXISTS (
  SELECT 1 FROM condition_patterns
  WHERE custom_format_name = 'Lidarr - Opus (Praxrr)' AND condition_name = 'Opus' AND regular_expression_name = 'Opus'
);

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
SELECT 'Lidarr - Opus (Praxrr)', 'Not OPUS Release Group', re.name
FROM regular_expressions re
WHERE re.name = 'Opus (Negation)'
AND NOT EXISTS (
  SELECT 1 FROM condition_patterns
  WHERE custom_format_name = 'Lidarr - Opus (Praxrr)' AND condition_name = 'Not OPUS Release Group' AND regular_expression_name = 'Opus (Negation)'
);
-- --- END op 5515

-- =============================================================================
-- Quality Profile Languages
-- =============================================================================

-- --- BEGIN op 5518 ( ensure quality_profile_languages for Lidarr first-class profiles )
INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT qp.name, l.name, 'must'
FROM quality_profiles qp, languages l
WHERE qp.name = 'Lidarr - Lossless (Praxrr)' AND l.name = 'Any'
AND NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = 'Lidarr - Lossless (Praxrr)'
);

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT qp.name, l.name, 'must'
FROM quality_profiles qp, languages l
WHERE qp.name = 'Lidarr - High Quality Lossy (Praxrr)' AND l.name = 'Any'
AND NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = 'Lidarr - High Quality Lossy (Praxrr)'
);

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT qp.name, l.name, 'must'
FROM quality_profiles qp, languages l
WHERE qp.name = 'Lidarr - Lossy (Praxrr)' AND l.name = 'Any'
AND NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = 'Lidarr - Lossy (Praxrr)'
);
-- --- END op 5518

-- =============================================================================
-- Quality Profile Custom Format Scores
-- =============================================================================

-- --- BEGIN op 5519 ( ensure quality_profile_custom_formats scores for Lidarr first-class profiles )
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT 'Lidarr - Lossless (Praxrr)', 'Lidarr - FLAC (Praxrr)', 'lidarr', 50000
WHERE EXISTS (
  SELECT 1 FROM quality_profiles qp WHERE qp.name = 'Lidarr - Lossless (Praxrr)'
)
AND EXISTS (
  SELECT 1 FROM custom_formats cf WHERE cf.name = 'Lidarr - FLAC (Praxrr)'
)
AND NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats qpf
  WHERE qpf.quality_profile_name = 'Lidarr - Lossless (Praxrr)'
    AND qpf.custom_format_name = 'Lidarr - FLAC (Praxrr)'
    AND qpf.arr_type = 'lidarr'
);

INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT 'Lidarr - Lossless (Praxrr)', 'Lidarr - AAC (Praxrr)', 'lidarr', 10000
WHERE EXISTS (
  SELECT 1 FROM quality_profiles qp WHERE qp.name = 'Lidarr - Lossless (Praxrr)'
)
AND EXISTS (
  SELECT 1 FROM custom_formats cf WHERE cf.name = 'Lidarr - AAC (Praxrr)'
)
AND NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats qpf
  WHERE qpf.quality_profile_name = 'Lidarr - Lossless (Praxrr)'
    AND qpf.custom_format_name = 'Lidarr - AAC (Praxrr)'
    AND qpf.arr_type = 'lidarr'
);

INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT 'Lidarr - Lossless (Praxrr)', 'Lidarr - Opus (Praxrr)', 'lidarr', 20000
WHERE EXISTS (
  SELECT 1 FROM quality_profiles qp WHERE qp.name = 'Lidarr - Lossless (Praxrr)'
)
AND EXISTS (
  SELECT 1 FROM custom_formats cf WHERE cf.name = 'Lidarr - Opus (Praxrr)'
)
AND NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats qpf
  WHERE qpf.quality_profile_name = 'Lidarr - Lossless (Praxrr)'
    AND qpf.custom_format_name = 'Lidarr - Opus (Praxrr)'
    AND qpf.arr_type = 'lidarr'
);

INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT 'Lidarr - High Quality Lossy (Praxrr)', 'Lidarr - FLAC (Praxrr)', 'lidarr', 20000
WHERE EXISTS (
  SELECT 1 FROM quality_profiles qp WHERE qp.name = 'Lidarr - High Quality Lossy (Praxrr)'
)
AND EXISTS (
  SELECT 1 FROM custom_formats cf WHERE cf.name = 'Lidarr - FLAC (Praxrr)'
)
AND NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats qpf
  WHERE qpf.quality_profile_name = 'Lidarr - High Quality Lossy (Praxrr)'
    AND qpf.custom_format_name = 'Lidarr - FLAC (Praxrr)'
    AND qpf.arr_type = 'lidarr'
);

INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT 'Lidarr - High Quality Lossy (Praxrr)', 'Lidarr - AAC (Praxrr)', 'lidarr', 40000
WHERE EXISTS (
  SELECT 1 FROM quality_profiles qp WHERE qp.name = 'Lidarr - High Quality Lossy (Praxrr)'
)
AND EXISTS (
  SELECT 1 FROM custom_formats cf WHERE cf.name = 'Lidarr - AAC (Praxrr)'
)
AND NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats qpf
  WHERE qpf.quality_profile_name = 'Lidarr - High Quality Lossy (Praxrr)'
    AND qpf.custom_format_name = 'Lidarr - AAC (Praxrr)'
    AND qpf.arr_type = 'lidarr'
);

INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT 'Lidarr - High Quality Lossy (Praxrr)', 'Lidarr - Opus (Praxrr)', 'lidarr', 50000
WHERE EXISTS (
  SELECT 1 FROM quality_profiles qp WHERE qp.name = 'Lidarr - High Quality Lossy (Praxrr)'
)
AND EXISTS (
  SELECT 1 FROM custom_formats cf WHERE cf.name = 'Lidarr - Opus (Praxrr)'
)
AND NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats qpf
  WHERE qpf.quality_profile_name = 'Lidarr - High Quality Lossy (Praxrr)'
    AND qpf.custom_format_name = 'Lidarr - Opus (Praxrr)'
    AND qpf.arr_type = 'lidarr'
);

INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT 'Lidarr - Lossy (Praxrr)', 'Lidarr - FLAC (Praxrr)', 'lidarr', 10000
WHERE EXISTS (
  SELECT 1 FROM quality_profiles qp WHERE qp.name = 'Lidarr - Lossy (Praxrr)'
)
AND EXISTS (
  SELECT 1 FROM custom_formats cf WHERE cf.name = 'Lidarr - FLAC (Praxrr)'
)
AND NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats qpf
  WHERE qpf.quality_profile_name = 'Lidarr - Lossy (Praxrr)'
    AND qpf.custom_format_name = 'Lidarr - FLAC (Praxrr)'
    AND qpf.arr_type = 'lidarr'
);

INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT 'Lidarr - Lossy (Praxrr)', 'Lidarr - AAC (Praxrr)', 'lidarr', 50000
WHERE EXISTS (
  SELECT 1 FROM quality_profiles qp WHERE qp.name = 'Lidarr - Lossy (Praxrr)'
)
AND EXISTS (
  SELECT 1 FROM custom_formats cf WHERE cf.name = 'Lidarr - AAC (Praxrr)'
)
AND NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats qpf
  WHERE qpf.quality_profile_name = 'Lidarr - Lossy (Praxrr)'
    AND qpf.custom_format_name = 'Lidarr - AAC (Praxrr)'
    AND qpf.arr_type = 'lidarr'
);

INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT 'Lidarr - Lossy (Praxrr)', 'Lidarr - Opus (Praxrr)', 'lidarr', 30000
WHERE EXISTS (
  SELECT 1 FROM quality_profiles qp WHERE qp.name = 'Lidarr - Lossy (Praxrr)'
)
AND EXISTS (
  SELECT 1 FROM custom_formats cf WHERE cf.name = 'Lidarr - Opus (Praxrr)'
)
AND NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats qpf
  WHERE qpf.quality_profile_name = 'Lidarr - Lossy (Praxrr)'
    AND qpf.custom_format_name = 'Lidarr - Opus (Praxrr)'
    AND qpf.arr_type = 'lidarr'
);
-- --- END op 5519

-- =============================================================================
-- Quality Profile Qualities (Rankings)
-- =============================================================================

-- --- BEGIN op 5520 ( ensure quality_profile_qualities rankings for Lidarr first-class profiles )
INSERT INTO quality_profile_qualities (quality_profile_name, quality_group_name, position, upgrade_until)
SELECT qp.name, qg.name, 0, 1
FROM quality_profiles qp, quality_groups qg
WHERE qp.name = 'Lidarr - Lossless (Praxrr)' AND qg.quality_profile_name = qp.name AND qg.name = 'Lossless Hi-Res'
AND NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = 'Lidarr - Lossless (Praxrr)' AND quality_group_name = 'Lossless Hi-Res'
);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_group_name, position, upgrade_until)
SELECT qp.name, qg.name, 1, 0
FROM quality_profiles qp, quality_groups qg
WHERE qp.name = 'Lidarr - Lossless (Praxrr)' AND qg.quality_profile_name = qp.name AND qg.name = 'Lossless'
AND NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = 'Lidarr - Lossless (Praxrr)' AND quality_group_name = 'Lossless'
);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_group_name, position, upgrade_until)
SELECT qp.name, qg.name, 0, 1
FROM quality_profiles qp, quality_groups qg
WHERE qp.name = 'Lidarr - High Quality Lossy (Praxrr)' AND qg.quality_profile_name = qp.name AND qg.name = 'High Quality Lossy'
AND NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = 'Lidarr - High Quality Lossy (Praxrr)' AND quality_group_name = 'High Quality Lossy'
);

INSERT INTO quality_profile_qualities (quality_profile_name, quality_group_name, position, upgrade_until)
SELECT qp.name, qg.name, 0, 1
FROM quality_profiles qp, quality_groups qg
WHERE qp.name = 'Lidarr - Lossy (Praxrr)' AND qg.quality_profile_name = qp.name AND qg.name = 'Lossy'
AND NOT EXISTS (
  SELECT 1 FROM quality_profile_qualities
  WHERE quality_profile_name = 'Lidarr - Lossy (Praxrr)' AND quality_group_name = 'Lossy'
);
-- --- END op 5520
