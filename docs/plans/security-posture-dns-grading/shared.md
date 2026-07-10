# DNS-Aware Arr Transport Grading

Issue #229 enriches the existing Shield Check `arr_transport` criterion for
unknown multi-label HTTP hosts with bounded DNS A/AAAA evidence. Server-only
asynchronous gathering resolves eligible stored Arr URLs through the system
resolver, while shared IP classification and security scoring remain pure and
deterministic. One process-wide resolver/cache/semaphore supplies the HTTP
summary, MCP resource, and MCP tool; the explicit response mapper carries only
class counts and closed metadata into the OpenAPI/UI contract. No DB, background
job, third-party dependency, reachability probe, or operational Arr path depends
on the result.

## Relevant Files

- packages/praxrr-app/src/lib/shared/security/types.ts: Versioned check,
  transport, input, and report contracts.
- packages/praxrr-app/src/lib/shared/security/checks.ts: Existing host
  classification and 100/65/30 transport grading.
- packages/praxrr-app/src/lib/shared/security/engine.ts: Pure rollup, transport
  rows, assurances, and advisories.
- packages/praxrr-app/src/lib/shared/security/trustedProxy.ts: Exact IPv4/IPv6
  bigint and CIDR parsing to extract.
- packages/praxrr-app/src/lib/shared/security/index.ts: Client-safe shared
  security exports.
- packages/praxrr-app/src/lib/server/security/gather.ts: Sole config/DB fact
  boundary; becomes async for DNS evidence.
- packages/praxrr-app/src/lib/server/security/service.ts: Thin
  gather-to-pure-engine orchestration seam.
- packages/praxrr-app/src/lib/server/security/responses.ts: Allowlisted
  internal-to-wire mapper and response types.
- packages/praxrr-app/src/routes/api/v1/security-posture/summary/+server.ts:
  Protected summary endpoint and no-store response.
- packages/praxrr-app/src/lib/server/mcp/resources.ts: Security posture MCP
  resource caller that must await the service.
- packages/praxrr-app/src/lib/server/mcp/tools.ts: Security posture MCP tool
  caller that must await the service.
- packages/praxrr-app/src/routes/security-posture/+page.svelte: Existing report
  refresh and transport evidence UI.
- docs/api/v1/schemas/security-posture.yaml: Source OpenAPI schemas for checks
  and transport rows.
- packages/praxrr-app/src/tests/shared/security/checks.test.ts: Pure scorer and
  host-classification matrix.
- packages/praxrr-app/src/tests/shared/security/engine.test.ts: Exact scores,
  caps, actionability, and version invariants.
- packages/praxrr-app/src/tests/shared/security/trustedProxy.test.ts: Parser
  extraction regression coverage.
- packages/praxrr-app/src/tests/routes/securityPosture.test.ts: Migrated-DB HTTP
  contract and secret-redaction tests.
- packages/praxrr-app/src/tests/mcp/mcp.test.ts: MCP resources/tools
  registration and output contract coverage.
- scripts/test.ts: `security-posture` focused test alias ownership.
- ROADMAP.md: Issue #229 delivery status under Ecosystem Security Posture.

## Relevant Patterns

**Pure engine with materialized I/O facts**: `$lib/server/security/gather.ts`
reads runtime state, then `$shared/security/engine.ts` evaluates deterministic
inputs without server imports.

**Explicit portable response mapper**: `$lib/server/security/responses.ts`
copies allowlisted fields into mutable wire DTOs instead of spreading internal
objects.

**Exact shared IP math**: `$shared/security/trustedProxy.ts` parses IPv4 as u32
and IPv6 as bigint; extract primitives without changing trusted-proxy token or
trust policy.

**Never-throwing bounded I/O shell**: `$lib/server/security/gather.ts` degrades
individual read failures to inert facts; DNS outcomes must follow the same
row-local failure behavior.

**Contract-first API**: edit `docs/api/v1/schemas/security-posture.yaml`, run
repo generation/bundle tasks, then keep generated/runtime types, HTTP, MCP, and
Svelte rendering in lockstep.

**Injected nondeterminism for tests**: follow dependency-object seams used by
server modules; inject resolver, clock, and timers so no automated test uses
live DNS or sleeps.

## Relevant Docs

**docs/plans/security-posture-dns-grading/feature-spec.md**: You _must_ read
this for the fixed scope, resource limits, grading matrix, evidence contract,
security boundaries, and acceptance mapping.

**docs/internal/security-posture-design.md**: You _must_ read this before
changing Shield Check's threat model, weights, band caps, or transport-language
discipline.

**docs/internal/227-session-hardening/design.md**: You _must_ read this for the
recent unknown-versus- verified evidence threshold and report-surface versioning
precedent.

**docs/internal/228-trusted-proxy/DESIGN.md**: You _must_ read this before
extracting IP parsing or describing rebinding-like evidence; preserve proxy
trust semantics exactly.

**docs/api/v1/schemas/security-posture.yaml**: You _must_ read this before
changing the portable DNS evidence shape or transport-tier enums.

**CLAUDE.md**: You _must_ read this for contract-first API, cross-Arr,
formatting, testing, and ROADMAP requirements.
