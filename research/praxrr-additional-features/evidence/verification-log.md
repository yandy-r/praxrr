# Evidence Verification Log

## High-Confidence Findings

### 1. Sync Preview Is Absent From All Competitors

- **Claimed by**: Analogist, Journalist, Negative Space, Systems Thinker, Futurist, Archaeologist, Contrarian
- **Primary sources**: Recyclarr documentation (no preview feature), Profilarr documentation (diff shows PCD-to-PCD, not PCD-to-live), Configarr documentation (YAML-based, no interactive preview), Buildarr documentation (CLI push only)
- **Verification status**: Confirmed
- **Confidence**: High
- **Notes**: Profilarr's visual diff is the closest approximation but shows configuration database comparisons, not a preview of what would change on a live Arr instance during sync.

### 2. No Tool Encrypts API Keys at Rest

- **Claimed by**: Journalist, Negative Space, Contrarian, Systems Thinker, Futurist, Analogist
- **Primary sources**: Recyclarr stores keys in plaintext YAML files. Profilarr stores in SQLite (plaintext). Configarr stores in YAML. Buildarr stores in YAML.
- **Verification status**: Confirmed
- **Confidence**: High
- **Notes**: Radarr v5 obfuscated API keys in API responses but does not encrypt at rest. The distinction between "obfuscated in transit" and "encrypted at rest" is important.

### 3. Terraform Plan/Apply Maps to Praxrr Sync Pipeline

- **Claimed by**: Analogist, Archaeologist
- **Primary sources**: Terraform CLI documentation (plan command), Terraform Internals documentation (state management)
- **Verification status**: Confirmed
- **Confidence**: High
- **Notes**: The mapping is direct: Terraform plan = sync preview, Terraform apply = sync execute, Terraform state = PCD compiled cache, Terraform providers = Arr API adapters.

### 4. Radarr v5 API Obfuscation Broke Buildarr

- **Claimed by**: Contrarian, Journalist
- **Primary sources**: Buildarr GitHub issue #20 (buildarr-radarr), Radarr v5 changelog, \*Arr developer statement "No plans to deobfuscate"
- **Verification status**: Confirmed
- **Confidence**: High
- **Notes**: Radarr v5 deliberately obfuscated API keys in GET responses, breaking Buildarr's idempotency model (which compared current state with desired state, including API key fields).

### 5. Silent Sync Failures Documented Across Tools

- **Claimed by**: Contrarian, Journalist
- **Primary sources**: Recyclarr GitHub #318, Prowlarr #912, Profilarr #230
- **Verification status**: Partially confirmed (issue numbers cited; exact content not independently verified via API)
- **Confidence**: Medium-High
- **Notes**: Multiple independent reports of sync failures that produced no error output, discovered only when downstream behavior changed.

### 6. Progressive Disclosure Validated by UX Research

- **Claimed by**: Systems Thinker, Analogist
- **Primary sources**: Nielsen Norman Group research on progressive disclosure, Home Assistant developer documentation
- **Verification status**: Confirmed
- **Confidence**: High
- **Notes**: Progressive disclosure "improves 3 of usability's 5 components: learnability, efficiency of use, and error rate" per NNGroup.

### 7. CFEngine Convergence Model Proven Since 1993

- **Claimed by**: Archaeologist, Analogist
- **Primary sources**: Mark Burgess's original CFEngine papers (1993), Puppet/Chef/Ansible documentation citing CFEngine as predecessor
- **Verification status**: Confirmed
- **Confidence**: High
- **Notes**: The desired-state convergence model (declare what you want, detect drift, converge toward desired state) has been the foundation of configuration management for 30+ years.

### 8. Passkey/WebAuthn Is Standardized and Widely Supported

- **Claimed by**: Futurist
- **Primary sources**: W3C WebAuthn Level 2 specification, FIDO Alliance passkey documentation, browser compatibility tables
- **Verification status**: Confirmed
- **Confidence**: High
- **Notes**: Supported in all major browsers and OSes as of 2024. Implementation complexity is moderate but well-documented.

## Medium-Confidence Findings

### 9. Self-Hosted Market Projected to $85.2B by 2034

- **Claimed by**: Futurist
- **Primary sources**: Market research reports (specific source name not independently verified)
- **Verification status**: Partially confirmed -- market growth trend is well-documented, specific figure not independently verified
- **Confidence**: Medium
- **Notes**: The exact figure matters less than the directional trend. Multiple independent analyses confirm self-hosted/home server market growth driven by streaming fragmentation and privacy concerns.

### 10. Profilarr V2 Shares Praxrr's Tech Stack

- **Claimed by**: Journalist
- **Primary sources**: Profilarr V2 GitHub repository (SvelteKit, Deno runtime, SQLite database, append-only operations)
- **Verification status**: Confirmed via repository inspection
- **Confidence**: High
- **Notes**: The architectural similarity is striking and independently verifiable. Both use SvelteKit + Deno + SQLite with append-only operation models.

### 11. 80% User Abandonment From Bad Onboarding

- **Claimed by**: Negative Space
- **Primary sources**: General UX research (exact citation varies; commonly attributed to Appcues and similar UX platforms)
- **Verification status**: Partially confirmed -- the general principle is well-established in UX literature; the exact 80% figure is a commonly cited approximation
- **Confidence**: Medium
- **Notes**: The directional claim (bad onboarding causes high abandonment) is strongly supported. The specific percentage is an industry estimate, not a measurement specific to \*Arr tools.

### 12. Sonarr v5 Is 85% Complete

- **Claimed by**: Journalist
- **Primary sources**: Sonarr GitHub milestone (17 of 20 issues closed at time of research)
- **Verification status**: Point-in-time snapshot, may have changed
- **Confidence**: Medium
- **Notes**: Milestone completion does not guarantee API stability. Major version releases often include API changes not tracked in user-facing milestones.

## Contradictions Requiring Resolution

### Configuration Drift: Theoretical Risk vs. Validated Problem

- **Persona A says**: Drift detection is "the clearest competitive whitespace" with 30+ years of enterprise precedent (Analogist, Archaeologist, Historian)
- **Persona B says**: No user has complained about drift; user demand is "Medium -- most Arr users have not been exposed to this concept" (Negative Space)
- **Evidence for A**: Enterprise IaC universally includes drift detection; Arr APIs allow manual changes that bypass managed state
- **Evidence for B**: Zero documented user complaints about drift in any \*Arr community
- **Resolution**: Drift detection is theoretically sound but empirically unvalidated for Arr use cases. Recommended approach: instrument background drift tracking in sync pipeline to measure real occurrence before building full dashboard.

### Audience Size: Small Niche vs. Growing Market

- **Persona A says**: Most users run 1-2 instances; addressable audience is "smaller than assumed" (Contrarian)
- **Persona B says**: Self-hosted market growing to $85.2B by 2034; 10x user growth predicted (Futurist, Historian)
- **Evidence for A**: No quantitative data, but logical argument based on typical homelab configurations
- **Evidence for B**: Market projections (medium confidence), structural drivers (streaming fragmentation)
- **Resolution**: Both are likely correct at different time horizons. Build for today's power users (depth-first) while designing for tomorrow's broader audience (progressive disclosure).

### Security: Essential Infrastructure vs. Complexity Theater

- **Persona A says**: Security is "the biggest unaddressed need" (Journalist, Negative Space)
- **Persona B says**: OIDC is overkill for single-user; encryption at rest is theater if app can decrypt (Contrarian)
- **Evidence for A**: No competitor implements any security features; Plex breaches affected millions
- **Evidence for B**: Recyclarr stores plaintext keys yet has the largest user base
- **Resolution**: Both correct in their domain. Implement high-ROI security (encrypted storage, key masking, passkeys) while avoiding low-ROI security theater (RBAC for single users, rate limiting for local services).
