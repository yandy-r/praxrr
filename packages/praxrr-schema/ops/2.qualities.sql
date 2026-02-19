-- Qualities (Video - Radarr/Sonarr)
INSERT INTO qualities (name) VALUES
('Unknown'),
('WORKPRINT'),
('CAM'),
('TELESYNC'),
('TELECINE'),
('DVDSCR'),
('REGIONAL'),
('SDTV'),
('DVD'),
('DVD-R'),
('HDTV-480p'),
('HDTV-720p'),
('HDTV-1080p'),
('HDTV-2160p'),
('WEBDL-480p'),
('WEBDL-720p'),
('WEBDL-1080p'),
('WEBDL-2160p'),
('WEBRip-480p'),
('WEBRip-720p'),
('WEBRip-1080p'),
('WEBRip-2160p'),
('Bluray-480p'),
('Bluray-576p'),
('Bluray-720p'),
('Bluray-1080p'),
('Bluray-2160p'),
('Remux-1080p'),
('Remux-2160p'),
('BR-DISK'),
('Raw-HD');

-- Qualities (Audio - Lidarr)
-- Source: https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Qualities/Quality.cs
INSERT INTO qualities (name) VALUES
('MP3-8'),
('MP3-16'),
('MP3-24'),
('MP3-32'),
('MP3-40'),
('MP3-48'),
('MP3-56'),
('MP3-64'),
('MP3-80'),
('MP3-96'),
('MP3-112'),
('MP3-128'),
('MP3-160'),
('MP3-192'),
('MP3-224'),
('MP3-256'),
('MP3-320'),
('MP3-VBR-V0'),
('MP3-VBR-V2'),
('AAC-192'),
('AAC-256'),
('AAC-320'),
('AAC-VBR'),
('OGG Vorbis Q5'),
('OGG Vorbis Q6'),
('OGG Vorbis Q7'),
('OGG Vorbis Q8'),
('OGG Vorbis Q9'),
('OGG Vorbis Q10'),
('WMA'),
('FLAC'),
('ALAC'),
('APE'),
('WavPack'),
('FLAC 24bit'),
('ALAC 24bit'),
('WAV');

-- Radarr mappings (30 qualities)
INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
SELECT name, 'radarr', name FROM qualities WHERE name IN (
    'Unknown', 'WORKPRINT', 'CAM', 'TELESYNC', 'TELECINE', 'DVDSCR', 'REGIONAL',
    'SDTV', 'DVD', 'DVD-R', 'HDTV-720p', 'HDTV-1080p', 'HDTV-2160p',
    'WEBDL-480p', 'WEBDL-720p', 'WEBDL-1080p', 'WEBDL-2160p',
    'WEBRip-480p', 'WEBRip-720p', 'WEBRip-1080p', 'WEBRip-2160p',
    'Bluray-480p', 'Bluray-576p', 'Bluray-720p', 'Bluray-1080p', 'Bluray-2160p',
    'Remux-1080p', 'Remux-2160p', 'BR-DISK', 'Raw-HD'
);

-- Sonarr mappings (20 exact matches + 2 remuxes with different names)
INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
SELECT name, 'sonarr', name FROM qualities WHERE name IN (
    'Unknown', 'SDTV', 'DVD', 'HDTV-720p', 'HDTV-1080p', 'HDTV-2160p',
    'WEBDL-480p', 'WEBDL-720p', 'WEBDL-1080p', 'WEBDL-2160p',
    'WEBRip-480p', 'WEBRip-720p', 'WEBRip-1080p', 'WEBRip-2160p',
    'Bluray-480p', 'Bluray-576p', 'Bluray-720p', 'Bluray-1080p', 'Bluray-2160p',
    'Raw-HD'
);

-- Sonarr remux mappings (different names)
INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
SELECT name, 'sonarr', 'Bluray-1080p Remux' FROM qualities WHERE name = 'Remux-1080p';

INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
SELECT name, 'sonarr', 'Bluray-2160p Remux' FROM qualities WHERE name = 'Remux-2160p';

-- Lidarr mappings (38 qualities)
INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
SELECT name, 'lidarr', name FROM qualities WHERE name IN (
    'Unknown',
    'MP3-8', 'MP3-16', 'MP3-24', 'MP3-32', 'MP3-40', 'MP3-48', 'MP3-56',
    'MP3-64', 'MP3-80', 'MP3-96', 'MP3-112', 'MP3-128', 'MP3-160',
    'MP3-192', 'MP3-224', 'MP3-256', 'MP3-320', 'MP3-VBR-V0', 'MP3-VBR-V2',
    'AAC-192', 'AAC-256', 'AAC-320', 'AAC-VBR',
    'OGG Vorbis Q5', 'OGG Vorbis Q6', 'OGG Vorbis Q7', 'OGG Vorbis Q8',
    'OGG Vorbis Q9', 'OGG Vorbis Q10',
    'WMA', 'FLAC', 'ALAC', 'APE', 'WavPack', 'FLAC 24bit', 'ALAC 24bit', 'WAV'
);
