# Feature Guides

This section documents the main user workflows in Praxrr and links each workflow to the
relevant API behavior.

## Guides

- [Link, Bridge, Sync](./link-bridge-sync.md): connect a PCD, connect Arr apps, configure sync
  triggers, run sync, and clean up stale configs.
- [Local Overrides](./local-overrides.md): find local edits, inspect upstream differences, revert
  selected operations, and undo the latest database change.
- [Progressive Disclosure](./progressive-disclosure.md): show optional advanced settings only when
  you request them while keeping media-app setup pages clean.
- [Entity Testing](./entity-testing.md): build test entities/releases, evaluate custom format
  matches, and score against a selected quality profile.
- [Plugin Management](./plugin-management.md): discover validated plugins, inspect durable intent
  and lifecycle evidence, and reconcile the registry without inferring runtime health.
- [Portable Import/Export](./portable-import-export.md): move single entities or dependency-complete
  bundles between databases, with dry run, collision policies, and atomic apply.
- [TRaSH Guide Sync](./trash-guide-sync.md): import and sync TRaSH Guides community configurations
  from git repositories into Arr instances.

## Recommended reading order

1. [Link, Bridge, Sync](./link-bridge-sync.md)
2. [Local Overrides](./local-overrides.md)
3. [Progressive Disclosure](./progressive-disclosure.md)
4. [Entity Testing](./entity-testing.md)
5. [Plugin Management](./plugin-management.md)
6. [Portable Import/Export](./portable-import-export.md)
7. [TRaSH Guide Sync](./trash-guide-sync.md)

## Related documentation

- [API v1 OpenAPI](../api/v1/openapi.yaml)
- [Architecture Guide](../ARCHITECTURE.md)
- [Plugin System Architecture](../architecture/plugins.md)
- [Development Guide](../DEVELOPMENT.md)
- [Documentation strategy](../plans/documentation-strategy.md)
