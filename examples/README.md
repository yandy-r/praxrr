# Praxrr examples

Runnable examples that accompany the Praxrr documentation.

## Plugins

| Example                                                             | Extension point                | Guide                                               |
| ------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------- |
| [`plugins/sync-preview-observer`](./plugins/sync-preview-observer/) | `sync.previewComputed.observe` | <https://docs.praxrr.dev/plugins/example-observer/> |

> **Note.** The WASM plugin system is a Phase-1 foundation: plugins are
> discovered, validated, and registered when plugins are enabled in the UI, but no
> WebAssembly executes yet (the Phase-2 runtime is deferred — see issue #262).
> These examples are buildable and installable; the "observed"/executed step is
> gated on that runtime. See the [Plugin SDK
> docs](https://docs.praxrr.dev/plugins/) for the full picture.
