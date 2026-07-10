---
title: Security Posture DNS Grading Implementation Report
date: 07/10/2026
original-plan: docs/plans/security-posture-dns-grading/parallel-plan.md
---

## Overview

Implemented bounded, DNS-aware grading for enabled Arr instances whose stored connection URL is
plaintext HTTP with an otherwise unknown multi-label hostname. The server gathers only redacted
A/AAAA address-class counts through one process-wide resolver, while the pure engine applies a
conservative grading matrix and HTTP, MCP, OpenAPI, and UI consumers share the same closed contract.
DNS evidence remains report-only: it never probes a service, proves WAN reachability, or enters an
Arr operation path.

## Files Changed

### Created

- `docs/plans/security-posture-dns-grading/analysis-code.md`: Codebase analysis for the implementation plan.
- `docs/plans/security-posture-dns-grading/analysis-context.md`: Verified implementation context and constraints.
- `docs/plans/security-posture-dns-grading/analysis-tasks.md`: Dependency and batching analysis.
- `docs/plans/security-posture-dns-grading/feature-spec.md`: Consolidated product and technical specification.
- `docs/plans/security-posture-dns-grading/parallel-plan.md`: Validated 15-task implementation plan.
- `docs/plans/security-posture-dns-grading/research-business.md`: Product-value and scope research.
- `docs/plans/security-posture-dns-grading/research-external.md`: Deno DNS and IANA source research.
- `docs/plans/security-posture-dns-grading/research-practices.md`: Testing and operational-practice research.
- `docs/plans/security-posture-dns-grading/research-recommendations.md`: Consolidated implementation recommendations.
- `docs/plans/security-posture-dns-grading/research-security.md`: Threat model and disclosure-boundary research.
- `docs/plans/security-posture-dns-grading/research-technical.md`: Resolver, cache, and contract design.
- `docs/plans/security-posture-dns-grading/research-ux.md`: Accessible evidence-presentation research.
- `docs/plans/security-posture-dns-grading/shared.md`: Shared architecture, pattern, and integration context.
- `packages/praxrr-app/src/lib/server/security/dnsTransport.ts`: Bounded resolver, cache, coalescing, and test seam.
- `packages/praxrr-app/src/lib/shared/security/ip.ts`: Pure IPv4/IPv6 parser, CIDR utilities, and classifier.
- `packages/praxrr-app/src/tests/server/security/dnsTransport.test.ts`: Deterministic resolver-boundary tests.
- `packages/praxrr-app/src/tests/server/security/gatherDnsTransport.test.ts`: DB-to-engine DNS gathering tests.
- `packages/praxrr-app/src/tests/shared/security/ip.test.ts`: Address and CIDR boundary tests.

### Modified

- `ROADMAP.md`: Records issue #229 delivery, exact limits, non-blocking semantics, and coverage.
- `docs/api/v1/schemas/security-posture.yaml`: Adds closed DNS evidence schemas and the mixed tier.
- `packages/praxrr-api/openapi.json`: Regenerated bundled OpenAPI contract.
- `packages/praxrr-api/types.ts`: Regenerated portable API types.
- `packages/praxrr-app/src/lib/api/v1.d.ts`: Regenerated application API types.
- `packages/praxrr-app/src/lib/client/ui/security/shieldStatus.ts`: Adds typed DNS labels and variants.
- `packages/praxrr-app/src/lib/server/mcp/resources.ts`: Awaits the shared asynchronous posture service.
- `packages/praxrr-app/src/lib/server/mcp/tools.ts`: Awaits the shared asynchronous posture service.
- `packages/praxrr-app/src/lib/server/security/gather.ts`: Selects, resolves, and projects bounded DNS evidence.
- `packages/praxrr-app/src/lib/server/security/responses.ts`: Explicitly maps the safe DNS wire shape.
- `packages/praxrr-app/src/lib/server/security/service.ts`: Makes posture computation asynchronous.
- `packages/praxrr-app/src/lib/shared/security/checks.ts`: Applies the conservative DNS grading matrix.
- `packages/praxrr-app/src/lib/shared/security/index.ts`: Exports shared IP primitives.
- `packages/praxrr-app/src/lib/shared/security/trustedProxy.ts`: Reuses the extracted IP/CIDR mechanics.
- `packages/praxrr-app/src/lib/shared/security/types.ts`: Adds DNS contracts and bumps engine version to 4.
- `packages/praxrr-app/src/routes/api/v1/security-posture/summary/+server.ts`: Awaits reports and sends `no-store`.
- `packages/praxrr-app/src/routes/security-posture/+page.svelte`: Renders accessible evidence and bounded table scrolling.
- `packages/praxrr-app/src/tests/mcp/mcp.test.ts`: Proves MCP parity, caching, degradation, and redaction.
- `packages/praxrr-app/src/tests/routes/securityPosture.test.ts`: Proves the HTTP DNS contract and redaction.
- `packages/praxrr-app/src/tests/shared/security/checks.test.ts`: Pins URL-first and DNS grading outcomes.
- `packages/praxrr-app/src/tests/shared/security/engine.test.ts`: Pins rollup, cap, order, and version invariants.
- `packages/praxrr-app/src/tests/shared/security/trustedProxy.test.ts`: Expands extracted-parser parity coverage.

## New Features

**Pure IP policy**: Classifies IPv4 and IPv6 literals as loopback, private, link-local, public, or
special using reviewed prefix tables, with malformed and unfamiliar values failing closed.

**Bounded DNS observations**: Resolves A and AAAA through the system resolver with a 1,500 ms host
timeout, four-host process concurrency, 16 retained unique answers, 32 report candidates, and a
2,000 ms report deadline that includes queue time.

**Shared caching and change evidence**: Coalesces identical in-flight hosts before the semaphore and
uses a 256-entry LRU with 60-second positive and 15-second negative lifetimes while preserving the
original observation time and bounded public/non-public transition history.

**Conservative transport grading**: Complete local-only DNS evidence scores 65/attention; public,
mixed, or public-boundary-change evidence scores 30/action and caps the shield at guarded; incomplete
local, failure, timeout, empty, special, truncation, and budget states remain unknown at 65.

**Portable redacted contract**: HTTP and MCP expose only closed outcomes, provenance, class counts,
retained count, observation time, and completeness/change flags. Raw addresses, resolver errors,
nameservers, CNAMEs, paths, queries, full URLs, and credentials never cross the mapper.

**Accessible evidence UI**: Displays outcome/source labels, A/AAAA class counts, freshness,
incomplete/truncated/change markers, and visible resolver-vantage/no-WAN-proof language. Refreshes
retain prior content and focus, use one polite live status, and keep wide evidence within a local
horizontal scroller without expanding a 390 px document.

## Additional Notes

- No dependency, database migration, environment variable, background job, or active probe was added.
- Production imports of `dnsTransport.ts` stop at `security/gather.ts`; Arr clients, sync, jobs,
  startup, save, URL safety, authorization, and connection tests have no dependency on DNS grading.
- Every `computeShield` and `buildPostureInputs` caller now awaits the asynchronous boundary.
- Two complete generation sequences produced identical hashes before final mechanical TypeScript
  formatting; the generated diff is limited to DNS evidence and the mixed transport tier.
- `deno task check` passed with zero Svelte errors/warnings, `deno task test` passed 2,119 tests (37
  steps), and `deno task build` completed successfully after the narrow-layout fix.
- Focused gates passed: security-posture 171/171, MCP 47/47, resolver 16/16, and combined IP/check/
  trusted-proxy/resolver tests 69/69.
- Resolver cases explicitly passing include A+AAAA aggregation, partial-family public evidence, shared
  timeout/abort, in-flight coalescing, four-host concurrency, queue deadline, deduplication and the
  16-answer cap, positive/negative cache boundaries, 256-entry LRU eviction, public-boundary changes,
  history across expiry/failure, malformed/permission failures, reset, and override restoration.
- UI inspection at 1,440 px and 390 px verified visible qualifiers, native table semantics, retained
  content, and local evidence-table scrolling. The final 390 px audit measured document width 390,
  page `scrollX=0`, and an independently scrollable 356/627 px evidence container.
- Known repository baseline gates remain outside this change: `deno fmt --check` reports 1,447
  existing files because the repository uses Prettier; `deno task lint` stops at 44 unrelated
  Prettier warnings after every issue-229 file passes scoped Prettier and ESLint; and
  `deno task check:dist-paths` finds a stale sibling `/home/yandy/Projects/github.com/yandy-r/dist`
  dated 2026-02-19. The meaningful whitespace check passes with trailing-space/space-before-tab
  rules; the user-global `indent-with-non-tab` rule flags valid Prettier JSON/Svelte indentation.

## E2E Tests To Perform

### Test 1: Local-only and non-candidate connections

**Steps:**

1. Configure HTTPS, loopback, single-label container, private IP, and recognized local-suffix Arr URLs.
2. Open `/security-posture` and refresh the report.
3. Inspect the transport table and HTTP/MCP summaries.

**Expected Result:**
Established URL-first grades remain unchanged and DNS is labeled not needed with no resolver evidence.

**Edge Cases:**

- Include IPv4 and IPv6 literals at private, loopback, and link-local boundaries.
- Set a conflicting `external_url`; grading must continue to use the stored connection `url`.

### Test 2: Public, mixed, and changing DNS evidence

**Steps:**

1. Use a controlled resolver for an eligible HTTP hostname with public-only answers.
2. Repeat with local plus public answers, then change the same hostname across the public boundary.
3. Request the HTTP report, MCP tool, and MCP resource and inspect the UI.

**Expected Result:**
Rows are public or mixed at 30/action, the shield is capped at guarded, source/freshness/class counts
match across surfaces, and changed evidence is visibly labeled without claiming WAN reachability.

**Edge Cases:**

- Fail one record family while the other returns public evidence; public remains actionable.
- Confirm cache hits preserve `observedAt` and switch only the source from fresh to cache.

### Test 3: Failure and resource limits

**Steps:**

1. Exercise resolver timeout, rejection, empty answers, malformed/special answers, truncation, 33+
   candidate hosts, and more than four concurrent unique hosts through the injected resolver tests.
2. Request reports during each degraded state.
3. Search serialized HTTP/MCP output for planted addresses, error text, URLs, and credentials.

**Expected Result:**
Every request returns a valid report, degradation is row-local, advertised limits hold, Arr operations
remain unaffected, and no raw resolver or secret material is disclosed.

**Edge Cases:**

- Queue time must count toward the 2,000 ms report deadline.
- Identical concurrent hostname requests must coalesce before consuming a global slot.

### Test 4: Desktop and narrow interaction

**Steps:**

1. Open `/security-posture` at desktop width and at a 390 px viewport.
2. Activate Refresh with keyboard focus and observe the loading state.
3. Scroll the DNS table horizontally on the narrow viewport.

**Expected Result:**
Prior content stays visible while busy, focus remains stable, one polite status announces progress,
the table remains locally scrollable, and the document has no horizontal scroll.

**Edge Cases:**

- Verify incomplete, truncated, cached, and address-scope-changed labels without relying on color or hover.
- Verify caption, scoped headers, and the visually hidden action-column label with assistive technology.
