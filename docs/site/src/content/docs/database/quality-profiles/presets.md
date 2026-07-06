---
title: Video Quality Presets
description: Eleven shared Radarr and Sonarr quality profile presets with use cases and notable scores.
---

These **11 presets** target common 720p, 1080p, and 2160p use cases. Each profile combines quality
tier ordering with custom format scores for release groups, sources, streaming services, and unwanted
filters.

Scores below list the highest-magnitude Radarr/Sonarr mappings as a quick reference; each profile
assigns hundreds of per-CF scores in YAML.

## 1080p Balanced

1080p Balanced targets consistent & immutable 1080p **WEB-DLs** using the Streaming Source and Audio Formats to determine the level of Transparency.

- Average Movie Sizes ~ 4 to 8gb per Movie

- Movie Quality Ranking ~ 6/10

- Average TV Sizes ~ 2 to 4gb per Episode

- TV Quality Ranking ~ 7/10

| Setting               | Value                                            |
| --------------------- | ------------------------------------------------ |
| Minimum score         | 20000                                            |
| Upgrade until score   | 1000000                                          |
| Upgrade until quality | 1080p Balanced                                   |
| Tags                  | 1080p, Balanced Focused, Lossy Audio, h264, x264 |

**Notable CF scores (Radarr/Sonarr):** 3D (-999999); B&W (-999999); Extras (-999999); Full Disc (Quality Match) (-999999); Not Original or English (-999999); Release Group (Missing) (-999999); Sing Along (-999999); Upscale (-999999); 1080p Balanced Tier 1 (+641000); 1080p Balanced Tier 2 (+640000); 1080p WEB-DL (+640000); 720p WEB-DL (+480000)

## 1080p Compact

1080p Compact targets low to medium quality x265 Bluray and WEB Encodes.

- Average Movie Sizes ~ 3 to 6gb per Movie

- Movie Quality Ranking ~ 4/10

- Average TV Sizes ~ 1 to 2gb per Episode

- TV Quality Ranking ~ 4/10

| Setting               | Value                                           |
| --------------------- | ----------------------------------------------- |
| Minimum score         | 20000                                           |
| Upgrade until score   | 1000000                                         |
| Upgrade until quality | 1080p Compact                                   |
| Tags                  | 1080p, Compact Focused, Lossy Audio, h265, x265 |

**Notable CF scores (Radarr/Sonarr):** 3D (-999999); B&W (-999999); Full Disc (Quality Match) (-999999); Not Original or English (-999999); Sing Along (-999999); Upscale (-999999); 1080p Compact Movie Bluray Tier 1 (+703000); 1080p Compact Movie Bluray Tier 2 (+702000); 1080p Compact Movie Bluray Tier 3 (+701000); Vialle Bluray (+701000); 1080p Compact Movie Bluray Tier 4 (+700000); QxR Bluray (+700000)

## 1080p Efficient

1080p Efficient targets high quality x265 Bluray and WEB Encodes

- Average Movie Sizes ~ 6 to 12gb per Movie

- Movie Quality Ranking ~ 7/10

- Average TV Sizes ~ 2 to 3gb per Episode

- TV Quality Ranking ~ 6/10

| Setting               | Value                                             |
| --------------------- | ------------------------------------------------- |
| Minimum score         | 20000                                             |
| Upgrade until score   | 1000000                                           |
| Upgrade until quality | 1080p Efficient                                   |
| Tags                  | 1080p, Efficient Focused, Lossy Audio, h265, x265 |

**Notable CF scores (Radarr/Sonarr):** 3D (-999999); B&W (-999999); Extras (-999999); Full Disc (Quality Match) (-999999); Not Original or English (-999999); Sing Along (-999999); Upscale (-999999); 1080p Bluray HEVC Tier 1 (+720000); HONE Bluray (+720000); 1080p WEB-DL HEVC Tier 1 (+700000); HONE WEB (+700000); 1080p Efficient TV Bluray Tier 1 (+684000)

## 1080p Quality

1080p Quality utilizes the **Golden Popcorn Performance Index** to target **Transparent** x264 1080p Encodes.

- Average Movie Sizes ~ 10 to 15gb per Movie

- Movie Quality Ranking ~ 8/10

- Average TV Sizes ~ 4 to 8gb per Episode

- TV Quality Ranking ~ 8/10

| Setting               | Value                                           |
| --------------------- | ----------------------------------------------- |
| Minimum score         | 20000                                           |
| Upgrade until score   | 1000000                                         |
| Upgrade until quality | 1080p Quality                                   |
| Tags                  | 1080p, Lossy Audio, Quality Focused, h264, x264 |

**Notable CF scores (Radarr/Sonarr):** 3D (-999999); B&W (-999999); Extras (-999999); Full Disc (Quality Match) (-999999); Not Original or English (-999999); Release Group (Missing) (-999999); Sing Along (-999999); Upscale (-999999); 1080p WEB-DL (+640000); 1080p Bluray (+620000); 1080p WEBRip (+620000); 720p WEB-DL (+480000)

## 1080p Quality HDR

1080p Quality HDR utilizes the **Golden Popcorn Performance Index** to target **Transparent x265 HDR** 1080p Encodes.

- Average Movie Sizes ~ 10 to 20gb per Movie

- Movie Quality Ranking ~ 9/10

- Average TV Sizes ~ 4 to 10gb per Episode

- TV Quality Ranking ~ 9/10

| Setting               | Value                                                |
| --------------------- | ---------------------------------------------------- |
| Minimum score         | 20000                                                |
| Upgrade until score   | 1000000                                              |
| Upgrade until quality | 1080p Quality HDR                                    |
| Tags                  | 1080p, HDR, Lossy Audio, Quality Focused, x264, x265 |

**Notable CF scores (Radarr/Sonarr):** 3D (-999999); B&W (-999999); Extras (-999999); Full Disc (Quality Match) (-999999); Not Original or English (-999999); Release Group (Missing) (-999999); Sing Along (-999999); Upscale (-999999); UHD Bluray (+760000); x265 (Bluray) (-740000); 1080p WEB-DL (+640000); 1080p Bluray (+620000)

## 1080p Remux

1080p Remux utilizes **Audio Formats** to prioritise high quality Lossless HD Blurays with a fallback to Transparent Bluray Encodes.

- Average Movie Sizes ~ 20 to 30gb per Movie

- Movie Quality Ranking ~ 10/10

- Average TV Sizes ~ 6 to 12gb per Episode

- TV Quality Ranking ~ 10/10

| Setting               | Value                                                  |
| --------------------- | ------------------------------------------------------ |
| Minimum score         | 20000                                                  |
| Upgrade until score   | 1000000                                                |
| Upgrade until quality | 1080p Remux                                            |
| Tags                  | 1080p, Lossless Audio, Remux Focused, h264, x264, x265 |

**Notable CF scores (Radarr/Sonarr):** 3D (-999999); B&W (-999999); Extras (-999999); Full Disc (Quality Match) (-999999); Not Original or English (-999999); Release Group (Missing) (-999999); Sing Along (-999999); Upscale (-999999); 1080p WEBRip (+280000); 720p WEBRip (+180000); 1080p Balanced Tier 1 (+101000); 1080p Balanced Tier 2 (+100000)

## 2160p Balanced

2160p Balanced targets consistent & immutable 2160p **WEB-DLs w/ Lossy Audio**.

- Average Movie Sizes ~ 15 to 30gb per Movie

- Movie Quality Ranking ~ 8/10

- Average TV Sizes ~ 5 to 15gb per Episode

- TV Quality Ranking ~ 8/10

| Setting               | Value                                                 |
| --------------------- | ----------------------------------------------------- |
| Minimum score         | 20000                                                 |
| Upgrade until score   | 1000000                                               |
| Upgrade until quality | 2160p Balanced                                        |
| Tags                  | 2160p, Balanced Focused, HDR, Lossy Audio, h265, x264 |

**Notable CF scores (Radarr/Sonarr):** 3D (-999999); B&W (-999999); Extras (-999999); Full Disc (Quality Match) (-999999); Not Original or English (-999999); Release Group (Missing) (-999999); Sing Along (-999999); Upscale (-999999); 2160p Balanced Tier 1 (+844000); 2160p Balanced Tier 2 (+841000); 2160p Balanced Tier 3 (+840000); 2160p WEB-DL (+840000)

## 2160p Efficient

2160p Efficient targets consistent & immutable 2160p **WEB-DLs w/ Lossy Audio**. Specialized Fallback to 1080p Efficient

- Average Movie Sizes ~ 15 to 30gb per Movie

- Movie Quality Ranking ~ 6/10

- Average TV Sizes ~ 4 to 12gb per Episode

- TV Ranking ~ 6/10

| Setting               | Value                                             |
| --------------------- | ------------------------------------------------- |
| Minimum score         | 20000                                             |
| Upgrade until score   | 1000000                                           |
| Upgrade until quality | 2160p Efficient                                   |
| Tags                  | 2160p, Efficient Focused, Lossy Audio, h265, x265 |

**Notable CF scores (Radarr/Sonarr):** 3D (-999999); B&W (-999999); Extras (-999999); Full Disc (Quality Match) (-999999); Not Original or English (-999999); Sing Along (-999999); Upscale (-999999); 2160p Efficient TV Bluray Tier 1 (+780000); QxR Blurays (+780000); TAoE Blurays (+780000); 2160p Efficient TV WEB Tier 1 (+760000); QxR WEBs (+760000)

## 2160p Quality

2160p Quality utilizes the **Encode Efficiency Index** metric at a 60% target ratio to prioritize **Transparent** x265 4K Encodes

- Average Movie Sizes ~ 30 to 50gb per Movie

- Movie Quality Ranking ~ 9/10

- Average TV Sizes ~ 10 to 20gb per Episode

- TV Quality Ranking ~ 9/10

| Setting               | Value                                                   |
| --------------------- | ------------------------------------------------------- |
| Minimum score         | 20000                                                   |
| Upgrade until score   | 1000000                                                 |
| Upgrade until quality | 2160p Quality                                           |
| Tags                  | 2160p, HDR, Lossless Audio, Quality Focused, h265, x265 |

**Notable CF scores (Radarr/Sonarr):** 3D (-999999); B&W (-999999); Extras (-999999); Full Disc (Quality Match) (-999999); Not Original or English (-999999); Release Group (Missing) (-999999); Sing Along (-999999); Upscale (-999999); 2160p Quality Tier 1 (+865000); 2160p Quality Tier 2 (+864000); 2160p Quality Tier 3 (+863000); 2160p Quality Tier 4 (+862000)

## 2160p Remux

2160p Remux utilizes **Video / Audio Formats** to prioritise high quality lossless copies of UHD Blurays.

- Average Movie Sizes ~ 40 to 60gb per Movie

- Movie Quality Ranking ~ 10/10

- Average TV Sizes ~ 15 to 30gb per Episode

- TV Quality Ranking ~ 10/10

| Setting               | Value                                                 |
| --------------------- | ----------------------------------------------------- |
| Minimum score         | 20000                                                 |
| Upgrade until score   | 1000000                                               |
| Upgrade until quality | 2160p Remux                                           |
| Tags                  | 2160p, HDR, Lossless Audio, Remux Focused, h265, x265 |

**Notable CF scores (Radarr/Sonarr):** 3D (-999999); B&W (-999999); Extras (-999999); Full Disc (Quality Match) (-999999); Not Original or English (-999999); Release Group (Missing) (-999999); Sing Along (-999999); Upscale (-999999); 2160p Balanced Tier 1 (+464000); 2160p Balanced Tier 2 (+461000); 2160p Balanced Tier 3 (+460000); 1080p WEBRip (+280000)

## 720p Quality

720p Quality utilizes the **Golden Popcorn Performance Index** to target **Transparent** x264 720p Encodes.

- Average Movie Sizes ~ 4 to 8gb per Movie

- Movie Quality Ranking ~ 5/10

- Average TV Sizes ~ 2 to 4gb per Episode

- TV Quality Ranking ~ 5/10

| Setting               | Value                                          |
| --------------------- | ---------------------------------------------- |
| Minimum score         | 20000                                          |
| Upgrade until score   | 1000000                                        |
| Upgrade until quality | 720p Quality                                   |
| Tags                  | 720p, Lossy Audio, Quality Focused, h264, x264 |

**Notable CF scores (Radarr/Sonarr):** 3D (-999999); B&W (-999999); Extras (-999999); Full Disc (Quality Match) (-999999); Not Original or English (-999999); Release Group (Missing) (-999999); Sing Along (-999999); Upscale (-999999); 720p WEB-DL (+480000); 720p Bluray (+460000); 720p WEBRip (+460000); 1080p HDTV (+340000)

For Lidarr audio targets see [Lidarr](/database/lidarr/).
