---
title: Codecs & HDR
description: Custom formats for video codecs, HDR, and colour grading.
---

Formats matching x265/x264/AV1/VVC/VP9 codecs, HDR variants, and colour-grade tags.

**22** custom formats in this category.

| Name                            | Description                                                                                              | Tags                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------- |
| AV1                             | Matches the 'AV1' Regex Pattern                                                                          | Bleeding Edge, Codec |
| Dolby Vision                    | Matches the 'Dolby Vision' Regex Pattern                                                                 | Colour Grade, HDR    |
| Dolby Vision (Without Fallback) | Matches the 'Dolby Vision (Without Fallback) Regex Pattern                                               | Colour Grade, HDR    |
| h265                            | Matches h265 Releases that are not 2160p                                                                 | Codec                |
| h265 (Efficient)                | Matches h265 Releases that are not 2160p or 1080p                                                        | Codec                |
| HDR                             | Matches the 'HDR' Regex Pattern                                                                          | Colour Grade, HDR    |
| HDR (Missing)                   | Attempts to match HDR in 1080p x265 Encodes labelled with x265                                           | Colour Grade, HDR    |
| HDR10                           | Matches the 'HDR10' Regex Pattern                                                                        | Colour Grade, HDR    |
| HDR10 (Missing)                 | Attempts to match HDR10 to groups that mislabel their releases. _This does not work properly in sonarr._ | Colour Grade, HDR    |
| HDR10+                          | Matches the 'HDR10+' Regex Pattern                                                                       | Colour Grade, HDR    |
| HLG                             | Matches the 'HLG' Regex Pattern                                                                          | Colour Grade, HDR    |
| PQ                              | Matches the 'PQ' Regex Pattern                                                                           | Colour Grade, HDR    |
| VP9                             | Matches the 'VP9' Regex Pattern                                                                          | Bleeding Edge, Codec |
| VVC                             | Matches the 'VVC' Regex Pattern                                                                          | Bleeding Edge, Codec |
| x264 (2160p)                    | Matches x264 releases for 2160p                                                                          | Codec                |
| x265                            | Matches x265 Releases when not 2160p                                                                     | Codec                |
| x265 (Bluray)                   | Matches x265 Bluray Releases when not 2160p                                                              | Codec                |
| x265 (Efficient)                | Matches x/h265 Releases when not 2160p or 1080p                                                          | Codec                |
| x265 (Missing)                  | Attempts to match 2160p x265 encodes that aren't labelled with any codec.                                | Codec                |
| x265 (Remux)                    | Matches x265 Remux Releases when not 2160p                                                               | Codec                |
| x265 (WEB)                      | Matches x265 Releases when not 2160p or Blurays                                                          | Codec                |
| Xvid                            | Matches Xvid Regex                                                                                       | Codec                |

See the [full catalog overview](/database/custom-formats/) for scoring context and links to
[quality profile presets](/database/quality-profiles/presets/).
