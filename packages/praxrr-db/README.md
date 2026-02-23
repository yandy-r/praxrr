## Praxrr Database

The UnOfficial Praxrr Database is maintained in the monorepo at `praxrr/packages/praxrr-db` and serves as a
[Praxrr](https://github.com/yandy-r/praxrr) compliant database.

## YAML-first data source

`entities/` is the canonical source for default PCD data at startup. SQL files in `ops/` are retained
as transitional artifacts during rollout and compatibility fallback windows.

## Distribution-only repository

This is a distribution mirror of the main Praxrr monorepo:
[`https://github.com/yandy-r/praxrr`](https://github.com/yandy-r/praxrr).

Source-of-truth locations for this package:

- Package source: `praxrr/packages/praxrr-db`
- Mirror publish workflow: `praxrr/.github/workflows/publish-db.yml`

Do not edit this repository directly. Changes must be made in the monorepo and are published automatically
via the workflow above using `git subtree split`.

## Lidarr Support Scope

Lidarr v1 support in this database covers additive, arr-scoped seeding for:

- quality profiles
- custom formats
- custom format conditions
- quality profile to custom format score mappings
- quality definitions/mappings required by selected Lidarr profiles

Validation evidence for the current v1 seed set (`ops/50`-`ops/54`) shows replay-safe inserts with
minimum dataset checks passing. See the
[Lidarr Compatibility Matrix](docs/plans/lidarr-support/lidarr-compatibility-matrix.md).

## Compatibility Gate

Lidarr publication is compatibility-gated and requires `praxrr >= 2.1.0`. Release remains blocked if
`lidarr` metadata and the minimum version gate are not present in the published manifest, or if
minimum dataset/idempotency checks fail.

## Known Limitations

The following capabilities are explicitly out of scope for Lidarr v1:

- metadata profile seeding
- release profile seeding
- SignalR/event-stream integration
- automatic OpenAPI client generation pipeline
- non-essential schema redesign beyond the shared-table path

## Support

- [Database Issues](https://github.com/yandy-r/praxrr-db/issues)
- [Praxrr Issues](https://github.com/yandy-r/praxrr/issues)
