---
title: Screenshots
description: How the README and docs-site screenshots are captured, framed, and regenerated.
---

The screenshots in the README and the [Feature Tour](/getting-started/tour/) are produced by
`scripts/screenshots.ts`. It drives a running Praxrr instance with Playwright, captures each view at
2x, and composites every capture into a branded window frame plus a hero collage.

- **Output:** `docs/site/src/assets/screenshots/*.png` — the single source used by both the README
  (repo-relative paths) and the docs site (Astro-optimized relative imports).
- **Raw captures:** `dist/screenshots/raw/` (git-ignored), reused by `--frame-only`.

## Prepare a demo instance

Screenshots should show real, synced data. Use a throwaway data directory and throwaway Arr
containers so nothing touches a real setup.

1. Start disposable Radarr, Sonarr, and Lidarr containers with known API keys (pre-seed each
   `config.xml` with an `ApiKey` and `AuthenticationMethod` of `External`), bound to `127.0.0.1`.
2. Add a root folder and a handful of titles to Radarr and Sonarr through their APIs. For a populated
   library view, create sparse files in the movie folders (`truncate -s 4G <path>/<release>.mkv`)
   and run a `RescanMovie` command.
3. Start Praxrr with an isolated `APP_BASE_PATH`, `AUTH=off`, a throwaway
   `ARR_CREDENTIAL_MASTER_KEY` (32 random bytes, base64), and the instances declared through
   `RADARR_INSTANCE_*`, `SONARR_INSTANCE_*`, and `LIDARR_INSTANCE_*` environment variables (see
   [Connecting Arr Instances](/guides/connecting-arr-instances/)). Leave `PRAXRR_DEFAULT_DB_URL` unset
   so the default Praxrr-DB is linked from GitHub. Run the parser too so the score simulator works.
4. Skip the setup wizard, then on each instance's **Sync** tab select a delay profile, media
   management configs, and a few quality profiles, save, and run **Sync Now**. Assign the synced
   profiles to the sample titles in Radarr so the library view shows scores.

## Capture and frame

```bash
deno task screenshots --base-url http://localhost:6969
```

| Flag                                                                 | Default                            | Purpose                                                     |
| -------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------- |
| `--base-url`                                                         | `http://localhost:6969`            | Praxrr instance to capture                                  |
| `--out`                                                              | `docs/site/src/assets/screenshots` | Framed output directory                                     |
| `--raw`                                                              | `dist/screenshots/raw`             | Raw capture directory                                       |
| `--only`                                                             | all                                | Comma-separated shot names (for example `arr-library,hero`) |
| `--frame-only`                                                       | off                                | Re-frame existing raw captures without a running server     |
| `--chrome`                                                           | Playwright Chromium                | Browser executable (`PLAYWRIGHT_CHROMIUM_EXECUTABLE`)       |
| `--database-id`, `--radarr-id`, `--profile-id`, `--custom-format-id` | `1`, `1`, `4`, `10`                | Entity ids used in captured routes                          |

The hero collage is composed from the `quality-profiles`, `score-simulator`, and `sync-history` raw
captures, so capture those before framing `hero` on its own.

## Guidelines

- Capture in dark mode at the default 1536×960 viewport so every frame matches.
- Never capture real hostnames, API keys, or personal paths; the frame's address bar always shows
  `praxrr.local`.
- Keep the committed set small (about 350 KB per image). Regenerate the whole set after visible UI
  changes rather than mixing old and new captures.
