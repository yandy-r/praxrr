# Development

## Navigation

- [Project README](../README.md) - product overview and setup.
- [Contributing Guide](CONTRIBUTING.md) - local contributor quickstart and daily commands.
- [Architecture Guide](ARCHITECTURE.md) - system modules and runtime data flow.
- [OpenAPI Source](api/v1/openapi.yaml) - canonical `/api/v1` API contract.

## Setup

- Use the local setup in [docs/CONTRIBUTING.md](CONTRIBUTING.md).
- Default workflow targets the `main` branch plus short-lived feature branches.

## Usage

- Use the commands in this guide for branching, tagging, and releases.
- Use `deno task dev`, `deno task lint`, `deno task check`, and `deno task test` during feature
  development before release tagging.

## Branching Strategy

Praxrr uses **GitHub Flow** with **Release Channels**.

- All development happens on `main`
- Feature branches for isolated work
- Tags trigger Docker image builds

## Release Channels

| Channel | Docker Tag | Trigger             | Stability |
| ------- | ---------- | ------------------- | --------- |
| Develop | `:develop` | Every push to main  | Unstable  |
| Beta    | `:beta`    | `v*-beta.*` tag     | Testing   |
| Stable  | `:latest`  | `v*` tag (no -beta) | Stable    |

Version-specific tags (`:v2.1.0`) are also created for pinning.

## Development Workflow

### Daily Work

```bash
git add .
git commit -m "feat: description"
git push
```

Pushes to `main` automatically build the `:develop` image.

### Feature Branches

For larger features, use a branch:

```bash
git checkout -b feature/name
# work...
git checkout main
git merge feature/name
git branch -d feature/name
```

## Release Process

### 1. Beta Release

```bash
git tag v2.1.0-beta.1
git push --tags
```

### 2. Beta Fixes

```bash
git commit -m "fix: issue from beta"
git push
git tag v2.1.0-beta.2
git push --tags
```

### 3. Stable Release

After minimum 1 week in beta with no major issues:

```bash
git tag v2.1.0
git push --tags
```

## Release Timing

**Stable Releases**: Wednesday

- Beta releases can be tagged any day. Must be in beta for at least a week
  before tagged as stable

## Versioning

[Semantic Versioning](https://semver.org/):

```
v2.1.0-beta.1
│ │ │    └──── Pre-release identifier
│ │ └───────── Patch (bug fixes)
│ └─────────── Minor (new features, backwards compatible)
└───────────── Major (breaking changes)
```

| Change          | Bump                |
| --------------- | ------------------- |
| Bug fix         | `v2.1.0` → `v2.1.1` |
| New feature     | `v2.1.0` → `v2.2.0` |
| Breaking change | `v2.1.0` → `v3.0.0` |

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: resolve bug
docs: update documentation
refactor: restructure code
chore: maintenance tasks
```

## Hotfixes

For critical bugs in stable:

```bash
git commit -m "fix: critical issue"
git push
git tag v2.1.1
git push --tags
```
