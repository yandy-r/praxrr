  </a>
  <a href="https://www.buymeacoffee.com/yandyr">
    <img src="https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-blue?logo=buy-me-a-coffee" alt="Buy Me A Coffee">
  </a>
  <a href="https://github.com/sponsors/yandy-r">
    <img src="https://img.shields.io/badge/GitHub%20Sponsors-Support-blue?logo=github-sponsors" alt="GitHub Sponsors">
  </a>
</p>

## Praxrr Database

The [UnOfficial Praxrr Database](https://github.com/yandy-r/praxrr-db) serves as a
[Praxrr](https://github.com/yandy-r/praxrr) compliant database.

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
- [Praxrr Issues](https://github.com//praxrr/issues)
