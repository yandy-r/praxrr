# Contributing to Praxrr

This file is intentionally lightweight. The full system encyclopedia lives in
`docs/ARCHITECTURE.md`.

## Quickstart

**Prereqs**

- Git
- Deno 2.x
- .NET SDK 8+ (optional, only for the parser service)

```bash
git clone https://github.com/yandy-r/praxrr.git
cd praxrr
deno task dev
```

## Conventions (short list)

- **Svelte 5, no runes.** Use `onclick`, no `$state` / `$derived`.
- **Alerts for feedback.** Use `alertStore.add(type, message)`.
- **Dirty tracking.** Use the dirty store to block saves + warn on navigation.
- **Routes > modals.** Only use modals for confirmations or rare one‑off forms.
- **API:** extend `/api/v1/*` only; legacy routes are migration targets.

## Useful docs

- `docs/ARCHITECTURE.md` — full codebase encyclopedia (modules, data flow, PCD)
- `docs/DEVELOPMENT.md` — release conventions

## Scripts

- `bash scripts/stats.sh` — per‑module code stats (TS/JS/Svelte/CSS/SQL/C#)

## PRs

Keep changes focused. Update docs when behavior changes.
