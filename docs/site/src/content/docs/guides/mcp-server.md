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

The MCP endpoint uses Praxrr's existing API-key auth — there is **no** OAuth or
`Authorization: Bearer` support. Configure your client to send the header:

```
X-Api-Key: <your Praxrr API key>
```

Find or regenerate the key under **Settings → Authentication**. This requires
`AUTH=on`. Notes:

- Under `AUTH=off` or `AUTH=local`, the endpoint is reachable without a key
  (the deployment already trusts the caller/network).
- Under `AUTH=oidc` there is no headless API-key path, so a non-browser MCP
  client cannot authenticate in that mode.

## Connecting a client

Point any Streamable-HTTP MCP client at the endpoint and add the `X-Api-Key`
header. For clients that only speak stdio (for example some desktop assistants),
bridge with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```bash
npx mcp-remote https://<your-praxrr-host>/api/v1/mcp \
  --header "X-Api-Key: <your key>"
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
