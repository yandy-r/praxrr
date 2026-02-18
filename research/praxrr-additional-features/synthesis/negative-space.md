# Negative Space Analysis: Praxrr Feature Strategy

## Executive Summary

Across all eight persona findings and two synthesis documents, the most critical gaps are not about which features to build but about who Praxrr is actually building for, whether the upstream APIs it depends on will remain stable enough to support its ambitions, and whether a small team can maintain the scope being discussed. The research assumes a power-user audience of indeterminate size, treats upstream \*Arr API stability as a manageable risk without empirical data on breakage frequency, and proposes feature lists that would strain a team ten times the current size. Until Praxrr answers three foundational questions -- "How many people actually need this?", "How reliably can we talk to upstream APIs?", and "What can our team realistically maintain for 3+ years?" -- every feature prioritization is built on unvalidated assumptions.

---

## Critical Unanswered Questions

### 1. What is the actual size and composition of Praxrr's target audience?

- **Why critical**: The entire feature strategy pivots on whether Praxrr serves hundreds or tens of thousands of users. The Contrarian argues most \*Arr users run 1-2 instances and configure manually in 15-30 minutes. The Futurist projects a $85.2B self-hosting market by 2034. The Crucible Analysis identifies this as a "Critical" severity contradiction. If the audience is small (power users only), depth-first features win. If the audience is growing (new self-hosters), onboarding and simplification win. Every feature priority depends on this answer.
- **Current status**: No quantitative data exists. Estimates range from "a fraction of the total \*Arr user base" (Contrarian) to "10x more users" (Futurist). Neither the Historian nor the Journalist was able to cite download counts or active-user numbers for any competing tool. Recyclarr, Profilarr, and Configarr do not publish user telemetry.
- **What's needed**: (1) Analyze GitHub star counts, Docker Hub pull counts, and Discord member counts for competing tools to estimate the addressable market. (2) Survey Praxrr's existing user base on instance count, Arr apps used, and feature priorities. (3) Monitor Profilarr V2's adoption metrics as a proxy for web-UI config management demand.
- **Priority**: High
- **Impact on feature strategy**: If the audience is primarily 1-2 instance users, UX simplification and onboarding are the only defensible priority. If the audience skews toward 3+ instance power users, IaC features (drift detection, sync preview) are the primary differentiator. Without this data, the Crucible Analysis's recommended "compound strategy" of H2 + H3 is a hedge, not a decision.

### 2. How frequently do upstream \*Arr APIs introduce breaking changes?

- **Why critical**: The Systems Thinker and Contrarian identify upstream API instability as an "existential risk." Three specific breakage incidents are documented (Recyclarr #318, Buildarr-Radarr #20, Prowlarr #912). But the frequency, severity distribution, and predictability of these breakages are unknown. Is it once a year? Once a quarter? Does Radarr break more often than Sonarr? Are breaking changes concentrated in major versions or sprinkled in patch releases? Without this data, the investment in API resilience infrastructure (adapter layers, graceful degradation, version-specific handlers) cannot be properly sized.
- **Current status**: Three incidents are documented across different tools and years. The Contrarian quotes \*Arr maintainers saying Recyclarr "may stop working at any time due to guide updates and changes." Radarr v5's obfuscation was deliberate and announced. But no systematic tracking of API stability exists.
- **What's needed**: (1) Audit Recyclarr's CHANGELOG for all entries related to upstream API changes over the past 2 years. (2) Monitor Radarr/Sonarr/Lidarr develop branches for API-surface changes. (3) Establish automated compatibility testing against nightly Arr builds to detect breakages before stable releases.
- **Priority**: High
- **Impact on feature strategy**: If API breakages are frequent (quarterly+), Praxrr must invest heavily in API abstraction layers and version-specific adapters before building features that deepen API coupling (drift detection, continuous reconciliation). If breakages are rare (annually), the risk is manageable and feature development can proceed more aggressively.

### 3. What is the realistic maintainer capacity for the next 3 years?

- **Why critical**: The Systems Thinker documents that 60% of open-source maintainers have quit or considered quitting. The Historian notes CouchPotato and Headphones died from single-maintainer burnout. The Contradiction Mapping observes that "no persona discussed how feature prioritization should account for maintainer capacity." The research proposes a feature list that would be ambitious for a well-funded startup: sync preview, drift detection, rollback, onboarding wizard, score simulator, progressive disclosure architecture, encrypted credential storage, passkey auth, Podman support, mobile responsiveness, and more. How many of these can actually be shipped and maintained?
- **Current status**: The research treats maintainer capacity as an implicit constraint but never quantifies it. The Crucible Analysis recommends deferring AI and community sharing but does not assess whether the remaining "Priority 1-3" items are achievable within available capacity.
- **What's needed**: (1) Honest assessment of available development hours per week. (2) Rough effort estimates for each proposed feature. (3) A capacity-constrained roadmap that sequences features within realistic timelines.
- **Priority**: High
- **Impact on feature strategy**: If capacity is limited (solo developer or small team), the feature list must be ruthlessly pruned. The "compound strategy" of UX + IaC + Security may need to become "sync preview + onboarding wizard, and that's it for 2026." Without this calibration, the strategy becomes a wishlist.

### 4. Why do users choose Profilarr's diff feature -- for the diff itself, or for the web UI?

- **Why critical**: The Crucible Analysis identifies this as "Discriminating Evidence Needed" -- evidence item #3. The journalist reports that "Profilarr's diff screen is consistently cited as its defining advantage." But is the diff the actual reason users adopt Profilarr, or is it the web UI (vs. Recyclarr's CLI) with the diff as a bonus? If users adopt for the web UI, then UX simplification (H2) is primary. If users adopt specifically for the diff, then sync preview (H3) is primary. The Crucible Analysis recommends both, but resource constraints may force a choice.
- **Current status**: No direct user research exists. The evidence is indirect -- comparison articles highlighting the diff feature -- but these articles are written by power users who may overweight technical features relative to UX accessibility.
- **What's needed**: (1) Analyze Profilarr's GitHub issues and discussions for themes in why users migrated from Recyclarr. (2) Monitor community forums for user testimonials about tool choice factors. (3) If possible, interview 5-10 users of each tool about their decision criteria.
- **Priority**: Medium
- **Impact on feature strategy**: Determines the relative priority of sync preview vs. onboarding wizard as the first major feature investment.

### 5. How do non-English-speaking users currently manage \*Arr configurations?

- **Why critical**: The Negative Space persona identifies non-English users as a "silent stakeholder" systematically excluded from the ecosystem. Configarr differentiates through regional/language-specific format support (German dual-language). The Contrarian questions whether TRaSH Guides recommendations are "universally correct," noting they optimize for English-language media. But no persona investigated how large the non-English user segment is, what their specific pain points are, or whether localization would meaningfully expand Praxrr's addressable market.
- **Current status**: Sparse evidence. A single Sonarr forum post asks about changing UI language. Configarr's German dual-language guide exists. The broader i18n picture is unknown.
- **What's needed**: (1) Analyze geographic distribution of Docker Hub pulls and GitHub traffic for Arr tools. (2) Survey non-English \*Arr communities (German, French, Spanish, Japanese) for configuration management needs. (3) Assess whether Praxrr's PCD model can support locale-specific base ops as a competitive differentiator.
- **Priority**: Medium
- **Impact on feature strategy**: If the non-English audience is substantial (>20% of total), investing in i18n and locale-specific PCDs could be a high-impact differentiator that no competitor addresses. If it is marginal, the investment is not justified.

### 6. What is the actual threat model for a typical Praxrr deployment?

- **Why critical**: The Contrarian and Systems Thinker debate whether security features are essential infrastructure or complexity theater. The resolution depends on the ACTUAL threat exposure of typical Praxrr deployments. Are most behind VPNs? Behind authenticated reverse proxies? Directly exposed to the internet? Running in Docker with root? Without knowing the deployment topology, security investments cannot be properly targeted.
- **Current status**: The Contrarian cites Pen Test Partners finding that Docker ignores UFW rules. The Journalist mentions "90% of users running Arr-stack scripts may be exposing API keys." But this 90% figure is acknowledged as likely exaggerated. No reliable data on typical deployment configurations exists.
- **What's needed**: (1) Survey existing users about their deployment topology (Docker/bare metal, VPN/reverse proxy/direct exposure, auth configuration). (2) Conduct a threat modeling exercise specific to Praxrr's architecture. (3) Assess whether Praxrr's SQLite database is actually at risk in typical deployments.
- **Priority**: Medium
- **Impact on feature strategy**: If most deployments are behind VPNs/authenticated proxies, foundational security (encrypted storage, key masking) is sufficient. If many are directly exposed, more aggressive security features (passkeys, rate limiting, security posture checks) are justified.

### 7. What is the actual adoption rate and retention curve for competing tools?

- **Why critical**: The Crucible Analysis warns that the "timing window is narrow" because Profilarr V2 shares Praxrr's tech stack. But we do not know how fast any competing tool is growing, what their retention looks like, or whether the market is expanding or zero-sum. The Journalist lists GitHub stars (Configarr: 542) but stars are a poor proxy for active users.
- **Current status**: No tool publishes user metrics. GitHub stars, Docker pulls, and Discord member counts are available but uncollected and unanalyzed.
- **What's needed**: (1) Track GitHub stars, Docker Hub pulls, and Discord members monthly for Recyclarr, Profilarr, Configarr, Notifiarr, and Buildarr. (2) Analyze GitHub issue frequency and response time as a proxy for community health. (3) Monitor Profilarr V2 development velocity and feature parity with Praxrr.
- **Priority**: Medium
- **Impact on feature strategy**: If the market is expanding (all tools growing), Praxrr has time to differentiate through quality. If it is zero-sum (tools taking users from each other), speed to market for key features becomes critical.

### 8. Will Sonarr v5 introduce breaking API changes that invalidate current sync approaches?

- **Why critical**: The Journalist reports Sonarr v5 is 85% complete (17 of 20 milestone issues closed). The remaining issues focus on metadata -- but major version releases often include unlisted API changes. Radarr v5 introduced API obfuscation that broke Buildarr. If Sonarr v5 follows a similar pattern, Praxrr may need to invest in API adaptation immediately.
- **Current status**: The Sonarr v5 milestone shows 3 remaining issues, all metadata-related. But the develop branch may contain API changes not tracked in the milestone.
- **What's needed**: (1) Monitor the Sonarr v5-develop branch for API-surface changes. (2) Set up automated API compatibility testing against Sonarr v5 nightly builds. (3) Engage with Sonarr community to understand planned API evolution.
- **Priority**: High
- **Impact on feature strategy**: If Sonarr v5 introduces breaking API changes, Praxrr must allocate resources to API adaptation before shipping new features. This could delay the entire roadmap.

### 9. How do users actually discover and recover from configuration errors?

- **Why critical**: The Negative Space persona documents that "users discover configuration problems only when downloads behave unexpectedly, which can be days after the configuration was applied." The scoring simulator and configuration health check are proposed as solutions. But no persona investigated the actual debugging workflow: How long does it take users to diagnose a bad configuration? What tools do they use? Do they ask in Discord, check logs, or trial-and-error? Understanding the current debugging experience would validate (or invalidate) the proposed solutions.
- **Current status**: Anecdotal evidence from forum posts about "still struggling with custom format scoring." The Contrarian mentions that debugging "which regex matched can take an hour." No systematic study of the debugging experience exists.
- **What's needed**: (1) Analyze Sonarr/Radarr/Recyclarr Discord channels for configuration debugging threads. (2) Categorize the most common configuration errors and their resolution paths. (3) Estimate average time-to-resolution for configuration problems.
- **Priority**: Medium
- **Impact on feature strategy**: If debugging is primarily a scoring comprehension problem, the score simulator is the right investment. If debugging is primarily a "what did sync change?" problem, the sync history/audit log is more valuable. If debugging is primarily a "my config doesn't match what I think it is" problem, drift detection is the priority.

### 10. What would make an autobrr-style Arr alternative succeed, and what would that mean for config management tools?

- **Why critical**: The Journalist reports that autobrr's team is building a ground-up *Arr alternative with 60+ votes on multiple edition support, 39+ on multi-language, and 31+ on pre-import media analysis. The Futurist flags this as a "wild card." If autobrr ships a unified media automation app with built-in configuration management, the entire competitive landscape changes. But no persona investigated the probability of autobrr's success, its timeline, or how quickly it could absorb *Arr market share.
- **Current status**: Active community discussion with high engagement, but the project appears to be in early planning/development. No alpha release is documented. Historical precedent (Bobarr, MediaManager) suggests that ground-up alternatives struggle against the entrenched \*Arr ecosystem.
- **What's needed**: (1) Monitor autobrr development progress. (2) Assess whether autobrr's architecture would be compatible with external config management (Praxrr adapting to manage autobrr configurations). (3) Track community sentiment for migration willingness.
- **Priority**: Low (watch, don't act)
- **Impact on feature strategy**: If autobrr succeeds, Praxrr needs an adapter for its API. If autobrr stalls (like Bobarr), the \*Arr ecosystem remains Praxrr's target. Either way, designing Praxrr's sync pipeline as adapter-based rather than hard-coded to Radarr/Sonarr APIs is the right architecture.

---

## Research Gaps by Category

### User Research Gaps

The most significant blind spot across all research is the near-total absence of primary user research. All eight personas relied on secondary sources: GitHub issues, forum posts, comparison articles, and market reports. No persona conducted user interviews, surveys, or usability testing. The resulting picture is built entirely from the signals of vocal power users, which systematically overweights technical feature requests and underweights onboarding friction, casual-user needs, and non-English-speaker experiences.

**Specific gaps:**

- No data on how many active users each competing tool has
- No data on instance count distribution (1, 2, 3+, 10+ instances per user)
- No data on primary Arr app usage (Radarr-only, Radarr+Sonarr, full stack)
- No data on deployment topology (Docker, bare metal, NAS, cloud)
- No data on user technical sophistication distribution (CLI-comfortable, GUI-preferred, non-technical)
- No data on geographic/language distribution of \*Arr users
- No onboarding funnel metrics for any config management tool (the Systems Thinker's 15% retention estimate is acknowledged as Low confidence)
- No usability testing of any config management tool's workflow
- No data on time-to-first-successful-sync for any tool
- No data on which features actually drive tool adoption vs. which are requested but rarely used

### Technical Feasibility Gaps

The research proposes features without assessing implementation complexity against Praxrr's specific architecture.

**Specific gaps:**

- No assessment of how Praxrr's current sync pipeline handles partial failures (what happens if 3 of 5 API calls succeed?)
- No analysis of Arr API rate limits and how they constrain polling frequency for drift detection
- No assessment of SQLite performance implications of storing sync snapshots and audit logs at scale
- No evaluation of whether Praxrr's Deno runtime has mature WebAuthn/passkey libraries
- No testing of append-only ops replay performance at scale (how fast can Praxrr recompile PCD with 10,000+ ops?)
- No analysis of whether Praxrr's SvelteKit UI architecture supports the proposed progressive disclosure patterns without major refactoring
- No assessment of cross-browser passkey support for self-hosted applications (passkey sync across devices without cloud backup)
- No evaluation of SQLCipher or equivalent encrypted SQLite options for Deno
- No performance benchmarking of Arr API calls to inform drift detection polling intervals
- No assessment of the Go parser migration's impact on feature development timelines (referenced in recent commits)

### Competitive Intelligence Gaps

The Journalist provided the most detailed competitive analysis, but significant gaps remain.

**Specific gaps:**

- No data on Profilarr V2's specific feature roadmap or release timeline
- No data on Recyclarr's active user count (only version number and release dates)
- No analysis of Notifiarr's paid-feature conversion rate (how many users pay for TRaSH sync?)
- No data on Configarr's Kubernetes adoption specifically (is the Kubernetes niche large enough to matter?)
- No analysis of whether Buildarr is actively maintained or effectively abandoned
- No monitoring of Profilarr V2's development velocity (commits per week, issue closure rate)
- No assessment of ElfHosted's market share or growth rate for managed \*Arr deployments
- No analysis of which specific Profilarr V2 features overlap with Praxrr V2

### Security Model Gaps

Multiple personas discuss security, but no persona conducted an actual threat model or security assessment.

**Specific gaps:**

- No formal threat model for Praxrr (asset inventory, threat actors, attack surfaces, risk ratings)
- No assessment of whether Praxrr's current API key storage is actually vulnerable in typical deployments
- No analysis of Praxrr's PCD ops for injection vulnerabilities (can crafted SQL in PCD data be executed?)
- No review of Praxrr's OIDC implementation for common misconfigurations
- No assessment of Praxrr's Docker image for security best practices (non-root user, minimal base image, no capabilities)
- No analysis of what happens if a PCD repository is compromised (supply chain attack simulation)
- No evaluation of backup/restore procedures for credential-containing databases
- No assessment of Praxrr's network exposure in typical Docker Compose deployments

### UX Validation Gaps

The Negative Space persona identified numerous UX blind spots, but none have been validated with actual users.

**Specific gaps:**

- No usability testing of Praxrr's current UI
- No user journey mapping for the first-time setup experience
- No heuristic evaluation against established UX frameworks (Nielsen's heuristics, WCAG)
- No A/B testing data on any proposed UX improvement
- No card sorting or tree testing for information architecture
- No assessment of cognitive load for Praxrr's current UI vs. competitors
- No mobile usability testing (is Praxrr's current SvelteKit UI responsive?)
- No accessibility audit of Praxrr's current UI (WCAG 2.1 AA compliance)
- No validation of whether the proposed "score simulator" would actually help users understand scoring (or just add another layer of complexity)
- No validation of whether progressive disclosure modes (beginner/advanced) are desired by users or perceived as patronizing

---

## Assumptions That Need Validation

### "Users want a single tool to manage all \*Arr configurations"

- **Assumed by**: Historian, Journalist, Analogist, Archaeologist, Futurist
- **Evidence strength**: Weak. The Contrarian directly challenges this assumption, noting that "the proliferation of competing tools suggests that no single approach satisfies all users." The market is fragmenting, not consolidating. Some users prefer CLI (Recyclarr), others prefer GUI (Profilarr), others prefer Kubernetes-native (Configarr). The existence of multiple tools may indicate diverse needs rather than a winner-take-all market.
- **Risk if wrong**: Praxrr invests in becoming a "universal" tool and ends up serving no audience well. The feature creep that comes from trying to satisfy all users simultaneously may make it worse than focused alternatives.
- **Validation approach**: Survey users of multiple tools about why they chose their tool and whether they would consolidate to one tool if it existed. Analyze whether users who try Praxrr keep or abandon their previous tool.

### "Configuration drift is a significant problem that users experience"

- **Assumed by**: Analogist, Archaeologist, Systems Thinker, Negative Space, Journalist
- **Evidence strength**: Weak-to-Medium. Drift detection is recommended by 5 of 8 personas and is identified as "the clearest competitive whitespace." However, the evidence that drift is a PROBLEM users actually experience (vs. a theoretical concern imported from enterprise IaC) is thin. The Negative Space persona notes that user demand for drift detection is "Medium -- this is a concept most Arr users have not been exposed to." No user complaints about configuration drift were documented. The concept may be a solution in search of a problem.
- **Risk if wrong**: Praxrr invests significant effort in drift detection infrastructure that users do not use or understand. The feature adds complexity without matching actual user pain.
- **Validation approach**: (1) Add lightweight drift tracking to Praxrr's existing sync pipeline (compare before/after state) and measure how often drift actually occurs. (2) Ask users in forums/Discord whether they have experienced unexpected configuration changes in their Arr instances. (3) Implement as a background data collection feature before building the full dashboard UI.

### "The self-hosting market will continue to grow significantly"

- **Assumed by**: Futurist, Historian, Journalist
- **Evidence strength**: Medium. Market projection data ($85.2B by 2034) is cited, and structural drivers are documented (streaming fragmentation, Plex monetization, AI-assisted setup). However, counterforces exist that no persona examined: regulatory crackdowns on self-hosting/piracy, ISP bandwidth caps, increasing complexity of media ecosystems, and the possibility that streaming services consolidate and reduce subscription fatigue.
- **Risk if wrong**: Praxrr invests in growth-oriented features (onboarding, simplification, progressive disclosure) for an audience that does not materialize. Resources are wasted on accessibility and i18n for a market that remains niche.
- **Validation approach**: Track leading indicators: r/selfhosted subscriber growth, Jellyfin download trends, \*Arr GitHub star velocity, and Docker Hub pull trends for Arr images. If these flatten or decline, reassess the growth assumption.

### "Profilarr V2 is the closest competitor and the primary competitive threat"

- **Assumed by**: Journalist, Crucible Analysis
- **Evidence strength**: Medium. Profilarr V2 shares Praxrr's tech stack (SvelteKit, Deno, SQLite, append-only ops), making it architecturally the closest competitor. However, Profilarr V2 is described as "NOT production-ready" and "in heavy development." The actual competitive threat depends on Profilarr V2's development velocity, which was not measured. If Profilarr V2 stalls (like many ambitious open-source rewrites), the "narrow timing window" the Crucible Analysis warns about may be years, not months.
- **Risk if wrong**: Praxrr rushes features to market prematurely, shipping a buggy sync preview or incomplete drift detection to "beat" a competitor that was never going to ship. Quality suffers from artificial urgency.
- **Validation approach**: Monitor Profilarr V2's GitHub commit frequency, issue closure rate, and release cadence monthly. Assess whether it is accelerating or stalling. Adjust urgency accordingly.

### "Security features do not drive adoption in the self-hosted ecosystem"

- **Assumed by**: Crucible Analysis (as a conclusion)
- **Evidence strength**: Medium. The Crucible Analysis argues that "No user has ever chosen Recyclarr vs. Profilarr based on security features." Recyclarr stores API keys in plaintext YAML yet has the largest user base. However, this may reflect the current absence of security-differentiated alternatives rather than a genuine user preference. If Praxrr offered encrypted credential storage and a security dashboard while competitors did not, the differential might influence adoption -- especially among enterprise-adjacent users (organizations with media servers, managed hosting platforms like ElfHosted).
- **Risk if wrong**: Praxrr under-invests in security, and a competitor or a security incident changes user priorities. The security foundation is harder to retrofit than to build from the start.
- **Validation approach**: (1) Implement basic security features (encrypted storage, key masking) with low effort and observe whether they appear in user testimonials or comparison discussions. (2) Monitor whether any security incident in the self-hosted ecosystem changes user behavior regarding tool security.

### "The append-only ops model makes rollback architecturally straightforward"

- **Assumed by**: Negative Space, Crucible Analysis
- **Evidence strength**: Weak. The claim that Praxrr's PCD model "already provides a natural undo mechanism" is made without analyzing the actual implementation. Append-only ops provide a history, but rolling back to a previous state requires: (1) identifying the correct rollback point, (2) generating inverse ops for everything applied after that point, (3) applying those inverse ops to the PCD, and (4) syncing the rolled-back state to Arr instances. Step 4 is the hard part -- it requires knowing what the Arr instance looked like at the rollback point, which may require state snapshots that do not currently exist.
- **Risk if wrong**: Rollback is promised as a feature but turns out to be technically complex, requiring state snapshots, inverse op generation, and careful Arr API interaction that add months to the implementation timeline.
- **Validation approach**: Conduct a technical spike: attempt to roll back a PCD to a previous state and sync the result to an Arr test instance. Document the gaps between the current architecture and a working rollback feature.

---

## Key Insights

1. **The single most dangerous gap is the absence of primary user research.** All eight persona findings and both synthesis documents are built on secondary sources -- GitHub issues, forum posts, comparison articles, and market projections. No one talked to actual users. This means the entire feature strategy is based on the loudest voices in public forums, which systematically overrepresent power users and underrepresent the broader audience Praxrr needs to grow. Until direct user research fills this gap, every priority is a bet, not a decision.

2. **The gap that could change the entire strategy is the audience size question.** If Praxrr's realistic audience in 2026 is a few hundred power users managing 5+ instances, the strategy should be enterprise IaC depth (drift detection, sync preview, rollback). If the audience is thousands of users entering self-hosting for the first time, the strategy should be radical UX simplification (wizard, presets, one-click setup). The Crucible Analysis hedges by recommending both, but resource constraints will force a choice. This single data point -- how many users, of what type -- is the most important missing input.

3. **The easiest gap to fill is competitive monitoring.** GitHub stars, Docker Hub pulls, Discord members, and commit frequency are all publicly available for every competing tool. Setting up a monthly tracking spreadsheet would cost hours, not weeks, and would provide the competitive intelligence the Journalist began to assemble. This is a low-effort, high-signal activity that should begin immediately.

4. **The upstream API stability question is underresearched relative to its importance.** Three breakage incidents are cited across the entire research corpus. But three incidents over multiple years across multiple tools is a thin dataset for an "existential risk" assessment. Either the risk is lower than feared (most API changes are backward-compatible), or many more breakages exist and were not found by the research. A systematic audit of Recyclarr's changelog would resolve this in hours.

5. **The security gaps are real but the prioritization is wrong.** The Crucible Analysis correctly notes that security does not drive adoption. But it incorrectly treats encrypted credential storage as a "Priority 3" item behind sync preview and onboarding. Encrypted storage is a foundation that becomes exponentially harder to retrofit after users have plaintext databases in production. It should be built early (before or alongside v2 production release), not after feature differentiation is established. The order should be: encrypted storage first (because it is a prerequisite for trust), then features (because they drive adoption), then advanced security (because adoption creates the audience that demands it).

6. **No research examined Praxrr's actual codebase readiness for the proposed features.** The Go parser migration, existing test coverage, database migration infrastructure, and current sync pipeline architecture were not analyzed in the context of feature feasibility. The research documents at `/home/yandy/Projects/github.com/yandy-r/praxrr/research/praxrr-additional-features/` exist in isolation from the codebase they are meant to inform. A technical feasibility assessment against the actual code would ground the entire strategy.
