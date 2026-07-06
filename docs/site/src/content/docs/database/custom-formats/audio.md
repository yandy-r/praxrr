---
title: Audio
description: Custom formats for audio codecs and channel layouts.
---

Formats that match audio codec, channel, or lossless/lossy characteristics in release titles.

**20** custom formats in this category.

| Name                   | Description                                                                                    | Tags         |
| ---------------------- | ---------------------------------------------------------------------------------------------- | ------------ |
| AAC                    | Matches 'AAC' Regex Pattern and negates any other audio types that might conflict.             | Audio        |
| Atmos                  | Matches 'Atmos' Regex Pattern                                                                  | Audio, Dolby |
| Atmos (Missing)        | Attempts to match releases which have Atmos (TrueHD 7.1) that don't label it correctly.        | Audio, Dolby |
| Dolby Atmos            | Matches 'Atmos' Regex Pattern                                                                  | Audio, Dolby |
| Dolby Digital          | Matches 'Dolby Digital' Regex Pattern and negates any other audio types that might conflict.   | Audio        |
| Dolby Digital +        | Matches 'Dolby Digital +' Regex Pattern and negates any other audio types that might conflict. | Audio        |
| DTS                    | Matches 'DTS' Regex Pattern and negates any other audio types that might conflict.             | Audio        |
| DTS-ES                 | Matches 'DTS-ES' Regex Pattern and negates any other audio types that might conflict.          | Audio        |
| DTS-HD HRA             | Matches 'DTS-HD HRA' Regex Pattern and negates any other audio types that might conflict.      | Audio        |
| DTS-HD MA              | Matches 'DTS-HD MA' Regex Pattern and negates any other audio types that might conflict.       | Audio        |
| DTS-X                  | Matches 'DTS-X' Regex Pattern and negates any other audio types that might conflict.           | Audio        |
| FLAC                   | Matches 'FLAC' Regex Pattern and negates any other audio types that might conflict.            | Audio        |
| Lidarr - AAC (Praxrr)  | Matches AAC lossy audio codec for Lidarr.                                                      | Audio        |
| Lidarr - FLAC (Praxrr) | Matches FLAC lossless audio codec for Lidarr.                                                  | Audio        |
| Lidarr - Opus (Praxrr) | Matches Opus audio codec for Lidarr.                                                           | Audio        |
| Lossless Audio         | Matches any Lossless Audio Track not in a 2160p Release.                                       | Audio        |
| Opus                   | Matches 'Opus' Regex Pattern and negates any other audio types that might conflict.            | Audio        |
| PCM                    | Matches 'PCM' Regex Pattern and negates any other audio types that might conflict.             | Audio        |
| TrueHD                 | Matches 'TrueHD' Regex Pattern and negates any other audio types that might conflict.          | Audio        |
| TrueHD (Missing)       | Attempts to match TrueHD releases which are not labelled correctly (TRiTON, EPSiLON groups)    | Audio        |

See the [full catalog overview](/database/custom-formats/) for scoring context and links to
[quality profile presets](/database/quality-profiles/presets/).
