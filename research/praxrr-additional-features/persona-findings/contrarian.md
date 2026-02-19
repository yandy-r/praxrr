# Contrarian Research: New Features for Praxrr Media Automation Config Manager

## Executive Summary

Centralized configuration management tools for the \*Arr ecosystem face a fundamental tension: they add a layer of complexity and a single point of failure to systems where most users have a single instance they could configure manually in minutes. The evidence suggests that the biggest risks to Praxrr are not missing features, but rather feature creep, the fragility of depending on upstream APIs that break without warning, the security liability of centralizing API keys, and the reality that most homelab users over-engineer their setups and later regret the complexity. Any new feature should be evaluated against the question: "Does this genuinely reduce user burden, or does it just add another thing that can break?"

## Disconfirming Evidence

### "Centralized config management is better than manual per-instance configuration"

- **Common belief**: Managing configurations centrally saves time and ensures consistency across instances.
- **Contradictory evidence**: Most \*Arr users run 1-2 instances (one Radarr, one Sonarr). For these users, TRaSH Guides provides a one-time manual setup that takes 15-30 minutes and rarely needs revisiting. Introducing a config management layer adds ongoing maintenance burden (updates, YAML editing, debugging sync failures) that exceeds the time saved. Recyclarr's own documentation warns that it "may stop working at any time due to guide updates and changes in either Radarr or Sonarr," meaning users must monitor and troubleshoot the tool itself. The Hacker News discussion on personal configuration management noted that "automation needs fairly constant attention in the order of little tweaks week over week to fight the inevitable mismatch between the automation and the software networks that it interfaces with."
- **Source quality**: Primary (tool documentation, community discussions)
- **Strength**: Moderate - valid for single-instance users, weaker for multi-instance deployments
- **Sources**: [Recyclarr Troubleshooting](https://recyclarr.dev/wiki/troubleshooting/help/), [HN Configuration Management Discussion](https://news.ycombinator.com/item?id=20670235)

### "Users want more features in their \*Arr config tools"

- **Common belief**: Adding more features to config management tools increases their value.
- **Contradictory evidence**: Feature creep is a documented anti-pattern in software development. When a product has excessive features, it becomes complicated to use and less likely to generate the desired traction. The \*Arr ecosystem already suffers from tool fatigue -- users must juggle Sonarr, Radarr, Prowlarr, Lidarr, Bazarr, Overseerr/Jellyseerr, a download client, and often Recyclarr/Profilarr/Configarr on top. Each additional tool increases the cognitive load and failure surface. The comparison between Recyclarr, Profilarr, and Configarr reveals that running multiple config tools simultaneously causes them to "fight over your settings," endlessly overwriting each other. The market is fragmenting, not consolidating, which suggests users are dissatisfied with existing tools rather than hungry for more features in any single one.
- **Source quality**: Primary (tool documentation, feature creep research)
- **Strength**: Strong - well-documented phenomenon with direct \*Arr ecosystem evidence
- **Sources**: [Feature Creep - Wikipedia](https://en.wikipedia.org/wiki/Feature_creep), [Profilarr vs Recyclarr](https://corelab.tech/profilarr-vs-trash/), [Feature Creep Is Killing Your Software](https://www.designrush.com/agency/software-development/trends/feature-creep)

### "Configuration sync approaches work reliably"

- **Common belief**: Automated sync between a config tool and \*Arr instances is a solved problem.
- **Contradictory evidence**: Multiple documented failure modes exist. Recyclarr issue #318 showed that a Sonarr update broke Recyclarr's ability to deserialize custom format data, rendering sync completely non-functional. Prowlarr issue #912 documented months-long sync failures where indexer additions simply did not propagate to downstream apps, with the reporter noting the bug was "100% reproducible" and had persisted for months. Profilarr issue #230 reports that sync silently fails -- "doesn't sync changes with Radarr and Sonarr but displays no errors in GUI." The `delete_old_custom_formats` feature in Recyclarr has had bugs where it failed to remove custom formats as expected (issue #237). These are not edge cases; they represent fundamental fragility in the sync approach.
- **Source quality**: Primary (GitHub issues, bug reports)
- **Strength**: Strong - multiple independent failure reports across different tools
- **Sources**: [Recyclarr #318](https://github.com/recyclarr/recyclarr/issues/318), [Prowlarr #912](https://github.com/Prowlarr/Prowlarr/issues/912), [Profilarr #230](https://github.com/Dictionarry-Hub/profilarr/issues/230), [Recyclarr #237](https://github.com/recyclarr/recyclarr/issues/237)

### "Manual per-instance configuration is always inferior"

- **Common belief**: Automation always beats manual configuration.
- **Contradictory evidence**: During incidents, engineers may need to make manual changes that automated tools would overwrite. Configuration drift literature acknowledges that "wiping out a manual change might result in reintroducing a problem that someone fixed earlier, but failed to record." In the \*Arr context, a user who manually adjusts a custom format score for a specific edge case risks having Recyclarr or Profilarr revert that change on the next sync cycle. Recyclarr's `replace_existing_custom_formats` flag, when enabled, replaces "any existing CFs with the same name, whether you created them or not." This means manual customizations are actively destroyed by the automation tool. The workaround -- carefully configuring exclusion lists -- adds complexity that partially negates the benefit of automation.
- **Source quality**: Primary (tool documentation, configuration drift research)
- **Strength**: Moderate - valid for users who need per-instance customization
- **Sources**: [Recyclarr Custom Formats Reference](https://recyclarr.dev/reference/configuration/custom-formats/), [Configuration Drift - Spacelift](https://spacelift.io/blog/what-is-configuration-drift)

## Expert Critiques

### \*Arr Maintainers (Radarr/Sonarr Development Team)

- **Credentials**: Core developers of the applications that config tools depend on.
- **Main argument**: Third-party tools are explicitly "not maintained, developed, nor supported by the \*Arr Development Team." The maintainers make deliberate API changes without regard for third-party tool compatibility.
- **Evidence provided**: Radarr v5 deliberately obfuscated API keys and passwords in API responses, breaking the idempotency model that tools like Buildarr depend on. When the Buildarr developer raised this as issue #9397, the Radarr maintainer (@bakerboy448) stated flatly: "No plans to deobfuscate." The proposed workaround -- skipping provider retesting on unchanged resources -- shifts the burden entirely to third-party tool developers.
- **Counterarguments**: Proponents argue that security improvements justify breaking third-party tools, and that tools should adapt to API changes.
- **Assessment**: This critique is highly valid. Any tool building on \*Arr APIs is building on shifting sand. The maintainers have no obligation to maintain backward compatibility for third-party config tools, and their security-motivated changes can break fundamental assumptions (like idempotent resource checking) that config management tools rely on.
- **Sources**: [Radarr Issue #9397](https://github.com/Radarr/Radarr/issues/9397), [Buildarr-Radarr Issue #20](https://github.com/buildarr/buildarr-radarr/issues/20), [Servarr Wiki - Useful Tools](https://wiki.servarr.com/useful-tools)

### Pen Test Partners (Security Research Firm)

- **Credentials**: Professional penetration testing firm with published homelab security research.
- **Main argument**: Homelab users systematically underestimate their threat exposure. Automated scanning finds exposed services indiscriminately regardless of how "small" a target appears. The biggest gaps are in basic hygiene, not missing advanced features.
- **Evidence provided**: Their research found that Docker ignores UFW firewall rules, meaning services intended to be internal become publicly exposed. Default configurations ship with obvious weak credentials. Users detect compromise only when symptoms appear (spam accusations, corrupted data) rather than through active monitoring. A Shodan scan discovered hundreds of self-hosted admin tools running Docker images over 2 years old with known CVEs.
- **Counterarguments**: Security-focused tools like Praxrr can help mitigate some of these issues by centralizing management.
- **Assessment**: Valid and important. The critique suggests that before adding security features, Praxrr should ensure its own deployment model does not introduce new attack surface. Adding OIDC, for instance, means running and maintaining an identity provider -- another service that can be misconfigured or left unpatched.
- **Sources**: [Pen Test Partners - Hardening Your Home Lab](https://www.pentestpartners.com/security-blog/hardening-your-home-lab/), [Home Lab Security Threats](https://www.virtualizationhowto.com/2025/04/home-lab-security-5-threats-youre-not-watching-but-should-be/)

### UX Critics (Tool Complexity)

- **Credentials**: Software UX research and the \*Arr community's own experience.
- **Main argument**: Custom format scoring is already too complex for most users. Adding more management layers does not simplify it; it just moves the complexity.
- **Evidence provided**: Radarr developers themselves acknowledged that "Custom Formats is too complex" and anticipated "millions of issue threads." Users with TRaSH Guide configurations end up with close to 100 preferred words, and the permutations of scores are enormous. Trying to debug which regex matched can take an hour. Recyclarr requires editing YAML files where "a misplaced space indentation can crash the entire sync." Profilarr is described as "generally more 'all or nothing' with the profile sets you subscribe to."
- **Counterarguments**: Tools like Praxrr aim to simplify this complexity through better UI.
- **Assessment**: Valid. The underlying complexity of custom format scoring is the real problem. A config management tool can present it more nicely, but it cannot reduce the fundamental complexity of deciding how to score 100+ formats across multiple quality profiles. This is a domain complexity problem, not a tooling problem.
- **Sources**: [Radarr Issue #4666](https://github.com/Radarr/Radarr/issues/4666), [Profilarr vs Recyclarr Comparison](https://corelab.tech/profilarr-vs-trash/)

## Documented Failures

### Recyclarr Sync Breaks on Sonarr Update (Issue #318)

- **What happened**: A Sonarr update changed the API response format for custom format fields, introducing boolean values where Recyclarr expected strings. Recyclarr could not deserialize the response, causing all sync operations to fail with "CF field of type False is not supported."
- **Root causes**: Tight coupling between Recyclarr's deserialization logic and Sonarr's undocumented API response format. No schema validation or graceful degradation.
- **Scale/impact**: All users running affected Sonarr versions lost sync capability until Recyclarr v7.2.3 was released.
- **Lessons**: Config management tools are only as stable as the upstream APIs they depend on. Upstream \*Arr apps make changes without coordinating with third-party tools, and these changes can be breaking.
- **Confidence**: High
- **Source**: [Recyclarr Issue #318](https://github.com/recyclarr/recyclarr/issues/318)

### Radarr v5 API Obfuscation Breaks Idempotency (Buildarr Issue #20)

- **What happened**: Radarr v5 obfuscated passwords and API keys in API responses. This made it impossible for Buildarr to determine if a configuration had changed, forcing it to re-apply all configurations on every run, which triggered nuisance alerts and risked account lockouts from repeated password-based connection tests.
- **Root causes**: Radarr prioritized security (preventing API key exposure) over third-party tool compatibility. No alternative mechanism (like a hash-based comparison endpoint) was provided.
- **Scale/impact**: Affected all users of Buildarr with Radarr v5. The Buildarr developer had to implement workarounds and the project's viability was questioned.
- **Lessons**: Upstream security improvements can be hostile to downstream config management tools. The \*Arr maintainers explicitly stated "No plans to deobfuscate," making this a permanent architectural constraint.
- **Confidence**: High
- **Source**: [Buildarr-Radarr Issue #20](https://github.com/buildarr/buildarr-radarr/issues/20), [Radarr Issue #9397](https://github.com/Radarr/Radarr/issues/9397)

### Prowlarr Sync Silently Fails for Months (Issue #912)

- **What happened**: Prowlarr's indexer sync to Sonarr and Radarr stopped working. New indexers were not propagated, and existing indexer updates failed silently. The issue was "100% reproducible" and persisted across multiple version branches for months.
- **Root causes**: Category serialization bug prevented successful API requests to downstream applications.
- **Scale/impact**: Users who relied on Prowlarr for centralized indexer management had to manually configure indexers in each \*Arr app, defeating the purpose of the tool.
- **Lessons**: Silent failures in sync pipelines are particularly dangerous because users trust the tool is working and do not manually verify. By the time the issue is discovered, significant configuration drift may have accumulated.
- **Confidence**: High
- **Source**: [Prowlarr Issue #912](https://github.com/Prowlarr/Prowlarr/issues/912)

### SQLite Database Corruption in Docker (Vaultwarden and Others)

- **What happened**: Multiple self-hosted applications using SQLite in Docker containers experienced silent database corruption. In Vaultwarden's case, the application continued operating with a corrupted database -- users could log in and add entries, but data would disappear after page reloads. In n8n's case, databases were "declared corrupt overnight" and were not recoverable.
- **Root causes**: Improper backup methods (using `sqlite3 .dump` on active databases), ZFS/NFS filesystem incompatibilities with SQLite's locking model, ungraceful container shutdowns, and lack of startup integrity checks.
- **Scale/impact**: Total data loss for affected users. One Vaultwarden user lost their entire password vault.
- **Lessons**: SQLite in Docker is a known risk surface. Praxrr uses SQLite as its primary database, making it susceptible to identical failure modes. Applications should validate database integrity at startup, implement proper backup procedures, and surface corruption errors immediately rather than silently degrading.
- **Confidence**: High
- **Source**: [Vaultwarden Discussion #2965](https://github.com/dani-garcia/vaultwarden/discussions/2965), [n8n Community - SQLite Corruption](https://community.n8n.io/t/urgent-docker-hosted-n8n-on-sqlite-crashed-possible-db-corruption-looking-for-paid-expert-to-recover-data-and-migrate-to-postgres/257163)

### Plex Data Breaches (2022 and 2025)

- **What happened**: Plex suffered two major data breaches, exposing emails, usernames, and encrypted passwords for up to 30 million users. The 2025 breach was particularly impactful for self-hosted users: when Plex forced password resets and device logouts, it also expired server ownership claims, leaving users unable to access their own media servers.
- **Root causes**: Centralized authentication architecture created a single point of failure. Even "self-hosted" Plex servers depend on Plex's cloud authentication service.
- **Scale/impact**: Up to 30 million users affected per incident. Self-hosted users lost access to their own hardware.
- **Lessons**: Centralizing authentication or credential management creates a single point of failure that can affect all connected services simultaneously. This is directly relevant to Praxrr, which stores API keys for multiple \*Arr instances.
- **Confidence**: High
- **Sources**: [Plex 2025 Breach - WebProNews](https://www.webpronews.com/plex-suffers-second-data-breach-in-2025-reset-passwords-now/), [Plex 2022 Breach - UpGuard](https://www.upguard.com/blog/how-did-plex-get-hacked), [Plex 2025 Breach - Bitdefender](https://www.bitdefender.com/en-us/blog/hotforsecurity/plex-reset-passwords-data-breach-2025)

### Recyclarr M1 Mac Crash (Issue #454)

- **What happened**: Recyclarr consistently crashes on Apple M1 Macs with a System.AccessViolationException when running `recyclarr sync --preview`, making the tool completely unusable on that platform.
- **Root causes**: Platform-specific memory access violation in the .NET runtime on ARM64 macOS.
- **Scale/impact**: All M1 Mac users unable to use Recyclarr.
- **Lessons**: Cross-platform compatibility is a real concern for self-hosted tools. Users run diverse hardware (x86, ARM, NAS appliances) and a tool that works on one platform but crashes on another erodes trust.
- **Confidence**: High
- **Source**: [Recyclarr Issue #454](https://github.com/recyclarr/recyclarr/issues/454)

## Questionable Assumptions

1. **Assumption**: Users want a single tool to manage all their \*Arr configurations.
   - **Why questionable**: The proliferation of competing tools (Recyclarr, Profilarr, Configarr, Buildarr, Notifiarr) suggests that no single approach satisfies all users. Some prefer YAML-based CLI tools, others want GUIs, and still others want GitOps-style workflows. The market is fragmenting rather than consolidating around one solution. Running multiple tools simultaneously causes conflicts -- they "fight over your settings."
   - **Evidence status**: Medium - based on market observation and tool conflict documentation
   - **Alternative view**: Perhaps the right answer is not a single monolithic tool but a well-designed API/plugin system that integrates with users' existing workflows.

2. **Assumption**: More security features make a self-hosted tool more secure.
   - **Why questionable**: Security features add complexity. OIDC authentication requires running an identity provider (Keycloak, Authelia, etc.) -- another service to configure, update, and secure. OpenLDAP has been noted as "pretty complex" and potentially overkill for small labs with a handful of users. Running OIDC yourself means handling TLS, key rotation, database reliability, and high availability. Each additional security layer is another potential misconfiguration. As one Lobsters commenter noted, people "overthink security to the point where" it becomes impractical.
   - **Evidence status**: Medium - based on security professional guidance and community discussions
   - **Alternative view**: Instead of building complex security features, focus on secure defaults (encrypted credential storage, no default passwords, binding to localhost only) and clear documentation about threat models.

3. **Assumption**: Configuration-as-code is better for home media servers.
   - **Why questionable**: Configuration-as-code shines in environments with multiple developers, CI/CD pipelines, and frequent infrastructure changes. Home media servers typically have one operator, no CI/CD pipeline, and configurations that change infrequently after initial setup. The overhead of maintaining YAML files, version control, and sync schedules may exceed the benefit for single-user, single-instance setups. As one homelab article noted, complexity "starts simple but quietly snowballs -- you begin with one machine and a clear goal, but over time add services, hardware, and complexity."
   - **Evidence status**: Medium - strong for enterprise IaC, limited direct evidence for home media use case
   - **Alternative view**: Config-as-code becomes valuable when the user has 3+ instances or when they need disaster recovery capability. Praxrr should be honest about where its value proposition starts.

4. **Assumption**: TRaSH Guides recommendations are universally correct.
   - **Why questionable**: TRaSH Guides are developed collaboratively with \*Arr developers, which gives them authority but also creates potential groupthink. The guides optimize for a specific use case (high-quality English-language media with modern codecs) that may not match all users' needs. Users in non-English-speaking regions, those with bandwidth constraints, or those with specific hardware limitations may need different configurations. The guides acknowledge this partially but the tooling ecosystem (Recyclarr, Profilarr) is built around treating TRaSH recommendations as canonical truth.
   - **Evidence status**: Low - limited direct criticism found, mostly inference
   - **Alternative view**: Praxrr's PCD model (base ops + user ops) already addresses this partially, but the UX should make it clear that TRaSH Guides are a starting point, not the final word.

5. **Assumption**: Custom format scoring is a solvable UX problem.
   - **Why questionable**: Even *Arr developers acknowledged "Custom Formats is too complex." Users routinely have 100+ preferred words/formats with enormous permutations of scores. Debugging which regex matched takes significant time. This is inherent domain complexity that cannot be eliminated by better UI -- only managed. Adding a management layer on top does not reduce the number of decisions a user must make; it potentially increases them (now you must decide both the score AND whether to manage it in Praxrr vs. directly in the *Arr app).
   - **Evidence status**: Medium - supported by developer acknowledgment and user experience reports
   - **Alternative view**: Perhaps the answer is not better management of existing complexity but opinionated presets that reduce the number of decisions (which Praxrr's PCD system partially provides).

## Conflicts of Interest

- **TRaSH Guides ecosystem**: The guides, Recyclarr, and associated tooling form an ecosystem where each promotes the others. TRaSH Guides directs users to Recyclarr; Recyclarr is designed around TRaSH Guides' data format. New tools like Praxrr that build on TRaSH-compatible data benefit from this ecosystem but also depend on it. If TRaSH Guides changes its format, all downstream tools break simultaneously.
- **Tool developer incentives**: Open-source config management tool developers are incentivized to add features to attract contributors and users, not to simplify or reduce scope. This creates a natural bias toward feature addition over feature subtraction.
- **Community voice bias**: The users who participate in GitHub issues, Discord discussions, and Reddit threads about \*Arr configuration are power users by definition. Their feature requests do not represent the silent majority who set up TRaSH Guides manually once and never think about it again. The research objective itself acknowledges this as "power user bias."
- **Security vendor ecosystem**: Security recommendations in the homelab space are often influenced by tool vendors (VPN providers, identity platform makers, WAF sellers) who benefit from homelabbers adopting enterprise security patterns that require their products.

## Unintended Consequences

- **Consequence**: Config sync tools create a false sense of confidence.
  - **Evidence**: Profilarr issue #230 -- sync silently fails with no errors in GUI. Users believe their configurations are being managed when they are not. Prowlarr issue #912 -- sync silently fails for months.
  - **Severity**: High -- users make decisions based on the assumption that sync is working.

- **Consequence**: Automated config management discourages understanding.
  - **Evidence**: Users who adopt Recyclarr/Profilarr early may never learn how custom formats actually work. When the tool breaks (as documented in issue #318), they lack the knowledge to configure their \*Arr instances directly. This creates fragile dependency rather than empowerment.
  - **Severity**: Medium -- affects troubleshooting ability but not day-to-day operation when tools work.

- **Consequence**: Centralized API key storage creates a high-value target.
  - **Evidence**: API key security research shows that a single compromised credential store can cascade into a full-scale breach. Praxrr stores API keys for all connected \*Arr instances, indexers, and notification services. If Praxrr's database is compromised, the attacker gains control of the entire media automation stack. Threat actors harvest credentials within five minutes of exposure.
  - **Severity**: High -- complete stack compromise from a single breach point.

- **Consequence**: Tool conflicts when users run multiple config managers.
  - **Evidence**: "Do not run Recyclarr and Profilarr at the same time. They will fight over your settings. If Recyclarr sets a score to 1000 and Profilarr sets it to 2000, they will endlessly overwrite each other every hour." If Praxrr enters this market, it becomes another potential combatant in these conflicts.
  - **Severity**: Medium -- leads to configuration thrashing and unpredictable behavior.

- **Consequence**: YAML configuration as barrier to entry.
  - **Evidence**: Recyclarr requires editing YAML files where "a misplaced space indentation can crash the entire sync." This alienates non-technical users who are precisely the audience that would benefit most from simplified config management.
  - **Severity**: Medium -- Praxrr's GUI approach avoids this, but introduces its own learning curve.

## Security-Specific Critiques

### Real Threat Models for Self-Hosted Media Tools

The primary threat vectors for a tool like Praxrr are:

1. **Local network compromise**: If an attacker gains access to the local network (via compromised IoT device, exposed Docker port, or malware), they can access Praxrr and its stored API keys. Docker ignoring UFW rules is a well-documented vector for accidental exposure.
2. **Credential leakage**: API keys stored in plaintext in SQLite databases or configuration files can be exposed through backups, logs, or database corruption recovery attempts.
3. **Upstream dependency compromise**: A compromised TRaSH Guides repository or PCD source could inject malicious configurations that get synced to all connected \*Arr instances.
4. **Reverse proxy misconfiguration**: Users who expose Praxrr through a reverse proxy may misconfigure authentication, leaving the admin interface publicly accessible.

### Where Security Features Become Theater

- **OIDC for single-user deployments**: Most homelab users are the sole operator. Implementing OIDC adds complexity (running an identity provider, managing certificates, handling token refresh) for a scenario where a simple strong password suffices. The benefit is real only when sharing access with multiple users or integrating with an existing SSO stack.
- **Encryption at rest for API keys**: If the application can decrypt the keys (which it must, to use them), any attacker with access to the application's process or filesystem can also decrypt them. Encryption at rest protects against someone stealing the raw database file but not against a running application compromise.
- **Audit logging without monitoring**: Logging all API key accesses and configuration changes is useful only if someone reviews the logs. For single-user homelabs, audit logs are typically never reviewed until after an incident, at which point they serve forensic purposes rather than prevention.
- **Rate limiting on local-only services**: If Praxrr is properly deployed on a local network without internet exposure, rate limiting adds latency without meaningful security benefit.

### Actual Attack Vectors for Config Management Tools

- **Supply chain attacks**: If Praxrr's PCD repositories are compromised, malicious configurations could be pushed to all instances. This is the most concerning vector because users trust these data sources.
- **SQLite injection via PCD ops**: The append-only ops model means crafted SQL in PCD data could potentially be executed if input sanitization is insufficient.
- **API key exfiltration through backup files**: Users who back up their Praxrr data (SQLite file) and store it insecurely (cloud storage, git repos) may inadvertently expose all their API keys.
- **Container escape**: If Praxrr runs in Docker with excessive privileges (common default), a container compromise could lead to host compromise.

## Key Insights

1. **The biggest risk to Praxrr is not missing features but upstream API instability.** The Radarr v5 obfuscation change and Sonarr v4 API changes demonstrate that \*Arr maintainers will make breaking changes without consulting third-party tool developers. Any feature Praxrr builds on undocumented API behavior is a ticking time bomb. The investment priority should be resilient API integration with graceful degradation, not feature proliferation.

2. **Silent sync failures are the most dangerous failure mode.** Multiple tools (Profilarr, Prowlarr, Recyclarr) have documented cases where sync silently fails. Users trust automation to work and do not manually verify. Praxrr must invest heavily in sync verification, health checks, and proactive alerting when sync state diverges from expected state. A visible failure is always preferable to a silent one.

3. **Centralizing API keys creates a security liability that scales with adoption.** As Praxrr manages more instances and services, the impact of a single breach grows. Rather than adding more services to manage (notification providers, indexers, download clients), Praxrr should consider whether each API key it stores is genuinely necessary and implement key rotation, scoped permissions, and breach containment strategies.

4. **The target audience may be smaller than assumed.** Most *Arr users run a simple setup that TRaSH Guides covers in a one-time manual configuration. The users who genuinely benefit from config management tools are those with 3+ instances, multiple *Arr apps, or frequent configuration changes. Features should be evaluated against this actual (smaller) audience, not the theoretical total \*Arr user base.

5. **SQLite in Docker is a proven risk surface.** Praxrr uses SQLite as its primary database in Docker deployments. Multiple self-hosted applications have documented silent corruption, data loss from ungraceful shutdowns, and filesystem incompatibilities. Database integrity validation at startup and proper backup tooling should be treated as critical infrastructure, not nice-to-have features.

## Evidence Quality

- **Strong contradictions**: 5 (upstream API instability vs. reliable sync, config management overhead vs. time saved, security feature complexity vs. actual threat model, feature addition vs. user satisfaction, centralized keys vs. security)
- **Credible critiques**: 4 (\*Arr maintainers on third-party tool support, Pen Test Partners on homelab security, UX complexity of custom formats, SQLite corruption in Docker)
- **Documented failures**: 6 (Recyclarr #318, Buildarr-Radarr #20, Prowlarr #912, Vaultwarden SQLite corruption, Plex breaches 2022/2025, Recyclarr M1 crash)
- **Confidence rating**: High for the core critiques (upstream API fragility, silent sync failures, centralized credential risk), Medium for the market size and feature demand arguments

## Search Queries Executed

1. "Recyclarr problems issues complaints bugs 2024 2025"
2. "Radarr Sonarr configuration sync failures data loss problems"
3. "self-hosted media server security vulnerabilities CVE 2024 2025"
4. "\*Arr API key security risks exposure Radarr Sonarr"
5. "why not use configuration management home server complexity"
6. "TRaSH Guides criticism problems wrong recommendations Reddit"
7. "Radarr Sonarr third party tools risks breaking changes maintainers opinion"
8. "self-hosted application security audit findings homelab vulnerabilities"
9. "Profilarr Recyclarr sync issues delete custom formats unintended"
10. "home server configuration as code unnecessary overhead complexity reddit"
11. "Recyclarr deleted my custom formats accidentally overwrote reddit"
12. "Plex Radarr Sonarr API key leaked exposed security incident"
13. "self-hosted security theater OIDC authentication homelab overkill"
14. "configuration drift sync tool overwrites manual changes frustration"
15. "media automation too many tools complexity fatigue arr stack"
16. "Recyclarr breaking changes upgrade guide YAML migration frustration"
17. "Sonarr Radarr API breaking changes v4 v5 third party tools compatibility"
18. "homelab self-hosted exposed internet attack compromised docker container"
19. "Plex data breach 2022 self-hosted security lessons"
20. "Recyclarr Profilarr sync conflict overwrites user customization fight"
21. "configuration management homelab not worth it simple manual better reddit"
22. "Radarr v5 API obfuscation idempotent third party tools broken buildarr"
23. "feature creep self-hosted software too many features usability problems"
24. "Profilarr vs Recyclarr vs Configarr comparison problems limitations"
25. "homelab over-engineering mistakes unnecessary complexity regret simplify"
26. "self-hosted app stores all API keys credentials single breach compromise"
27. "Sonarr Radarr custom format scoring complexity confusing users give up"
28. "Plex 2025 second data breach security self-hosted"
29. "Prowlarr sync issues indexers not syncing Sonarr Radarr frustration"
30. "docker container self-hosted SQLite database corruption data loss"
