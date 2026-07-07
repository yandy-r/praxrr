# PR Review #205 — feat(setup): first-run guided setup wizard

**Reviewed**: 2026-07-07
**Mode**: PR
**Author**: yandy-r
**Branch**: feat/setup-wizard → main
**Decision**: REQUEST CHANGES

## Summary

Strong, well-structured implementation that reuses existing primitives and closes most of the intended
security gaps (auth guard C1, git-URL-only C4, sanitized errors W1/W4, `redirect:'manual'`). Three
must-fix issues remain: an SSRF deny-list bypass via IPv4-mapped IPv6 literals (re-opens the metadata
block), a redirect loop that traps users who select zero profiles, and an unreachable "unauthorized"
connection-test reason. Plus DRY cleanups. Parallel review: correctness + security + quality reviewers.

## Findings

### CRITICAL

- **[F001]** `packages/praxrr-app/src/lib/server/utils/arr/urlSafety.ts:14,43-45` — `assertSafeArrUrl` SSRF bypass via IPv4-mapped / NAT64-mapped IPv6 literal.
  - **Status**: Open
  - **Category**: Security
  - `new URL('http://[::ffff:169.254.169.254]/').hostname` normalizes to `::ffff:a9fe:a9fe` (and `[64:ff9b::169.254.169.254]` → `64:ff9b::a9fe:a9fe`). Neither matches `METADATA_HOSTNAMES` (plain-decimal only), `isLinkLocalIPv4` (requires 4 dotted parts), nor `isLinkLocalIPv6` (`fe80:` prefix only) — so the cloud metadata address the module exists to block is reachable via `POST /api/v1/setup/test-connection` and `POST /arr/test`. Decimal/octal/hex/trailing-dot IPv4 forms are already normalized to dotted-decimal by the URL parser and remain caught; only the IPv6-embedded-IPv4 form escapes.
  - **Suggested fix**: Before the string checks, unwrap IPv4-mapped (`::ffff:x:y`) and NAT64 (`64:ff9b::x:y`) IPv6 hostnames to the embedded 32-bit IPv4 dotted-decimal and run `isLinkLocalIPv4`/`METADATA_HOSTNAMES` against that; better, normalize every hostname to its numeric IP form and compare numerically. Add unit cases for `[::ffff:169.254.169.254]` and `[64:ff9b::169.254.169.254]`.

- **[F002]** `packages/praxrr-app/src/routes/setup/preview-sync/+page.server.ts:27-30` — redirect loop traps users who select zero quality profiles.
  - **Status**: Open
  - **Category**: Correctness
  - `preview-sync`'s `load` unconditionally `throw redirect(303, '/setup/select-profiles')` when `getQualityProfilesSync(instance.id).selections.length === 0`. But `select-profiles` explicitly supports (and renders an empty state for) advancing with zero selections, then redirects forward to `preview-sync` — so a user on that supported path is bounced straight back with no explanation and can never proceed. Contradicts plan Task 5.3 ("allow zero selection") and Task 6.1.
  - **Suggested fix**: Remove the `selections.length === 0` bounce (or gate it on "never reached select-profiles" rather than saved-selection count) and render an explicit "no profiles selected — nothing to sync yet, you can finish setup" state in `preview-sync/+page.svelte` with a Finish action that marks completion.

### HIGH

- **[F003]** `packages/praxrr-app/src/lib/server/utils/arr/base.ts:68-91` + `routes/api/v1/setup/test-connection/+server.ts:77-83` + `routes/arr/test/+server.ts:62-68` — "key rejected" (`unauthorized`) reason is unreachable; every failure reports `unreachable`.
  - **Status**: Open
  - **Category**: Correctness
  - `getSystemStatus()` catches all errors (including 401/403) and returns `null` with no status preserved; both call sites map `!status → reason:'unreachable'`. The `toFailureReason()` helper only runs from the outer `catch`, which `getSystemStatus()` never throws into. So a reachable Arr with a wrong API key (a common first-run mistake) reports `unreachable`, and `connect-arr/+page.svelte`'s dedicated "API key was rejected" copy can never render. Plan Interaction Changes ("distinct unreachable vs key-rejected copy") unmet.
  - **Suggested fix**: Have `getSystemStatus()` return a discriminated result (`{ ok:true, appName, version } | { ok:false, status?:number }`) or let the `HttpError` propagate so both routes can map the status to `unauthorized`/`invalid_response`. Add a test that drives a 401 through the real mapping (the current "success" test patches `getSystemStatus` and bypasses it).

### MEDIUM

- **[F004]** `packages/praxrr-app/src/lib/server/utils/arr/urlSafety.ts:43-45` — `isLinkLocalIPv6` only matches the `fe80:` prefix, not the full `fe80::/10` range.
  - **Status**: Open
  - **Category**: Security
  - `fe90::1`, `fea0::1`, `febf:ffff::1` are valid link-local addresses that parse and are not caught.
  - **Suggested fix**: Match the top 10 bits — parse the first hextet and confirm `(firstHextet & 0xffc0) === 0xfe80` — instead of a fixed string prefix. Add cases to the SSRF test.

- **[F005]** `packages/praxrr-app/src/routes/setup/connect-arr/+page.svelte` + `routes/arr/components/InstanceForm.svelte:467,611` — "advance only on green test" (plan Task 5.1) not enforced; duplicate test-connection affordances.
  - **Status**: Open
  - **Category**: Completeness
  - The embedded `InstanceForm` has its own "Test connection" (→ `/arr/test`) and a Save button gated only by `canSubmit`, alongside the wizard's own inline test (→ `/api/v1/setup/test-connection`). A user can submit and advance without a green test, and two separate test controls hitting different endpoints are shown.
  - **Suggested fix**: Gate the wizard submit on `testStatus === 'success'` (or suppress InstanceForm's native test/submit in the embedded `mode="create"` case via a wizard-only prop), or explicitly drop the "advance only on green test" requirement from the plan/report if unenforced by design.

- **[F006]** `packages/praxrr-app/src/routes/setup/connect-arr/+page.server.ts:22-186` vs `routes/arr/new/+page.server.ts:15-178` — ~170-line near-verbatim duplication of the instance-create action.
  - **Status**: Open
  - **Category**: Maintainability
  - Field extraction, all validation branches, fingerprint dedup, encryption, tag parsing, insert, error handling are duplicated; only the `logger` source and the post-create redirect/step differ. No signal ties the two copies together.
  - **Suggested fix**: Extract `createArrInstanceFromForm(formData, { source }): Promise<{ ok:true; id:number } | { ok:false; failure }>` (e.g. `$lib/server/utils/arr/createInstanceAction.ts`) and have both actions call it, each handling only its own redirect/step side effect.

### LOW

- **[F007]** `packages/praxrr-app/src/lib/server/utils/rateLimit.ts` (used by `routes/api/v1/setup/test-connection/+server.ts:44-46`) — IP-keyed limit trusts spoofable proxy headers and the state map is pruned only lazily.
  - **Status**: Open
  - **Category**: Security
  - `getClientIp()` trusts the first client-supplied proxy header with no trusted-proxy allowlist, so an attacker hitting the instance directly can rotate `x-forwarded-for` to get a fresh bucket per request, defeating the throttle. Distinct spoofed keys also linger (no periodic sweep). Pre-existing infra, newly load-bearing here.
  - **Suggested fix**: Add a comment on the setup endpoint noting the limitation; optionally cap map size / sweep periodically, or only trust proxy headers when a `TRUSTED_PROXY_IPS`-style config is set (fall back to `event.getClientAddress()`).

- **[F008]** `packages/praxrr-app/src/routes/api/v1/setup/test-connection/+server.ts:12-26` vs `routes/arr/test/+server.ts:9-23` — `toFailureReason()` + reason-type union duplicated byte-for-byte.
  - **Status**: Open
  - **Category**: Maintainability
  - **Suggested fix**: Move the function and its reason-type union to a shared module (e.g. `$arr/testConnectionReason.ts`) and import from both routes.

- **[F009]** `hooks.server.ts:61-63` + `routes/setup/link-database/+page.server.ts:32-39` + `routes/api/v1/setup/state/+server.ts:24-27` — `PRAXRR_DEFAULT_DB_URL`/branch/name resolution duplicated three times.
  - **Status**: Open
  - **Category**: Maintainability
  - **Suggested fix**: Extract `resolveDefaultDatabaseConfig(): { url: string | null; branch: string; name: string; configured: boolean }` (e.g. `$lib/server/setup/defaultDatabase.ts`) and call it from all three (hooks keeps its extra token/identity reads alongside).

- **[F010]** `routes/setup/select-profiles/+page.server.ts:16-18` and `routes/setup/preview-sync/+page.server.ts:12-14` — `resolvePrimaryInstance()` duplicated verbatim.
  - **Status**: Open
  - **Category**: Maintainability
  - **Suggested fix**: Promote to a shared helper alongside the wizard server logic (e.g. `$lib/server/setup/`).

## Validation Results

| Check      | Result                                                            |
| ---------- | ----------------------------------------------------------------- |
| Type check | Pass (`deno task check` — 0 errors)                               |
| Lint       | Pass (`deno task lint`; docs markdownlint + yaml prettier clean)  |
| Tests      | Pass (`deno task test` → 1065 passed; `setup-wizard` → 23 passed) |
| Build      | Pass (CI `build` job green)                                       |

## Files Reviewed

Source: `hooks.server.ts`, `lib/server/setup/progress.ts`, `lib/server/db/queries/setupState.ts`, `lib/server/db/migrations/20260707_*.ts`, `migrations.ts`, `lib/server/utils/arr/{base,urlSafety}.ts`, `lib/server/utils/{http/client,rateLimit,validation/url}.ts`, `routes/api/v1/setup/{state,complete,skip,test-connection}/+server.ts`, `routes/arr/test/+server.ts`, `routes/+layout.svelte`, `routes/setup/**` (layout + 6 steps), `docs/api/v1/{openapi,paths/setup,schemas/setup}.yaml`, `scripts/test.ts`, `tests/base/setupProgress.test.ts`, `tests/routes/setupWizard.test.ts`, `tests/e2e/specs/5.1-setup-wizard-happy-path.spec.ts` (all Modified/Added).
