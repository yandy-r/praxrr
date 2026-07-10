# External API Research: Security Posture DNS Grading

## Executive Summary

Praxrr can implement issue #229 without a new dependency. The repository is
pinned to Deno 2.5.6, whose stable `Deno.resolveDns()` API supports `A` and
`AAAA` lookups, accepts an `AbortSignal`, uses the system DNS configuration by
default, and requires `allow-net`. Praxrr's compiled runtime already has
`--allow-net`. The important limitation is that `Deno.resolveDns()` returns
address arrays, not DNS TTLs, so a bounded cache must use an explicit
application policy rather than pretending to honor the authoritative record TTL.

The safest integration is an async server-only resolver/cache that enriches the
existing `InstanceFact` inputs before the pure `$shared/security` scorer runs.
Only enabled Arr `http:` URLs whose host is currently `unknown` need DNS work.
Deduplicate normalized hostnames, query `A` and `AAAA` concurrently under one
deadline, coalesce in-flight requests, cap retained results and unique hosts,
and fail to typed `unknown` evidence. Never open a TCP connection, probe a port,
use an external public resolver, or block an Arr operation.

DNS is a resolver-local observation, not reachability proof. A public address
means only that the configured resolver returned a globally reachable address;
it does not prove that the Arr service is reachable from the WAN. A local-only
answer does not prove that public DNS has no different answer. Mixed
local/public results and a local/public class change across cache generations
should receive the same conservative public-risk transport grade, but the UI
should describe the latter only as "address classes changed between
observations" or "rebinding-like," never as a confirmed attack.

Recommended starting policy (product constants, not standards requirements):

| Policy                       | Starting value | Reason                                                                             |
| ---------------------------- | -------------: | ---------------------------------------------------------------------------------- |
| Total deadline per hostname  |       1,500 ms | One bounded budget shared by `A` and `AAAA`; shorter than interactive page latency |
| Concurrent hostname lookups  |              4 | Avoid resolver bursts while keeping a report responsive                            |
| Unique DNS hosts per report  |             32 | Bounds work for unusually large deployments; excess hosts remain `unknown`         |
| Retained addresses per host  |    16 combined | Bounds evidence and wire size; truncation is explicit                              |
| Positive cache lifetime      |           60 s | Collapses repeated UI/MCP reads without making the observation look durable        |
| Failure/empty cache lifetime |           15 s | Prevents retry storms while allowing quick recovery                                |
| Maximum cache entries        |            256 | Bounds process memory; evict expired, then oldest entries                          |

## Primary APIs with authoritative URLs

### Deno runtime

- [`Deno.resolveDns` API](https://docs.deno.com/api/deno/~/Deno.resolveDns) —
  stable `A`/`AAAA` overloads return `Promise<string[]>`; the API can use the
  system DNS configuration or an explicit name server and requires `allow-net`.
- [`Deno.ResolveDnsOptions`](https://docs.deno.com/api/deno/~/Deno.ResolveDnsOptions)
  — includes `nameServer` and `signal`. Aborting the signal stops the resolution
  operation and rejects with an `AbortError`.
- [Deno 2.5.6 type contract](https://github.com/denoland/deno/blob/v2.5.6/cli/tsc/dts/lib.deno.ns.d.ts#L4770-L4793)
  — confirms that the repository's pinned runtime version already has
  `ResolveDnsOptions.signal`; no Deno upgrade is required for cancellation.
- [Deno network permissions](https://docs.deno.com/runtime/reference/permissions/#network-access)
  — DNS resolution is denied without `--allow-net`; a denial can surface as
  `Deno.errors.NotCapable` and must become non-throwing
  `permission_denied`/`unknown` posture evidence.

Compatibility reality for this repository:

- `Dockerfile` and the GitHub workflows pin Deno `2.5.6`.
- The production `deno compile` tasks already grant `--allow-net`.
- `Deno.resolveDns()` has its own resolver timeout, but the public contract does
  not expose or promise its duration. Praxrr must enforce its own deadline with
  `AbortController`.
- The API exposes no TTL with an `A`/`AAAA` answer. RFC TTL-aware caching cannot
  be implemented from this return type; fixed positive and negative lifetimes
  must be documented as Praxrr policy.
- The API returns the complete array before application code can inspect it. A
  result cap therefore bounds retained/processed evidence and response size, but
  cannot limit the size of the DNS packet the runtime already received.

### DNS and address classification standards

- [IANA IPv4 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xhtml)
  — authoritative living registry for special-use IPv4 blocks and whether each
  block is globally reachable.
- [IANA IPv6 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xhtml)
  — authoritative living registry for IPv6 loopback, unspecified, mapped, ULA,
  link-local, documentation, translation, and other special blocks.
- [RFC 1918](https://datatracker.ietf.org/doc/html/rfc1918) — IPv4 private-use
  ranges: `10.0.0.0/8`, `172.16.0.0/12`, and `192.168.0.0/16`.
- [RFC 1122, section 3.2.1.3](https://datatracker.ietf.org/doc/html/rfc1122#section-3.2.1.3)
  — IPv4 `127.0.0.0/8` loopback semantics.
- [RFC 3927](https://datatracker.ietf.org/doc/html/rfc3927) — IPv4
  `169.254.0.0/16` link-local; such traffic must not be forwarded by routers.
- [RFC 4291](https://datatracker.ietf.org/doc/html/rfc4291) — IPv6 addressing
  architecture, including `::1/128` loopback, `::/128` unspecified, IPv4-mapped
  IPv6, and `fe80::/10` link-local.
- [RFC 4193](https://datatracker.ietf.org/doc/html/rfc4193) — IPv6 `fc00::/7`
  unique-local addresses.
- [RFC 6890](https://datatracker.ietf.org/doc/html/rfc6890) — structure and
  interpretation of the IANA special-purpose registries. It is the reason not to
  equate "not RFC1918" with "public."
- [RFC 3596](https://datatracker.ietf.org/doc/html/rfc3596) — IPv6 `AAAA` DNS
  records.
- [RFC 1035](https://datatracker.ietf.org/doc/html/rfc1035) and
  [RFC 2181, section 8](https://datatracker.ietf.org/doc/html/rfc2181#section-8)
  — DNS resource records carry TTLs, but Deno's string-array API does not return
  them.

The classifier should use exact bit-prefix tests, with this externally defined
taxonomy:

| Family | Class        | Required ranges/rule                                                                                                  |
| ------ | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| IPv4   | `loopback`   | `127.0.0.0/8`                                                                                                         |
| IPv4   | `private`    | RFC 1918 ranges only                                                                                                  |
| IPv4   | `link-local` | `169.254.0.0/16`                                                                                                      |
| IPv4   | `public`     | Valid globally reachable unicast after excluding every applicable IANA special-purpose, multicast, and reserved range |
| IPv6   | `loopback`   | `::1/128`                                                                                                             |
| IPv6   | `private`    | `fc00::/7` ULA                                                                                                        |
| IPv6   | `link-local` | `fe80::/10`                                                                                                           |
| IPv6   | `public`     | Valid globally reachable unicast after excluding every applicable IANA special-purpose, multicast, and reserved range |

Any syntactically valid address that is neither one of the named local classes
nor globally reachable unicast should be internal `special`/`unknown`, not
`public`. Examples include `0.0.0.0`, `::`, `100.64.0.0/10`, documentation
ranges, benchmarking ranges, multicast, and discard-only space. IPv4-mapped IPv6
must be normalized to IPv4 before classification so `::ffff:127.0.0.1` cannot
evade the IPv4 loopback rule.

## Libraries/SDKs

### Recommended: Deno built-ins only

Use `Deno.resolveDns`, `AbortController`, `URL`, `Map`, and the repository's own
pure IP/CIDR logic. This keeps the feature inside the pinned runtime contract
and makes timeout cancellation explicit.

The repository already has robust family-aware parsing and bitwise CIDR
containment in `$shared/security/trustedProxy.ts`. Its parsers are currently
private and its public API answers a different question (trusted-peer
containment), so the preferred code shape is to extract a small shared pure IP
parser/classifier and make both trusted-proxy and DNS grading consume it. Do not
copy the string-prefix shortcuts from `$server/utils/auth/network.ts` or
`classifyHost`: for example, `fe80::/10` is broader than addresses beginning
with the literal text `fe80`.

### Not recommended

- Do not use a public DNS-over-HTTPS service. It would bypass the deployment's
  split-horizon resolver, add outbound telemetry, and observe a different DNS
  view from the running Praxrr instance.
- Do not shell out to `dig`, `getent`, or `nslookup`; that adds `allow-run`,
  platform differences, and a second timeout/process-management problem.
- Do not add a DNS or IP npm package unless extraction of the existing tested
  bigint/u32 parser proves infeasible. The address rules needed here are small,
  deterministic, and already mostly represented in the repository.
- Do not manually chase CNAMEs. Query final `A` and `AAAA` records under the
  same bounded resolver policy; manual recursion expands work and creates
  loop/depth policy that issue #229 does not need.

## Integration Patterns

### 1. Preserve the pure engine boundary

Current repository flow is synchronous:

`gather.ts -> computeShield() -> computeShieldReport()`

The gatherer is the only config/DB-touching boundary, while
`$shared/security/checks.ts` is explicitly pure. Keep that architecture:

1. Gather enabled `InstanceFact` records exactly as today (`url`, never
   `external_url`; no API key).
2. Parse URLs and select only multi-label `http:` hostname candidates that the
   literal/suffix/single- label classifier cannot already grade. Skip `https:`
   because encryption already grades 100 and DNS cannot improve that transport
   conclusion.
3. Resolve unique normalized candidates through an injected async
   resolver/cache.
4. Attach a bounded, secret-free `DnsTransportObservation` to the corresponding
   pure instance fact.
5. Run the existing pure engine synchronously from those fully materialized
   facts.

This makes `buildPostureInputs()` and `computeShield()` asynchronous. The HTTP
summary handler is already `async`; change it to `await computeShield(event)`.
MCP resource/tool handlers already return promises, but their current
`Promise.resolve(toSecuritySummary(computeShield()))` order must become an async
mapping such as `async () => toSecuritySummary(await computeShield())`.

If DNS evidence is added to the API response, follow the repository's
contract-first rule: update the OpenAPI schema, regenerate
`packages/praxrr-app/src/lib/api/v1.d.ts`, then update runtime response types. A
scoring-rule change also requires a security-posture engine-version bump.

### 2. Use one cancellation deadline for both address families

The following is compatible with Deno 2.5.6 and makes the real cancellation
behavior explicit:

```ts
type AddressFamilyResult =
  | {
      readonly family: 'A' | 'AAAA';
      readonly status: 'ok';
      readonly addresses: readonly string[];
    }
  | {
      readonly family: 'A' | 'AAAA';
      readonly status: 'failed';
      readonly reason: string;
    };

async function resolveBoth(
  hostname: string,
  timeoutMs: number
): Promise<readonly AddressFamilyResult[]> {
  const controller = new AbortController();
  let deadlineExpired = false;
  const timer = setTimeout(() => {
    deadlineExpired = true;
    controller.abort();
  }, timeoutMs);

  const query = async (family: 'A' | 'AAAA'): Promise<AddressFamilyResult> => {
    try {
      const addresses = await Deno.resolveDns(hostname, family, {
        signal: controller.signal,
      });
      return { family, status: 'ok', addresses };
    } catch (error) {
      let reason = 'resolver_failure';
      if (deadlineExpired) reason = 'timeout';
      else if (error instanceof Deno.errors.NotCapable) {
        reason = 'permission_denied';
      }
      return { family, status: 'failed', reason };
    }
  };

  try {
    return await Promise.all([query('A'), query('AAAA')]);
  } finally {
    clearTimeout(timer);
  }
}
```

Use a single total deadline, not 1,500 ms per family. Preserve partial outcomes:
one family can succeed while the other fails. Never surface `error.message`, a
stack, or resolver details in the API; map to stable categories. An injected
`resolveDns` function and clock make timeout, error, cache, and class-change
tests deterministic and avoid live DNS in unit tests.

### 3. Bound work and cache observations

Normalize cache keys from `new URL(instance.url).hostname`: lowercase, remove a
single terminal dot, and rely on URL parsing for IDNA ASCII normalization. Keep
the system resolver; it is the relevant view for split-horizon deployments.

The cache should:

- deduplicate hostnames across instances;
- store one in-flight promise per key so simultaneous HTTP/MCP reads do not
  duplicate queries;
- keep `observedAt`, `expiresAt`, status, family completion, class counts,
  truncation, and a class-set fingerprint;
- use shorter expiry for empty/failed/timeout results;
- cap entries and evict expired entries before oldest entries;
- retain the prior successful class fingerprint long enough to flag a
  local/public boundary change;
- be in-memory only. A restart discards DNS history, which avoids turning
  transient network evidence into durable fact.

Because Deno does not return TTL, name the fields `cacheLifetimeMs`/`expiresAt`,
not `dnsTtl`. Cache state should never be interpreted as authoritative DNS
freshness.

### 4. Apply conservative grading rules

The pure scorer should distinguish observation completeness from address
classes:

| Observation                                                                             | Conservative transport interpretation for `http:`                                                  |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Loopback only, both families complete                                                   | `loopback`; existing 100/pass behavior                                                             |
| Private and/or link-local only, both families complete                                  | local-network plaintext; existing private 65/attention behavior                                    |
| Public only, both families complete                                                     | public-address plaintext; 30/action, with wording that DNS did not verify WAN reachability         |
| Any local + any public in one observation                                               | `mixed`; grade at least as public-address plaintext (30/action)                                    |
| Successive successful observations cross local/public classes                           | `changed`/rebinding-like; retain the conservative public-risk grade for the observation window     |
| A public result plus a failed/truncated family                                          | public-risk evidence remains sufficient for 30/action; mark incomplete                             |
| Only local results plus a failed/truncated family                                       | `unknown`/partial; do not claim local-only                                                         |
| Timeout, resolver failure, permission denial, empty result, host/report budget exceeded | `unknown`; non-blocking, no exception, no score improvement                                        |
| HTTPS URL                                                                               | `encrypted` as today; DNS result cannot prove or disprove WAN reachability and need not be queried |

For class changes, compare semantic class fingerprints rather than exact address
sets. Load balancing can legitimately rotate among public IPs, and DHCP can
rotate among private IPs; neither is rebinding-like. Only a boundary change
involving public versus loopback/private/link-local warrants the changed-state
warning. Even then, say that split-horizon DNS, resolver changes, or rebinding
could produce the observation.

### 5. Expose bounded, safe evidence

The wire/UI evidence needed to explain a grade is small:

- normalized configured hostname (already exposed today, never the full URL or
  userinfo);
- resolution status: `resolved`, `partial`, `timeout`, `failed`,
  `budget_exceeded`, or `not_applicable`;
- counts by `ipv4`/`ipv6` and
  `loopback`/`private`/`link_local`/`public`/`special`;
- `resultCount`, `truncated`, `observedAt`, and whether the answer came from
  Praxrr's cache;
- `addressClassesChanged: boolean` for the rebinding-like observation, without
  asserting intent.

Raw addresses are not required to justify the grade and reveal internal
topology, so class counts are the safer default. Never expose resolver exception
text, DNS server addresses, the full Arr URL, credentials, headers, or API keys.
Recommendation text should be limited to "use HTTPS or front the instance with
TLS" and, for incomplete DNS, "review local DNS"; no feature path should disable
an Arr instance or prevent sync/test/connection operations.

## Constraints/Gotchas

- **DNS is not a scanner and not reachability evidence.** No TCP/UDP application
  connection, port probe, HTTP request, or WAN-side vantage point is involved.
- **Split horizon is inherently viewpoint-specific.** A private-only answer from
  Praxrr's resolver cannot establish that no public resolver returns a public
  address. Phrase all evidence as observed.
- **The HTTP client's chosen address may differ.** A later connection can
  resolve again, use resolver cache state, and apply its own IPv4/IPv6
  selection. Do not claim the observed address was used.
- **A/AAAA are independently fallible.** Use both under one deadline and
  preserve partial status. Do not let a successful `A` hide a timed-out `AAAA`,
  or vice versa.
- **No TTL is available.** Fixed cache lifetimes are a load/UX policy. Do not
  label them DNS TTLs.
- **Cancellation is real but cooperative through the API.** Pass `signal`
  directly to `Deno.resolveDns`; merely racing the promise against a timer would
  return early while leaving the resolver operation running.
- **Result caps do not cap the DNS packet.** They cap processing/evidence after
  Deno returns. Mark a capped observation incomplete, because omitted addresses
  could belong to another class.
- **`not private` is not `public`.** IANA contains shared, documentation,
  benchmarking, unspecified, multicast, translation, and reserved blocks. These
  must fail to `special`/`unknown` unless the implementation explicitly
  classifies them.
- **Use real prefix math for IPv6.** Text checks such as `startsWith('fe80')` do
  not implement `fe80::/10`; the full range extends through `febf::`.
- **Normalize mapped forms.** Fold IPv4-mapped IPv6 to IPv4 before
  classification.
- **Zone identifiers are not portable DNS answers.** Reject `%eth0`-style scoped
  literals as invalid evidence rather than trying to compare them.
- **System resolver parity needs a manual check.** `Deno.resolveDns` documents
  use of the system DNS configuration, but the implementation should not assume
  identical behavior to every OS `getaddrinfo` path for hosts files, search
  suffixes, or mDNS. Single-label and `.local`/`.lan` hosts already have non-DNS
  classifications and should remain outside this feature's lookup path.
- **Cache and engine state must be test-isolated.** Provide a cache reset or
  construct a resolver per test; otherwise prior observations make result-order
  and rebinding tests flaky.
- **Service async conversion is cross-surface.** Update the HTTP route and both
  MCP call sites together.
- **Failure must remain informational.** Resolver failure must not 500 the
  posture report, block Arr operations, or silently improve a score.

## Code Examples

### Pure aggregation shape

```ts
type AddressClass =
  'loopback' | 'private' | 'link-local' | 'public' | 'special';

interface DnsTransportObservation {
  readonly status:
    'resolved' | 'partial' | 'timeout' | 'failed' | 'budget-exceeded';
  readonly counts: Readonly<Record<AddressClass, number>>;
  readonly ipv4Count: number;
  readonly ipv6Count: number;
  readonly complete: boolean;
  readonly truncated: boolean;
  readonly observedAt: string;
  readonly fromCache: boolean;
  readonly addressClassesChanged: boolean;
}

function observationTier(
  observation: DnsTransportObservation
): 'loopback' | 'private' | 'public' | 'mixed' | 'unknown' {
  const local =
    observation.counts.loopback +
    observation.counts.private +
    observation.counts['link-local'];
  const publicCount = observation.counts.public;

  if (observation.addressClassesChanged || (local > 0 && publicCount > 0)) {
    return 'mixed';
  }
  if (publicCount > 0) return 'public';
  if (
    !observation.complete ||
    observation.truncated ||
    observation.counts.special > 0
  )
    return 'unknown';
  if (observation.counts.private > 0 || observation.counts['link-local'] > 0) {
    return 'private';
  }
  if (observation.counts.loopback > 0) return 'loopback';
  return 'unknown';
}
```

This ordering deliberately preserves public-risk evidence from a partial answer
while refusing to call a partial local answer "private-only."

### In-flight cache coalescing

```ts
interface CacheEntry<T> {
  readonly promise: Promise<T>;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<DnsTransportObservation>>();

function cachedResolve(
  hostname: string,
  now: number
): Promise<DnsTransportObservation> {
  const cached = cache.get(hostname);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = resolveAndClassify(hostname).then((result) => {
    const lifetime = result.status === 'resolved' ? 60_000 : 15_000;
    const current = cache.get(hostname);
    if (current?.promise === promise) current.expiresAt = Date.now() + lifetime;
    return result;
  });

  cache.set(hostname, { promise, expiresAt: now + 15_000 });
  return promise;
}
```

Production code should inject the clock, enforce maximum entries, retain only a
bounded previous class fingerprint, and ensure a rejected internal promise is
converted to a resolved typed failure so callers never inherit an unhandled
rejection.

## Open Questions

1. Are the proposed 1,500 ms / 32-host / 16-result / 60 s / 15 s / 256-entry
   defaults acceptable for the expected largest Praxrr deployment, or should
   some be compile-time constants with lower caps?
2. Should `special` be a public wire class, or only an internal classifier
   result summarized as `unknown`? It should not be collapsed into `public`.
3. Should the UI expose a bounded raw-address list behind verbose mode? Class
   counts are sufficient for grading and leak less internal topology, so the
   default recommendation is no.
4. Should a public-to-local class change remain conservatively sticky for one
   positive cache lifetime or require two subsequent stable local observations
   before downgrading? One lifetime is the simpler initial policy.
5. Should a successful local `A` plus failed `AAAA` remain the existing 65
   attention score or become unscored `unknown`? The recommended policy retains
   65/attention but withholds the local-only claim; it must never improve to
   loopback/pass.
6. Is DNS evidence useful for HTTPS rows in verbose UI? It cannot improve the
   encryption conclusion, so skipping those lookups best satisfies the
   bounded-work requirement.
7. Does project deployment testing require explicit coverage for `/etc/hosts`,
   container DNS search suffixes, and mDNS behavior? These are runtime/platform
   characteristics and should be manual compatibility checks, not live-network
   unit tests.
