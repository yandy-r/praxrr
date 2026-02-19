-- @operation: export
-- @entity: batch
-- @name: fix: set qp languages to any (update logic was borked before)
-- @exportedAt: 2026-02-12T10:14:28.677Z
-- @opIds: 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028

-- --- BEGIN op 2004 ( update quality_profile "1080p Balanced" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '1080p Balanced' AND language_name = 'Any' AND type = 'simple';
-- --- END op 2004

-- --- BEGIN op 2005 ( update quality_profile "1080p Balanced" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '1080p Balanced' AND language_name = 'Original';
-- --- END op 2005

-- --- BEGIN op 2006 ( update quality_profile "1080p Compact" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '1080p Compact' AND language_name = 'Any';
-- --- END op 2006

-- --- BEGIN op 2007 ( update quality_profile "1080p Compact" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '1080p Compact' AND language_name = 'Original';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '1080p Compact', 'Any', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '1080p Compact'
);
-- --- END op 2007

-- --- BEGIN op 2008 ( update quality_profile "1080p Balanced" )
INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '1080p Balanced', 'Any', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '1080p Balanced'
);
-- --- END op 2008

-- --- BEGIN op 2009 ( update quality_profile "1080p Efficient" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '1080p Efficient' AND language_name = 'Any';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '1080p Efficient', 'Original', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '1080p Efficient'
);
-- --- END op 2009

-- --- BEGIN op 2010 ( update quality_profile "1080p Efficient" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '1080p Efficient' AND language_name = 'Original';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '1080p Efficient', 'Any', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '1080p Efficient'
);
-- --- END op 2010

-- --- BEGIN op 2011 ( update quality_profile "1080p Quality" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '1080p Quality' AND language_name = 'Any';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '1080p Quality', 'Original', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '1080p Quality'
);
-- --- END op 2011

-- --- BEGIN op 2012 ( update quality_profile "1080p Quality" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '1080p Quality' AND language_name = 'Original';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '1080p Quality', 'Any', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '1080p Quality'
);
-- --- END op 2012

-- --- BEGIN op 2013 ( update quality_profile "1080p Quality HDR" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '1080p Quality HDR' AND language_name = 'Any';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '1080p Quality HDR', 'Original', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '1080p Quality HDR'
);
-- --- END op 2013

-- --- BEGIN op 2014 ( update quality_profile "1080p Quality HDR" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '1080p Quality HDR' AND language_name = 'Original';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '1080p Quality HDR', 'Any', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '1080p Quality HDR'
);
-- --- END op 2014

-- --- BEGIN op 2015 ( update quality_profile "1080p Quality HDR" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '1080p Quality HDR' AND language_name = 'Any';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '1080p Quality HDR', 'Original', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '1080p Quality HDR'
);
-- --- END op 2015

-- --- BEGIN op 2016 ( update quality_profile "1080p Quality HDR" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '1080p Quality HDR' AND language_name = 'Original';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '1080p Quality HDR', 'Any', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '1080p Quality HDR'
);
-- --- END op 2016

-- --- BEGIN op 2017 ( update quality_profile "1080p Remux" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '1080p Remux' AND language_name = 'Any';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '1080p Remux', 'Original', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '1080p Remux'
);
-- --- END op 2017

-- --- BEGIN op 2018 ( update quality_profile "1080p Remux" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '1080p Remux' AND language_name = 'Original';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '1080p Remux', 'Any', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '1080p Remux'
);
-- --- END op 2018

-- --- BEGIN op 2019 ( update quality_profile "2160p Balanced" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '2160p Balanced' AND language_name = 'Any';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '2160p Balanced', 'Original', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '2160p Balanced'
);
-- --- END op 2019

-- --- BEGIN op 2020 ( update quality_profile "2160p Balanced" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '2160p Balanced' AND language_name = 'Original';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '2160p Balanced', 'Any', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '2160p Balanced'
);
-- --- END op 2020

-- --- BEGIN op 2021 ( update quality_profile "2160p Efficient" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '2160p Efficient' AND language_name = 'Any';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '2160p Efficient', 'Original', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '2160p Efficient'
);
-- --- END op 2021

-- --- BEGIN op 2022 ( update quality_profile "2160p Efficient" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '2160p Efficient' AND language_name = 'Original';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '2160p Efficient', 'Any', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '2160p Efficient'
);
-- --- END op 2022

-- --- BEGIN op 2023 ( update quality_profile "2160p Quality" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '2160p Quality' AND language_name = 'Any';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '2160p Quality', 'Original', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '2160p Quality'
);
-- --- END op 2023

-- --- BEGIN op 2024 ( update quality_profile "2160p Quality" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '2160p Quality' AND language_name = 'Original';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '2160p Quality', 'Any', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '2160p Quality'
);
-- --- END op 2024

-- --- BEGIN op 2025 ( update quality_profile "2160p Remux" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '2160p Remux' AND language_name = 'Any';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '2160p Remux', 'Original', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '2160p Remux'
);
-- --- END op 2025

-- --- BEGIN op 2026 ( update quality_profile "2160p Remux" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '2160p Remux' AND language_name = 'Original';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '2160p Remux', 'Any', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '2160p Remux'
);
-- --- END op 2026

-- --- BEGIN op 2027 ( update quality_profile "720p Quality" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '720p Quality' AND language_name = 'Any';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '720p Quality', 'Original', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '720p Quality'
);
-- --- END op 2027

-- --- BEGIN op 2028 ( update quality_profile "720p Quality" )
DELETE FROM quality_profile_languages WHERE quality_profile_name = '720p Quality' AND language_name = 'Original';

INSERT INTO quality_profile_languages (quality_profile_name, language_name, type)
SELECT '720p Quality', 'Any', 'simple'
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_languages
  WHERE quality_profile_name = '720p Quality'
);
-- --- END op 2028
