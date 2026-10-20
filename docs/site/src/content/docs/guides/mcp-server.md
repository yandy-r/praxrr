---
title: MCP Server
description: Connect an AI assistant to Praxrr over the Model Context Protocol (read-only).
---

Praxrr exposes a **Model Context Protocol (MCP)** server so AI assistants and
automation tools can inspect your configuration and observability state using
natural-language workflows. It is **read-only**: it can query and preview, but it
never writes to your Arr instances or PCD databases.

## Endpoint

The MCP server is served over **Streamable HTTP** at:

```
https://<your-praxrr-host>/api/v1/mcp
```

It speaks JSON-RPC 2.0 and is stateless — each request is self-contained. The
endpoint is enabled by default; set `MCP_ENABLED=0` (or `false`/`no`/`off`) to
disable it.

## Authentication

The MCP endpoint uses Praxrr API tokens. There is **no** OAuth or
`Authorization: Bearer` support. Create a token in **Settings → Security** with
the `mcp` scope (or `admin`, which includes it), copy it when it is shown (it is
shown only once), and configure your client to send the header with the full
token value (it already starts with `prx_`):

```
X-Api-Key: <your token>
```

Notes:

- Tokens work under `AUTH=on` and `AUTH=oidc`, and for remote clients under
  `AUTH=local`.
- Under `AUTH=off`, or under `AUTH=local` from a local IP, the endpoint is
  reachable without a token (the deployment already trusts the caller/network).
- A token without the `mcp` scope gets **403**. A `read`-only token is not
  enough.
- Revoke the token in Settings → Security to cut off a client immediately.

## Connecting a client

Point any Streamable-HTTP MCP client at the endpoint and add the `X-Api-Key`
header. For clients that only speak stdio (for example some desktop assistants),
bridge with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```bash
npx mcp-remote https://<your-praxrr-host>/api/v1/mcp \
  --header "X-Api-Key: <your token>"
```

## What is exposed

- **Tools** — `list_instances`, `get_config_health`, `get_security_posture`,
  `get_drift_status`, `list_databases`, `list_resolved_entities`,
  `get_resolved_entity`, `search_sync_history`, and `preview_sync` (a write-free
  dry run).
- **Resources** — `praxrr://arr-instances`, `praxrr://drift/summary`,
  `praxrr://config-health`, `praxrr://security-posture`, `praxrr://databases`,
  plus templated resources for individual instances and resolved PCD entities.
- **Prompts** — ready-made templates for diagnosing drift, reviewing security
  posture, planning a sync, and explaining a PCD entity.

Credentials are always redacted: instance API keys are exposed only as a
fingerprint, and PCD git tokens are never returned. No write or apply operations
are available.
