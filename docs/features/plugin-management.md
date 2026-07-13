# Plugin Management

Praxrr exposes the plugin registry at **Apps → Plugins** (and still under **Settings → Plugins**).
The page is an operator console for validated metadata, durable enablement intent, discovery,
lifecycle evidence, declared extension points, and granted capabilities. It does not prove that a
plugin runtime is available or that a plugin has run successfully.

## Configure plugin discovery

Plugin management uses an in-app master switch plus an optional directory override:

- **Enable plugins** (UI checkbox on the Plugins page) defaults to off and persists in
  `general_settings.plugins_enabled`. Enabling/disabling applies immediately without restart.
- `PLUGINS_DIR` selects the directory scanned for plugins. It defaults to `${base}/plugins`, is not
  created automatically, and contains one plugin subdirectory per manifest.
- Each candidate subdirectory must contain `praxrr.plugin.json`. The host validates the complete
  scan before committing the new durable and in-memory registry state.
- Legacy `PLUGINS_ENABLED` is seed-only on upgrade and is no longer the operator-facing gate.

The Plugins destination remains visible when the ecosystem is off. In that state the page offers
**Enable plugins**; Praxrr does not scan `PLUGINS_DIR`, expose per-plugin mutation controls, or change
durable plugin state until the master switch is on.

## Read a plugin record

Expand a plugin card to inspect facts that are intentionally independent:

- **Identity** is the exact API version, plugin id, name, version, runtime declaration, and module
  entry returned by the redacted management API.
- **Discovery** means the plugin appeared in the latest successfully reconciled scan. It is not an
  installation or execution signal.
- **Saved enablement intent** controls whether a discovered plugin is eligible for future dispatch.
  It does not mean active, running, or healthy.
- **Lifecycle state** is the last recorded registry transition. `registeredAt` and `lastError` are
  registration/lifecycle evidence, not recent-run telemetry.
- **Declared extension points and grants** are explained from Praxrr's client-safe catalogs. A wired
  point describes host integration; it does not prove that the inert production executor ran code.

Current grants are limited to `read:resolved-profile`, `read:sync-preview`, `read:custom-format`, and
`read:config-validation`. They cannot represent credential, secret, network, filesystem,
environment, database, or write access.

Every card states **Execution telemetry unavailable in this build**. The management API has no
runtime-availability, recent-execution, result, duration, or last-run fields. Use no registry field
as a substitute for those missing signals.

## Enable or disable intent

Use **Enable plugin** or **Disable plugin** to persist administrator intent. Praxrr keeps the last
confirmed value visible while the request is pending and replaces the row only after the server
returns the complete updated record.

A record with **Missing from latest scan** remains inspectable. Its enable/disable action is saved
for when the same API-version-qualified identity is rediscovered. Removing a plugin directory does
not erase its prior intent.

## Reload the registry

**Reload plugins** runs the bounded scan and commits one reconciliation before refreshing the page's
authoritative list. The summary counters mean:

| Counter      | Meaning                                                                  |
| ------------ | ------------------------------------------------------------------------ |
| `discovered` | Manifest files found by the bounded directory scan                       |
| `registered` | Validated plugins published in the committed in-memory registry snapshot |
| `rejected`   | Invalid, malformed, duplicate, or otherwise rejected scan entries        |
| `missing`    | Existing durable records not rediscovered by this successful scan        |

`rejected` is aggregate-only. The page does not reveal rejected identities or invent rejection
reasons; consult server logs for redacted validation diagnostics.

Reload commit and list refresh are separate outcomes. If reconciliation commits but the follow-up
list request fails, the page retains the last confirmed rows, marks them stale, and reports that the
reload committed but refresh failed. Retry **Refresh registry** to load the authoritative view.

## Request security

All plugin management endpoints use Praxrr's existing API authentication. Browser enable, disable,
reload, and settings requests must be same-origin. Malformed, foreign, and explicit cross-site
requests are rejected before scanning or durable mutation with an empty `403` response.

Authenticated non-browser clients may omit the `Origin` header, so existing API-key automation
continues to work. This compatibility does not bypass authentication and does not enable CORS.

## Troubleshooting

- **Plugin ecosystem is off**: open Apps → Plugins (or Settings → Plugins) and select
  **Enable plugins**.
- **No plugins discovered**: verify `PLUGINS_DIR`, its permissions, and the expected
  `<plugin-directory>/praxrr.plugin.json` layout, then reload.
- **A plugin is missing**: restore its directory and reload. Its saved enablement intent will apply
  when the identity is rediscovered.
- **Rejected count is nonzero**: review server logs for redacted validation diagnostics. The UI
  intentionally provides no rejected identity list.
- **Rows are marked stale**: reconciliation or an earlier view may still be valid, but the latest
  list refresh failed. Retry the registry refresh.
- **No recent run appears**: this is expected. Runtime execution and structured execution telemetry
  remain unavailable in this build.

See [Plugin System Architecture](../architecture/plugins.md) for the contract, catalog, registry,
runtime-seam, and security boundaries.
