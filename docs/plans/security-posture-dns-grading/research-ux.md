# UX Research: Security Posture DNS-Aware Arr Transport Grading

## Executive Summary

DNS-aware grading should make the existing Arr transport row more informative
without making it look like a reachability test. The central UX distinction is:

> **Praxrr observed DNS address classes from its own resolver; it did not test
> whether the Arr service is reachable from the internet.**

The current Security Posture page already establishes useful patterns:
**Non-blocking** is visible next to the title, the introduction says the audit
informs and never blocks, unknown states are not called safe or failed,
recommendations have concrete fixes, and the transport table exposes only the
configured host rather than a full URL or API key. Issues #227/#248 and the
explicit-proxy-trust follow-up (#228/#249) strengthen that pattern by separating
verified assurances from hedged advisories and by using wording such as "observed,"
"could not be observed," and "cannot verify." DNS grading should extend those
semantics, not introduce a stronger-sounding "exposure detector."

Recommended presentation:

1. Keep one transport row per enabled Arr instance.
2. Separate **Connection** (`HTTP`/`HTTPS`) from **DNS evidence**
   (`Private only`, `Public address`, `Mixed scopes`, `Changed scopes`,
   `Unavailable`, or `Not applicable`).
3. Show a short evidence summary such as `2 private IPv4 · 1 public IPv6`, the
   evidence source, and when it was observed. Do not return or render the
   resolved address literals.
4. Use **Observed from Praxrr** and a timestamp/cache label to make
   split-horizon and time dependence explicit.
5. Treat timeout, failure, truncation, and expired evidence as **Unknown**,
   retain any last observation only as clearly stale context, and keep all Arr
   operations available.
6. For public, mixed, or scope-changing answers, say what DNS returned and
   recommend HTTPS/private routing or DNS review. Never say "publicly exposed,"
   "internet reachable," "attack detected," or "safe."

OWASP's SSRF guidance provides a useful conservative evidence model: resolve
both A and AAAA results and evaluate every returned address rather than trusting
one convenient answer
([OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)).
For classification language, IPv4 private, loopback, and link-local blocks are
standardized special-use ranges, while IPv6 unique-local and link-local
addresses are local-scope concepts
([RFC 5735](https://www.rfc-editor.org/info/rfc5735/),
[RFC 4193](https://www.rfc-editor.org/rfc/rfc4193.html),
[RFC 4291](https://www.rfc-editor.org/rfc/rfc4291.html)). These classifications
are evidence about an address, not evidence that a service accepts connections
on it.

## User Workflows

### Primary flow: Review all Arr transport findings

1. The user opens **Security Posture**.
2. The existing loading state says **Checking security posture…**. If DNS work
   is included in this request, add secondary text: **Resolving enabled Arr
   hostnames within a bounded time limit. No ports or services are being
   probed.**
3. The report renders even if some or every lookup failed. The page-level score
   and unrelated checks remain available.
4. Under **Arr connection transport**, each row shows:
   - instance name and Arr type;
   - connection scheme (`HTTP` or `HTTPS`);
   - configured target host, if the existing contract continues to expose it;
   - DNS evidence label;
   - compact class counts split by IPv4/IPv6;
   - source/freshness, for example `Live lookup · checked just now`,
     `Cached · checked 3 min ago`, `Configured IP · no DNS lookup`, or
     `Stale · last observed 24 min ago`; and
   - the existing instance-settings fix.
5. A public/mixed/changed row carries concise evidence immediately below the
   label. Example: **Observed from Praxrr: DNS returned 1 private IPv4 and 1
   public IPv4 address. This does not show whether the service is reachable from
   the internet.**
6. The recommendation offers a concrete next step: use HTTPS for the configured
   Arr URL, prefer a private/VPN target when that is the intended topology, or
   review split-horizon DNS records.
7. The user may continue syncing, testing, editing, or using the Arr instance
   regardless of the result.

### Refresh flow

1. The user selects **Refresh**.
2. Preserve the prior report instead of replacing the entire page with an empty
   loading panel.
3. Mark the report container `aria-busy="true"`, keep a visible **Refreshing DNS
   evidence…** status, and disable duplicate refresh requests.
4. Cache hits can return immediately but must still say **Cached** with their
   observation time.
5. When the latest request completes, announce one atomic result such as
   **Security posture refreshed: 4 Arr instances graded; DNS evidence
   unavailable for 1.** Do not announce every row independently.
6. If refresh fails at the route/report level, preserve the previous report with
   **Last successful report from {time}** and a Retry control. Do not silently
   present it as current.

WCAG 2.2 requires waiting, completion, result, and error status messages to be
programmatically determinable without moving focus. A polite `role="status"`
region fits loading and refresh completion; an urgent alert is unnecessary for a
non-blocking DNS timeout
([WCAG 2.2 status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages)).

### Inspect a public-only result

1. The row label is **Public-address DNS**, not **Publicly exposed**.
2. Evidence reads: **Observed from Praxrr at {time}: {N} public IPv4/IPv6
   address(es); no private, loopback, or link-local addresses in the bounded
   result set.**
3. A permanent qualifier follows: **DNS alone does not prove WAN reachability.**
4. For HTTP, the primary action is **Use HTTPS for this Arr connection**. A
   secondary detail may suggest using a private/VPN hostname if the instance is
   intended to remain local.
5. For HTTPS, do not imply there is no risk; report that transport is encrypted
   and keep public-address DNS as evidence/advisory rather than a reachability
   finding.

### Inspect split-horizon or mixed results

1. The row label is **Mixed address scopes**.
2. Evidence lists class counts, never the addresses: for example,
   `2 private IPv4 · 1 public IPv4`.
3. Copy says: **This may be intentional split-horizon DNS or a changing DNS
   answer. Praxrr cannot distinguish those causes from one bounded
   observation.**
4. Recommendation: **Verify the hostname's internal and external DNS records;
   keep HTTPS enabled while the answer can include a public address.**
5. Do not average the classes into a reassuring label. The presence of any
   public result remains visible.

### Inspect a scope-changing/rebinding-like result

1. Compare only observations retained by the defined cache/stability policy.
2. Use the user-facing label **Address scope changed**. Keep `rebinding-like` as
   an internal/test term; **DNS rebinding detected** overclaims intent and
   causality.
3. Show the transition at class level: **Previous observation: private only.
   Current observation: public + private.** Include both timestamps.
4. Recommendation: **Review the hostname's DNS configuration and use an HTTPS or
   stable private target.**
5. Explain that answers can legitimately vary by resolver, time, and network
   location. The finding is a reason to review, not proof of an attack.

### Inspect an unknown or failed result

1. The row stays present and uses **DNS unavailable** or **DNS evidence
   incomplete**, not a red failure state that implies the Arr connection failed.
2. Give a safe, categorized reason: **Timed out**, **No A or AAAA records**,
   **Resolver error**, or **Result limit reached**.
3. If no usable current evidence exists, the DNS portion is **Unknown / not
   evaluated**. Do not fall back to the old hostname heuristic and present it as
   DNS-confirmed.
4. If an older observation exists, show it below as **Last observed**, with its
   age and a **Stale** label; exclude it from any current DNS grade after the
   hard-expiry boundary.
5. Offer **Retry** or **Check DNS for this hostname** as guidance. Do not
   recommend editing unrelated Arr credentials or block connection tests/syncs.

## UI/UX Best Practices

### Evidence hierarchy

Use a three-level hierarchy inside the existing transport row:

1. **Assessment:** concise badge (`Private-only DNS`, `Mixed scopes`,
   `DNS unavailable`).
2. **Evidence:** class/family counts plus observation source and time.
3. **Interpretation/action:** plain-language limitation and concrete
   recommendation.

The evidence row should be structured data, not a paragraph assembled from raw
resolver output. A recommended row model is:

| Visible field    | Example                                                    | UX rule                                                                   |
| ---------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| Instance         | `Sonarr` + `sonarr` badge                                  | Preserve current instance-first orientation.                              |
| Connection       | `HTTP`                                                     | Keep scheme separate from DNS; neither substitutes for the other.         |
| Target           | configured hostname                                        | Never show the full URL, user info, path, query, or API key.              |
| DNS evidence     | `Mixed address scopes`                                     | Do not label this column `Exposure`.                                      |
| Observed classes | `2 private IPv4 · 1 public IPv6`                           | Counts only; no resolved address literals.                                |
| Source           | `Live lookup`, `Cached`, `Configured IP`, `Not applicable` | Make inference source explicit.                                           |
| Freshness        | `Checked 3 min ago`                                        | Use exact timestamp in accessible/title detail if relative time is shown. |
| Action           | `Review instance settings →`                               | Preserve one concrete fix; no disabled Arr operation.                     |

For a configured IP literal, use **Configured IP** as the source and classify it
without implying a DNS lookup occurred. For a hostname, use **DNS lookup**. If a
bounded result cap was hit, say **At least {displayed count} answers classified;
additional answers were not evaluated** and mark the DNS evidence incomplete.
Never phrase a truncated set as exhaustive.

### Language and certainty

Prefer:

- **Observed:** "DNS returned a public IPv6 address from Praxrr's resolver."
- **Scoped:** "Observed from Praxrr at 12:41 UTC."
- **Limited:** "No connection or WAN reachability test was performed."
- **Conservative:** "Mixed address scopes need review."
- **Actionable:** "Use HTTPS and verify internal/external DNS records."

Avoid:

- "This Arr instance is internet-accessible."
- "Your server is exposed."
- "DNS rebinding attack detected."
- "Private address = safe."
- "DNS passed/failed" without saying what was evaluated.
- "No public addresses exist" when the result set was capped, stale, timed out,
  or resolver-dependent.

The recent Shield Check work gives two direct precedents. Session transport
(#227/#248) says unobservable states are unknown and uses a verified assurance
only when Praxrr directly observes the relevant fact. Proxy trust (#228/#249)
uses an unscored advisory when Praxrr cannot know whether a reverse proxy
exists, and applies a scored finding only to an observable live-risk
configuration. DNS copy should follow the same evidence threshold.

### Privacy and safe evidence

- Continue to accept only an Arr connection URL as input; DNS resolution must
  never read or echo its API key.
- Parse the hostname, then discard username, password, path, query, fragment,
  and credential fields before forming evidence or logs.
- Do not include resolved IP literals in the API response, UI, recommendation
  text, telemetry, or ordinary logs. Address-family/class counts are sufficient
  for the acceptance criteria and reduce disclosure of internal topology.
- The configured hostname is already visible in the current authenticated
  dashboard. Show it once in the target column if needed, but do not repeat it
  in page-level alerts, top actions, or copied error strings.
- Never expose resolver/nameserver addresses, raw system error text, DNS packet
  content, or cache keys.
- Bound and sanitize class counts; do not let an unusually large answer create a
  huge DOM or verbose error.
- Keep exact addresses available only in server memory as needed for
  classification. If future support tooling needs them, design a separate
  explicitly requested, local-only diagnostic rather than widening this summary
  contract.

### Accessibility and responsive layout

- Keep text labels in every badge; color remains supplemental. The existing
  status mapping already follows this principle.
- Add a `<caption>` such as **Arr connection transport and DNS evidence** and
  `scope="col"` to headers. W3C recommends native tables with marked header/data
  relationships and captions so assistive technology can preserve context
  ([W3C Tables Tutorial](https://www.w3.org/WAI/tutorials/tables/)).
- Use the instance-name cell as a row header (`<th scope="row">`) if practical.
- Give the Refresh button an accessible busy name/state; the spinning icon is
  decorative, not the only signal.
- Use a polite live status for loading/completion. Reserve `role="alert"` for a
  report-level failure where no current report can be shown, not for each
  resolver timeout.
- Do not move focus when refreshed evidence arrives. Preserve keyboard position
  on Refresh.
- At narrow widths, prefer one stacked card per instance: instance → connection
  → DNS evidence → freshness → action. If the native table remains, keep its
  caption and headers and limit horizontal scrolling to the table container.
- Do not hide the WAN-reachability qualifier, stale marker, mixed-state warning,
  or fix behind **Show details**. Verbose mode may reveal policy details such as
  timeout/result cap/cache age.

## Error Handling states table

| State                              | Visible label and message                                                                   | Grade behavior                                                                  | Recovery/interaction                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Initial report load                | **Checking security posture… Resolving enabled Arr hostnames within a bounded time limit.** | No prior DNS grade shown.                                                       | Stable page shell; Refresh disabled; polite status.                           |
| Refresh with prior report          | **Refreshing DNS evidence…** plus prior `Checked {time}`                                    | Prior report remains visibly old until replaced.                                | `aria-busy`; no duplicate request; do not blank cards.                        |
| Fresh cache hit                    | **Cached · checked {age} ago**                                                              | Use according to cache policy.                                                  | No warning; exact observation time available.                                 |
| Cache expired, lookup running      | **Refreshing · last checked {age} ago**                                                     | Do not silently call expired evidence current.                                  | Preserve last observation as stale context only.                              |
| Timeout, no prior evidence         | **DNS unavailable — lookup exceeded the time limit.**                                       | DNS grade unknown/not evaluated; report still succeeds.                         | Retry; Arr operations remain enabled.                                         |
| Resolver failure                   | **DNS unavailable — the resolver could not return an answer.**                              | Unknown/not evaluated.                                                          | Retry; avoid raw OS/resolver error text.                                      |
| No A/AAAA records                  | **No IPv4 or IPv6 addresses were returned.**                                                | Unknown/not evaluated.                                                          | Check hostname/DNS; link instance settings.                                   |
| Result cap reached                 | **DNS evidence incomplete — the answer exceeded the result limit.**                         | Conservative/incomplete; never claim private-only based on a truncated set.     | Review DNS; optionally retry only if policy permits, not an unbounded lookup. |
| Private-only                       | **Private-only DNS** + class counts                                                         | Evidence supports local-scope classification from this resolver only.           | For HTTP, recommend HTTPS on untrusted/shared networks; no urgent error.      |
| Loopback-only                      | **Loopback-only DNS**                                                                       | Local-scope evidence; not proof the target process is the intended Arr service. | Usually no DNS action; retain scheme guidance.                                |
| Link-local-only                    | **Link-local DNS**                                                                          | Local-link evidence; avoid grouping invisibly under generic private.            | Explain same-link scope; recommend verifying intended host.                   |
| Public-only                        | **Public-address DNS** + qualifier                                                          | Conservative public-address finding; never WAN-reachable claim.                 | Use HTTPS/private route; review DNS.                                          |
| Mixed private/public               | **Mixed address scopes**                                                                    | Use the most cautious relevant presentation; do not average to private.         | Verify split-horizon/internal and external records; use HTTPS.                |
| IPv4/IPv6 differ                   | **Mixed address scopes** and family-specific counts                                         | Evaluate both families; no preferred-family shortcut in UI.                     | Review both A and AAAA records.                                               |
| Scope changed between observations | **Address scope changed** + previous/current class summary                                  | Rebinding-like/unstable evidence; do not say attack detected.                   | Review DNS and use HTTPS or stable private target.                            |
| Stale evidence + current failure   | **DNS unavailable · last observed {classes} at {time} (stale)**                             | Current DNS grade unknown; stale evidence excluded after hard expiry.           | Retry; keep stale context visually subordinate.                               |
| Invalid/unparseable configured URL | **Target could not be classified.**                                                         | Unknown/not evaluated.                                                          | Link directly to instance settings; never echo credentials/full URL.          |
| One instance fails, others succeed | Row-level **DNS unavailable** only                                                          | Other rows/checks remain valid.                                                 | No page-level failure; summary may say `1 of 4 unavailable`.                  |
| Whole summary request fails        | **Security posture could not be refreshed. Showing the report from {time}.**                | No new result.                                                                  | Retry; prior report remains explicitly historical.                            |

## Performance UX

### Bounded work should be visible but quiet

The user does not need a progress bar for a short bounded lookup. A stable
page-level loading/status line and one final result announcement are enough.
Per-instance spinners would create visual noise and a chatty screen-reader
experience unless the API streams rows independently.

The timeout and result cap are policy details, not failures the user can tune
from this page. Put exact values in verbose detail or documentation, while the
default message says **bounded time limit** or **result limit**. Do not invite
repeated refreshes to evade the cap.

### Cache and freshness semantics

- Every DNS evidence object needs an observation time and source (`live`,
  `cache`, `literal`, `none`).
- A cache hit must be labeled **Cached**, not presented as a new observation
  made when the page loaded.
- Relative age is easy to scan; retain the exact timestamp for unambiguous
  support evidence.
- Before soft expiry, cached evidence can be current under policy.
- During refresh after soft expiry, retain it with **Refreshing**.
- After hard expiry, a failed refresh leaves only **Last observed / stale**
  context and the active grade is unknown.
- A force-refresh control should not be added unless the backend has an explicit
  safe bypass policy. Repeated user clicks must not turn the feature into an
  unbounded resolver.
- Request IDs/stale-response guards, already used by the page, must continue to
  ensure an older refresh cannot replace newer evidence.

### Summary stability

DNS is time-dependent. Avoid making the overall shield score appear to oscillate
without explanation:

- show `Checked {time}` for the report and per-row DNS observation time where
  they differ;
- preserve a visible **Address scope changed** explanation when a class
  transition affects a finding;
- distinguish a cached answer from a newly resolved answer;
- never let timeout translate into a zero score; and
- if the scoring policy changes because evidence becomes unknown, state that the
  DNS portion was not evaluated rather than implying the deployment improved or
  worsened.

## Competitive/analogous patterns

### Existing Shield Check: evidence threshold before confidence

The strongest analogue is Praxrr's own recent work. Issue #227 distinguishes
direct observed HTTPS, proxy-reported termination, insecure transport, and
unknown context; only direct observation becomes a verified assurance. Issue

# 228 distinguishes an observable overly broad live bypass from a missing proxy

setting whose necessity cannot be observed. DNS grading should similarly reserve
strong claims for the address classes actually returned and use
advisories/unknown for topology and reachability conclusions.

### OWASP SSRF prevention: inspect all A and AAAA answers

OWASP recommends retrieving all addresses behind a domain, including A and AAAA,
and applying IP checks to each result to resist DNS pinning. Praxrr is not
enforcing an outbound-request allowlist here, but the presentation lesson
transfers: never show the result of one preferred address as if it represented
the whole hostname. Mixed-family and mixed-scope evidence must stay visible
([OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)).

### Route 53 health checks: a useful boundary contrast

Amazon Route 53 calls a target healthy only after dedicated health checkers send
HTTP/HTTPS/TCP requests and evaluate responses. That is a materially stronger
operation than resolving DNS
([Route 53 health-check behavior](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-failover-determining-health-of-endpoints.html)).
Praxrr deliberately performs none of those checks, so it should avoid Route 53's
**healthy/unhealthy** vocabulary. **DNS observed/unavailable/mixed** accurately
describes the weaker evidence.

### Chrome DevTools security details: summary plus inspectable evidence

Chrome DevTools separates a high-level security overview from origin and
connection/certificate details
([Chrome DevTools Security panel](https://developer.chrome.com/docs/devtools/security)).
Praxrr can use the same progressive-disclosure principle—assessment first, class
counts and timestamps second—while avoiding Chrome's connection-security
implication because Praxrr has not opened a connection for this check.

## Recommendations by priority

### Must have

- Rename the transport-table concept **Exposure** to **DNS evidence** or
  **Target evidence**. Public DNS is not proof of public exposure.
- Separate scheme, DNS class, observation source, and freshness in the response
  and UI.
- Cover and visibly distinguish private, loopback, link-local, public, mixed,
  scope-changing, unavailable, incomplete, and configured-literal states across
  IPv4 and IPv6.
- Render class/family counts only; never expose resolved IP literals, full URLs,
  credentials, raw resolver errors, or nameserver details.
- Put **Observed from Praxrr** and **DNS alone does not prove WAN reachability**
  beside every public/mixed/ changed result, not only in page documentation.
- Use **Address scope changed**, not **DNS rebinding detected**.
- Treat timeout/failure/truncation/expired evidence as unknown or incomplete,
  never as private/safe or a zero-score failure.
- Keep the report and every Arr operation available when DNS fails; no blocking
  control or alarming modal.
- Preserve existing #227/#228 semantics: verified facts become
  assurances/findings; unobservable topology and reachability remain hedged
  advisories.
- Label cache hits and stale evidence with observation time; exclude
  hard-expired evidence from the current DNS grade.
- Add accessible table caption/header scopes, `aria-busy`, and one polite
  refresh completion status.
- Test visible copy for the acceptance matrix: private-only, public-only,
  mixed/split-horizon, scope-changing, IPv4/IPv6 divergence, timeout, resolver
  failure, cap reached, cache hit, and stale cache.

### Should have

- Retain the previous report while refreshing and visibly label it as the last
  successful result.
- Add a compact page summary such as **4 targets: 2 private-only, 1 mixed, 1 DNS
  unavailable** without replacing row-level evidence.
- Use a stacked per-instance layout at narrow widths rather than forcing users
  to pan across a wider table.
- Put timeout, result-cap, cache TTL, and hard-expiry values in verbose detail
  so support users can explain a result without cluttering the default view.
- Keep the configured hostname in only one authenticated target cell and omit it
  from alerts/top-action text to reduce accidental screenshots/log disclosure.
- Add UI tests asserting that public/mixed copy never includes `reachable`,
  `exposed`, or `attack detected`, and that an API key/full URL/resolved address
  never appears.

### Nice to have

- Add a filter for **Needs review** when deployments have many instances.
- Provide a copyable, redacted support summary containing instance name/type,
  class counts, timestamps, cache state, and policy version—but no host or
  addresses.
- Show a small history of class-level transitions if repeated instability
  becomes a real support need; do not persist exact DNS answers for this
  purpose.
- Link the DNS policy version from verbose detail so future grading changes
  remain explainable.

## Open Questions

1. Does a current cached DNS observation contribute to the same score as a live
   lookup, and exactly where are soft- and hard-expiry boundaries? The UI needs
   those semantics to label current versus stale.
2. When the bounded result cap is reached, will the resolver know the answer was
   truncated? If yes, the UI must mark evidence incomplete; if no, the design
   must avoid an API that implies exhaustiveness.
3. Should any public DNS evidence affect an HTTPS row's score, or remain
   advisory while HTTPS continues to protect credentials in transit? The UI
   should show scheme and DNS evidence independently either way.
4. Is link-local intended to be its own visible class or grouped into
   local/private for scoring? It should remain visible in evidence even if
   scoring groups it.
5. What observation transition and time window qualifies as `rebinding-like`?
   The user-facing copy should stay **Address scope changed** regardless, but
   tests need a deterministic policy.
6. Will the summary endpoint resolve all enabled instances in parallel under one
   report deadline, or return partial results as each per-host deadline expires?
   Either is acceptable if one slow resolver cannot suppress successful rows.
7. Does the MCP `get_security_posture` surface receive the same DNS evidence? If
   so, it must preserve the same class-count-only redaction and freshness
   qualifiers; if no resolver context exists, it must report unknown rather than
   reuse a hostname heuristic as confirmed evidence.
8. Should the existing configured-host column remain visible by default? It is
   useful for disambiguation, but a redacted/optional target label would reduce
   internal-topology exposure in screenshots and support exports.
9. How will a Docker/service alias that fails DNS be distinguished from a
   genuinely invalid hostname? Existing heuristic labels must not masquerade as
   resolver evidence.
10. Should a report-level **Refresh** use fresh cache entries by design, or
    request policy-bounded revalidation? The control label and completion copy
    must match the actual cache behavior.
