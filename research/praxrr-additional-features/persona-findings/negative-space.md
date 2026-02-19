# Negative Space Research: New Features for Praxrr Media Automation Config Manager

## Executive Summary

The \*Arr ecosystem suffers from three systemic blind spots that Praxrr is uniquely positioned to address: (1) a complete absence of multi-user role-based access control in configuration management tools, leaving shared households and teams without granular permissions; (2) pervasive API key and credential security gaps where secrets are stored in plain text, never rotated, and lack audit trails; and (3) a steep configuration cliff where non-technical users are excluded by YAML-first workflows, missing onboarding experiences, and zero configuration rollback capability. No existing tool in the ecosystem addresses configuration drift detection, undo/redo for profile changes, or accessibility compliance -- features that are table stakes in modern web applications.

## Undiscussed Topics

### Multi-User Access Control in Config Management Tools

- **Why it matters**: Sonarr's multi-user feature request (issue #1682) has been open since February 2017 with 133 upvotes and 59 comments, yet no configuration management tool -- Recyclarr, Buildarr, Configarr, or Profilarr -- has implemented user-level permissions for their own interfaces. Praxrr sits above the Arr stack and manages API keys, sync operations, and profile definitions, yet the conversation about who within a household or team should be able to modify configurations is entirely absent.
- **Why not discussed**: The self-hosted community assumes single-admin operation. Configuration tools are built by power users for power users, and the idea of a "viewer" or "operator" role in a config management tool has not surfaced.
- **Who would be affected**: Shared households (families running media servers), small teams managing media infrastructure, and organizations with separation-of-duty requirements.
- **Confidence**: High -- based on multiple long-standing GitHub issues and the complete absence of RBAC in any competing tool.
- **Sources**: [Sonarr Multi-User Support #1682](https://github.com/Sonarr/Sonarr/issues/1682), [Sonarr Multi-User Auth #3242](https://github.com/Sonarr/Sonarr/issues/3242), [Guest Login Feature Request](https://forums.sonarr.tv/t/guest-login-with-separate-password/35210)

### Legal and Ethical Implications of Media Automation

- **Why it matters**: The \*Arr ecosystem exists in a legal gray area. Tools automate downloading content through indexers and torrent clients, yet there is virtually no discussion in any Arr configuration tool about compliance features, content filtering for legal risk, or audit capabilities that could help users stay within legal boundaries.
- **Why not discussed**: The community has an unspoken agreement to avoid this topic. Project maintainers avoid legal entanglement by treating their tools as content-agnostic. Configuration management tools downstream from the Arr apps follow the same pattern.
- **Who would be affected**: Users in jurisdictions with strict copyright enforcement, organizations running media servers, anyone who could benefit from audit trails showing what was automated and when.
- **Confidence**: Medium -- inferred from the near-total absence of legal/compliance discussion in Arr tool forums and documentation.
- **Sources**: [EFF DMCA Overview](https://www.eff.org/issues/dmca), [DMCA Safe Harbors](https://www.justia.com/intellectual-property/copyright/docs/dmca/)

### Accessibility in the Arr Ecosystem

- **Why it matters**: No \*Arr application or configuration management tool has undergone a WCAG audit or provides accessibility documentation. Radarr has a single color-blind mode that does not work for all types of color blindness (issue #5095), and the discussion was closed as "Status: Maybe One Day." Screen reader support, keyboard navigation completeness, and high-contrast modes are entirely absent from the conversation.
- **Why not discussed**: Self-hosted tools are typically built by developers for themselves. Accessibility is seen as a "nice-to-have" rather than a requirement, especially when the user base skews toward technically proficient individuals.
- **Who would be affected**: Users with visual impairments, color blindness, motor disabilities requiring keyboard navigation, and anyone using assistive technology.
- **Confidence**: High -- directly confirmed by the Radarr color blind issue and the absence of any WCAG-related issues or documentation across all Arr tools.
- **Sources**: [Radarr Color Blind Mode #5095](https://github.com/Radarr/Radarr/issues/5095), [Theme.park Colorblind Fixes #305](https://github.com/GilbN/theme.park/issues/305)

### Non-English User Experience

- **Why it matters**: Radarr and Sonarr have no UI localization (i18n). The applications, their documentation, TRaSH Guides, Recyclarr configuration, and all community support channels are exclusively in English. Configuration management tools like Praxrr inherit this English-only assumption. Non-English speaking users must navigate complex technical concepts (custom formats, quality profiles, regex patterns) in a foreign language.
- **Why not discussed**: The dominant community is English-speaking. Forum posts asking about UI language changes receive minimal engagement. The TRaSH Guides project, which is the primary knowledge source, is entirely in English with language-specific guides only for media content preferences (e.g., German dual-language guide), not for the interface itself.
- **Who would be affected**: A significant global user base -- self-hosted media is popular worldwide, and many users in Europe, Asia, and South America struggle with English-only interfaces.
- **Confidence**: Medium -- based on sparse forum questions about language support and the complete absence of i18n infrastructure in any Arr tool.
- **Sources**: [Sonarr UI Language Question](https://forums.sonarr.tv/t/how-do-i-change-the-ui-and-sonaar-data-language-to-other-than-english/27036), [Sonarr MULTi Language #4741](https://github.com/Sonarr/Sonarr/issues/4741), [German Dual Language Guide](https://github.com/PCJones/radarr-sonarr-german-dual-language)

## Adoption Barriers

### YAML Configuration Complexity (Recyclarr/Buildarr)

- **Type**: Technical/UX
- **Impact**: Prevents non-CLI-comfortable users from adopting any Arr configuration management tool. Users who struggle with YAML syntax, indentation, and merging rules are effectively locked out.
- **Severity**: High
- **Addressable by Praxrr?**: Yes -- Praxrr already uses a web UI with a database-backed configuration model, bypassing YAML entirely.
- **Feature idea**: Position Praxrr's web UI as the primary differentiator. Add visual configuration builders, drag-and-drop profile editors, and real-time validation that eliminates the need to understand YAML syntax or CLI workflows.
- **Evidence**: Recyclarr documentation explicitly warns that merging multiple YAML files is complex, sections cannot be duplicated, and the entire file must be error-free even when syncing a single app. The existence of premade config template repositories (recyclarr/config-templates, mattiaginoble/Recyclarr-PreConfig) confirms that users struggle to write their own configurations.
- **Confidence**: High
- **Sources**: [Recyclarr Configuration](https://recyclarr.dev/reference/configuration/), [Recyclarr Config Templates](https://github.com/recyclarr/config-templates), [Recyclarr Config Examples](https://recyclarr.dev/wiki/yaml/config-examples/)

### TRaSH Guides Workflow Friction

- **Type**: UX/Technical
- **Impact**: The process of reading TRaSH Guides, understanding custom format scoring, manually configuring profiles, or setting up Recyclarr creates a multi-hour initial setup that deters new users. A Sonarr forum user described the process as "painful."
- **Severity**: High
- **Addressable by Praxrr?**: Yes -- Praxrr's PCD system already curates configuration databases. The opportunity is to make applying these configurations a one-click operation with clear explanations of what each configuration does.
- **Feature idea**: Guided "setup wizard" that walks users through TRaSH-recommended configurations with plain-English explanations of each choice, preview of what will change, and one-click application. Include a "what does this do?" tooltip system for every custom format and scoring value.
- **Evidence**: A Sonarr forum proposal to integrate TRaSH Guides directly into Sonarr received minimal developer engagement, suggesting this gap will remain unfilled by the Arr apps themselves. The proposer later discovered Profilarr as a partial solution.
- **Confidence**: High
- **Sources**: [TRaSH Guides Integration Proposal](https://forums.sonarr.tv/t/proposal-integrate-trash-guides-directly-into-sonarr/38467), [TRaSH Guides Home](https://trash-guides.info/)

### Custom Format Scoring Confusion

- **Type**: UX/Knowledge
- **Impact**: Users consistently struggle to understand the interaction between custom format scores, quality profile minimum scores, and upgrade-until scores. The scoring system is powerful but its behavior is non-obvious, leading to unintended download decisions.
- **Severity**: Medium
- **Addressable by Praxrr?**: Yes -- as the tool that manages these profiles, Praxrr could provide visualization and simulation of scoring behavior.
- **Feature idea**: A "score simulator" that lets users input example releases and see how their custom format scores would rank them, with visual explanations of why each release would or would not be downloaded. Include warnings when scoring configurations would produce unexpected behavior (e.g., blocking all releases, never upgrading past a certain quality).
- **Evidence**: Multiple Sonarr forum threads show users "still struggling" with custom format scoring, and a Radarr issue (#4666) requests prioritizing custom format scores over quality, indicating the interaction between these systems is poorly understood.
- **Confidence**: High
- **Sources**: [Custom Format Score Priority #4666](https://github.com/Radarr/Radarr/issues/4666), [Sonarr Scoring Confusion](https://forums.sonarr.tv/t/still-struggling-with-custom-format-for-quality/33657), [Sonarr Score Behavior](https://forums.sonarr.tv/t/intendet-behaviour-ignoring-custom-format-score-for-met-quality-requirement/33881)

### Arr Stack Setup Complexity

- **Type**: Technical
- **Impact**: New users face a steep learning curve to set up and configure the full \*Arr stack. Multiple guides exist (arr-stack-4-dummies, Docker compose generators) specifically to address this complexity, indicating the barrier is well-known but unsolved at the tool level.
- **Severity**: High
- **Addressable by Praxrr?**: Partially -- Praxrr cannot simplify the Arr app installation itself, but it can dramatically reduce the configuration burden once apps are running.
- **Feature idea**: "Quick start" mode that detects connected Arr instances, analyzes their current configuration state, identifies gaps or misconfigurations against best practices, and offers one-click remediation. Think of it as a "configuration health check" that new users can run immediately after connecting their first Arr instance.
- **Evidence**: The existence of projects like "arr-stack-4-dummies," multiple Docker compose generators, and Buildarr (which attempts to declaratively configure entire Arr stacks) confirms that setup complexity is a persistent barrier.
- **Confidence**: High
- **Sources**: [Arr Stack 4 Dummies](https://github.com/jtmb/arr-stack-4-dummies), [Arr Stack Docker Compose Guide](https://corelab.tech/arr-stack-docker-compose-guide/), [Buildarr](https://buildarr.github.io/)

### Tool Conflict Risk

- **Type**: Technical
- **Impact**: Running multiple configuration management tools (Recyclarr, Notifiarr, Buildarr, manual API scripts) against the same Arr instance causes unpredictable behavior. Users must "pick one sync tool and disable the others." This creates vendor lock-in anxiety and prevents users from trying new tools without fully committing.
- **Severity**: Medium
- **Addressable by Praxrr?**: Yes -- Praxrr could detect other tools modifying the same instance and warn users, or implement a "reconciliation" mode that identifies external changes.
- **Feature idea**: Configuration drift detection that identifies when an Arr instance's live configuration diverges from Praxrr's expected state, whether due to manual changes, another tool, or Arr updates. Display a diff view showing what changed and let users choose to accept, revert, or merge the external changes.
- **Confidence**: Medium
- **Sources**: [Recyclarr Guide Sync](https://trash-guides.info/Guide-Sync/), [Configarr](https://github.com/raydak-labs/configarr)

## Missing Features in the Ecosystem

### Configuration Rollback / Undo-Redo

- **What's missing**: No Arr configuration management tool provides the ability to undo a sync operation or roll back to a previous configuration state. If a sync pushes bad settings to a live Arr instance, the user must manually fix each change or restore from a full application backup.
- **Why it matters**: Configuration changes can break download behavior, scoring, and media management in ways that are not immediately obvious. Without rollback capability, users are reluctant to experiment with new configurations.
- **User demand**: Medium -- inferred from the absence of the feature rather than explicit requests, though the existence of backup tools (Backarr, servarr-backup) suggests users want safety nets.
- **Could Praxrr build this?**: Yes -- Praxrr's append-only ops model (PCD) already provides a natural undo mechanism. Extending this to track sync states and enable point-in-time rollback would be architecturally straightforward.
- **Feature idea**: "Sync snapshots" that capture the before/after state of every sync operation, with a timeline UI showing what changed and when. Users can select any snapshot and roll back the Arr instance to that configuration state. Include a "dry run" mode that shows what a sync would change without applying it.
- **Confidence**: High -- no tool provides this, confirmed through exhaustive search of Recyclarr, Buildarr, Configarr, and Profilarr feature sets.
- **Sources**: [Backarr](https://github.com/Vandekieft/backarr), [Servarr Backup](https://github.com/Zerka30/servarr-backup)

### Configuration Drift Detection

- **What's missing**: No tool monitors whether an Arr instance's live configuration matches its declared/managed state. If someone manually changes a quality profile in Radarr's UI, no tool will detect the discrepancy.
- **Why it matters**: In enterprise configuration management (Ansible, Terraform, ArgoCD), drift detection is a fundamental capability. Its absence in the Arr ecosystem means users cannot trust that their Arr instances are running the configuration they think they are.
- **User demand**: Medium -- this is a concept most Arr users have not been exposed to, but it addresses a real problem.
- **Could Praxrr build this?**: Yes -- Praxrr already syncs configurations to Arr instances via their APIs. Adding a periodic "compare" operation that fetches the live state and compares it to the managed state is a natural extension.
- **Feature idea**: A dashboard view showing each managed Arr instance with a "drift status" indicator (green = in sync, yellow = minor drift, red = significant divergence). Clicking into the drift shows a detailed diff of what changed, when it was likely changed (based on last sync), and options to reconcile.
- **Confidence**: High -- verified that no Arr configuration tool provides this, despite drift detection being standard in infrastructure-as-code tools.
- **Sources**: [Configuration Drift Detection](https://spacelift.io/blog/what-is-configuration-drift), [ArgoCD Drift](https://pipecd.dev/docs-v0.50.x/user-guide/managing-application/configuration-drift-detection/)

### Cross-Arr Feature Parity Awareness

- **What's missing**: Users frequently request that Sonarr gain features Radarr already has (availability delay, IMDB list parity, minimum availability) and vice versa. No tool tracks or visualizes these parity gaps, and configuration management tools do not warn users when a feature they configure for one Arr app is not available in another.
- **Why it matters**: Users managing both Radarr and Sonarr expect consistent behavior. When they set up a configuration pattern in one app, they assume it transfers to the other, leading to confusion when it does not.
- **User demand**: High -- multiple high-engagement Sonarr issues request Radarr feature parity.
- **Could Praxrr build this?**: Yes -- as a tool that already manages configurations across Radarr, Sonarr, and Lidarr, Praxrr is uniquely positioned to surface cross-app compatibility information.
- **Feature idea**: When creating or editing a profile in Praxrr, display compatibility badges showing which Arr apps support each feature. When syncing, clearly warn about features that will be ignored or behave differently across different Arr app types.
- **Confidence**: High
- **Sources**: [Sonarr Availability Delay #7731](https://github.com/Sonarr/Sonarr/issues/7731), [Sonarr Minimum Availability #7578](https://github.com/Sonarr/Sonarr/issues/7578), [Sonarr IMDB Lists #6412](https://github.com/Sonarr/Sonarr/issues/6412)

### Configuration Sharing and Community Profiles

- **What's missing**: There is no standardized way for users to share their custom configurations (quality profiles, custom format bundles, scoring presets) with other users. TRaSH Guides provides one curated set of recommendations, but individual users cannot easily publish or discover alternative configurations.
- **Why it matters**: Different use cases (4K HDR enthusiast, storage-constrained user, anime collector, foreign language prioritizer) require different configurations. Currently, each user must build their own from scratch or follow TRaSH Guides.
- **User demand**: Medium -- Profilarr's import/export functionality and the popularity of Recyclarr config template repositories suggest latent demand.
- **Could Praxrr build this?**: Yes -- Praxrr's PCD model could be extended to support user-contributed configuration packages with metadata (description, target use case, compatibility, ratings).
- **Feature idea**: A "configuration marketplace" or "community profiles" feature where users can browse, rate, and import complete configuration bundles (quality profiles + custom formats + scoring presets) tagged by use case. Include version tracking so users are notified when a community profile they use is updated.
- **Confidence**: Medium
- **Sources**: [Recyclarr Config Templates](https://github.com/recyclarr/config-templates), [Profilarr](https://github.com/Dictionarry-Hub/profilarr), [Profilarr Import/Export](https://github.com/gnarr/Profilarr)

### Comprehensive Onboarding Experience

- **What's missing**: No Arr configuration management tool provides a guided onboarding experience. Users are expected to read documentation, understand concepts like quality profiles and custom formats, and configure everything manually. There are no setup wizards, interactive tutorials, or progressive disclosure patterns.
- **Why it matters**: Studies show that bad onboarding causes up to 80% of users to abandon an application before they use it. The Arr ecosystem's configuration complexity makes onboarding especially critical.
- **User demand**: High -- the proliferation of step-by-step blog posts, YouTube tutorials, and simplified Docker compose projects indicates users need significantly more guidance than tools currently provide.
- **Could Praxrr build this?**: Yes -- as a web application with a full UI, Praxrr can implement modern onboarding patterns (progress bars, checklists, tooltips, contextual help).
- **Feature idea**: A first-run wizard that: (1) helps users connect their Arr instances, (2) analyzes their current configuration, (3) recommends a configuration profile based on their use case (selected from a simple questionnaire), (4) shows a preview of changes, and (5) applies the configuration. Include a progress tracker showing setup completeness.
- **Confidence**: High
- **Sources**: [User Onboarding Best Practices](https://whatfix.com/blog/user-onboarding/), [Onboarding UX Examples](https://userpilot.com/blog/onboarding-ux-examples/), [Arr Stack Config Guide](https://mafyuh.com/posts/arr-stack-config-guide/)

## Security Blind Spots

### API Key Storage in Plain Text

- **What's not protected**: Arr applications store API keys in their configuration files in plain text. Configuration management tools like Recyclarr require API keys in YAML files, also in plain text. Praxrr itself stores Arr API keys in its SQLite database. None of these tools encrypt API keys at rest.
- **Risk level**: High
- **Why overlooked**: The self-hosted community operates on the assumption that the local network is trusted. The threat model typically does not include compromised machines or malicious local actors.
- **Feature idea for Praxrr**: Implement encrypted storage for all sensitive credentials (API keys, passwords, notification tokens) using application-level encryption with a master key. Support integration with external secret managers (HashiCorp Vault, Infisical) for advanced users. At minimum, ensure API keys are never exposed in API responses, logs, or browser network traffic.
- **Confidence**: High -- directly confirmed by Radarr issues (#3890, #9397) documenting API key exposure in responses and TMDB API calls.
- **Sources**: [Radarr API Key Showing #3890](https://github.com/Radarr/Radarr/issues/3890), [Radarr V5 Obfuscation #9397](https://github.com/Radarr/Radarr/issues/9397), [Reiverr API Key Proxy #52](https://github.com/aleksilassila/reiverr/issues/52), [OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)

### No Credential Rotation or Expiry

- **What's not protected**: Arr API keys never expire and cannot be automatically rotated. There is no mechanism to detect a compromised key, no rotation schedule, and no warning when a key has been in use for an extended period.
- **Risk level**: Medium
- **Why overlooked**: API keys in the Arr ecosystem are treated as permanent installation tokens rather than security credentials. The concept of key rotation does not exist in any Arr application.
- **Feature idea for Praxrr**: Implement API key health monitoring: track when each API key was last rotated (or first configured), warn users about stale keys, and provide a guided key rotation workflow that updates the key in both the Arr instance and Praxrr simultaneously.
- **Confidence**: Medium -- inferred from the absence of rotation features in any Arr app or tool, combined with industry best practices that mandate rotation.
- **Sources**: [Secret Rotation Best Practices](https://www.groundcover.com/learn/security/secret-rotation-how-it-works-challenges-best-practices), [Credential Rotation Guide](https://www.oloid.com/blog/credential-rotation), [API Key Security Best Practices](https://www.legitsecurity.com/aspm-knowledge-base/api-key-security-best-practices)

### No Audit Trail for Configuration Changes

- **What's not protected**: Neither Radarr/Sonarr nor any configuration management tool maintains a comprehensive audit log of who changed what, when, and why. Radarr's logs track operational events (downloads, renames) but not configuration modifications. Praxrr's PCD ops are append-only but do not record user attribution.
- **Risk level**: Medium
- **Why overlooked**: Single-user assumption. If only one person uses the tool, audit trails seem unnecessary. However, as multi-user scenarios become more common and as users want to understand why their configuration is in its current state, this gap becomes significant.
- **Feature idea for Praxrr**: Add user attribution to all PCD ops and sync operations. Implement an audit log view showing a chronological history of all configuration changes, filterable by user, entity type, and Arr instance. Include "change reason" fields for significant modifications.
- **Confidence**: High -- confirmed that no Arr tool provides configuration audit trails.
- **Sources**: [Radarr Troubleshooting](https://wiki.servarr.com/radarr/troubleshooting), [Radarr System Logs](https://wiki.servarr.com/radarr/system)

### Lack of Built-In Two-Factor Authentication

- **What's not protected**: Self-hosted Arr tools typically support basic authentication (username/password) or rely on reverse proxy authentication. Native TOTP/WebAuthn 2FA is absent from most tools in the ecosystem. Users who want 2FA must set up Authelia, Authentik, or similar SSO proxies, which adds significant complexity.
- **Risk level**: Medium
- **Why overlooked**: The assumption is that reverse proxies or VPNs handle authentication. However, many users expose their services directly or through simple reverse proxies without additional authentication layers.
- **Feature idea for Praxrr**: Implement native TOTP 2FA and WebAuthn/passkey support as a built-in feature. Since Praxrr already has authentication (local auth, OIDC), adding 2FA would be a natural extension that raises the security floor without requiring external tools. Provide clear documentation for users who prefer external SSO.
- **Confidence**: Medium -- based on the proliferation of self-hosted 2FA solutions (2FAuth, Authelia) and the absence of native 2FA in Arr tools.
- **Sources**: [Authelia Self-Hosted 2FA](https://bowtieddevil.com/post/authelia-self-hosted-2fa/), [2FAuth](https://docs.2fauth.app/), [XDA Self-Hosted 2FA Server](https://www.xda-developers.com/i-built-self-hosted-2fa-server/)

### Network Exposure and Bot Scanning

- **What's not protected**: Self-hosted services exposed to the internet face constant automated scanning. Shodan and Censys catalog open ports within hours. Arr tools running on default ports with predictable URL paths are easily discoverable and targetable. No Arr configuration tool provides any network security awareness or recommendations.
- **Risk level**: High
- **Why overlooked**: Network security is considered outside the scope of application-level tools. However, Praxrr sits above the Arr stack and has visibility into which instances are reachable and how they are configured.
- **Feature idea for Praxrr**: Implement a "security posture" check that assesses connected Arr instances: are they using HTTPS? Are default ports exposed? Is authentication enabled? Are API keys rotated? Present this as a security dashboard with actionable recommendations.
- **Confidence**: Medium
- **Sources**: [5 Things Before Exposing Self-Hosted Services](https://www.xda-developers.com/things-knew-before-exposing-self-hosted-services/), [Self-Hosting Security HN Discussion](https://news.ycombinator.com/item?id=27940310), [Self-Hosted Security Best Practices](https://blog.dreamfactory.com/self-hosted-software-best-practices-for-secure-and-reliable-deployment)

## UX Blind Spots

### No Mobile-First or Responsive Design in Config Tools

- **What's missing**: While Radarr and Sonarr's web UIs have basic responsiveness, their mobile experience is so poor that multiple dedicated mobile apps (Ruddarr, Helmarr, Downloadarr, LunaSea) exist specifically to compensate. Configuration management tools (Recyclarr is CLI-only, Buildarr is CLI-only, Configarr is Docker-only) offer no mobile experience at all.
- **Impact on users**: Users cannot check or modify their configuration state from a mobile device. If a sync goes wrong while they are away from their desktop, they cannot diagnose or fix it.
- **Standard in other apps**: Virtually all modern SaaS applications and many self-hosted tools (Home Assistant, Nextcloud) provide fully responsive web interfaces.
- **Feature idea for Praxrr**: Ensure Praxrr's SvelteKit UI is fully responsive and mobile-optimized. Prioritize mobile views for status monitoring, sync operations, and quick configuration changes. Consider a PWA implementation for app-like mobile experience.
- **Confidence**: High -- directly confirmed by the Sonarr mobile UI feature request and the existence of four+ dedicated mobile companion apps.
- **Sources**: [Sonarr Mobile UI Request](https://forums.sonarr.tv/t/friendlier-mobile-ui-for-select-series-option/31851), [Ruddarr](https://ruddarr.com/), [Helmarr](https://apps.apple.com/us/app/helmarr/id1638624921), [Downloadarr](https://downloadarr.app/)

### No Progressive Disclosure or Contextual Help

- **What's missing**: Arr applications hide "advanced settings" behind a toggle, but this is the extent of progressive disclosure. There are no tooltips explaining what each setting does, no contextual help links, no "learn more" popovers, and no guided workflows for complex operations like setting up quality profiles.
- **Impact on users**: New users are overwhelmed by dense settings pages. They do not know which settings are safe to change, which are critical, or what the consequences of each choice are.
- **Standard in other apps**: Modern web applications use tooltip systems, contextual help panels, interactive tutorials, and progressive disclosure extensively (e.g., GitHub's repository settings, Vercel's deployment configuration).
- **Feature idea for Praxrr**: Implement a comprehensive contextual help system: every setting has a tooltip, complex features have "Learn more" links to inline documentation, and first-time users see guided walkthroughs of key workflows. Include a "complexity level" toggle (Beginner/Intermediate/Advanced) that controls how many options are visible.
- **Confidence**: High
- **Sources**: [Radarr Settings Wiki](https://wiki.servarr.com/radarr/settings), [TRaSH Quality Profiles Guide](https://trash-guides.info/Radarr/radarr-setup-quality-profiles/)

### No Keyboard Shortcuts or Power User Navigation

- **What's missing**: No Arr tool or configuration management tool provides keyboard shortcuts, command palette (Ctrl+K), or other power-user navigation patterns. Users must click through menus and pages for every operation.
- **Impact on users**: Power users who manage many profiles, custom formats, and instances spend excessive time on navigation. The absence of keyboard shortcuts is particularly notable given that the target audience (self-hosted enthusiasts) tends to be keyboard-oriented.
- **Standard in other apps**: Command palettes are now standard in developer tools (VS Code, GitHub, Linear, Notion). Keyboard shortcuts are expected in any productivity-oriented application.
- **Feature idea for Praxrr**: Implement a command palette (Ctrl+K) for quick navigation to any profile, custom format, instance, or action. Add keyboard shortcuts for common operations (create, save, sync, navigate between instances). Include a keyboard shortcut reference panel.
- **Confidence**: Medium -- inferred from the absence of any keyboard navigation features in Arr tools.
- **Sources**: [WCAG Keyboard Accessibility](https://developer.mozilla.org/en-US/docs/Web/Accessibility/Guides/Understanding_WCAG/Keyboard), [WebAIM Keyboard Techniques](https://webaim.org/techniques/keyboard/)

### No Real-Time Feedback During Sync Operations

- **What's missing**: When syncing configurations to Arr instances, users typically see either a loading spinner or a success/failure message. There is no streaming progress, no per-entity status, and no ability to see which specific changes are being applied in real time.
- **Impact on users**: Sync operations that affect many entities can take time. Without progress feedback, users do not know if the operation is stuck, how much remains, or which specific changes have been applied.
- **Standard in other apps**: Deployment tools (Vercel, Netlify, GitHub Actions) provide streaming logs and per-step progress indicators.
- **Feature idea for Praxrr**: Implement streaming sync progress showing each entity being updated, with success/failure status per entity, total progress percentage, and the ability to view a live log of API calls being made. After completion, show a summary diff of all changes applied.
- **Confidence**: Medium
- **Sources**: [Recyclarr Errors & Warnings](https://recyclarr.dev/guide/troubleshooting/errors/)

### No Dark Mode or Theme Customization (in Config Tools)

- **What's missing**: While third-party CSS themes exist for Radarr/Sonarr (via theme.park), configuration management tools themselves offer no theming. Users who spend significant time in these tools cannot customize their visual experience.
- **Impact on users**: Eye strain, visual preference, and consistency with the rest of their self-hosted dashboard (which may use dark themes via Homarr, Organizr, etc.).
- **Standard in other apps**: Dark mode is standard in virtually all modern web applications and developer tools.
- **Feature idea for Praxrr**: Implement system-aware dark/light mode with a manual toggle. Support a high-contrast mode for accessibility. Consider allowing custom accent colors for users who want to visually distinguish their Praxrr instance in a dashboard environment.
- **Confidence**: High
- **Sources**: [Darkerr Theme](https://userstyles.org/styles/142759/darkerr-a-darker-theme-for-sonarr-radarr), [Theme.park Sonarr](https://docs.theme-park.dev/themes/sonarr/)

## Friction Points

### No "Dry Run" Mode for Sync Operations

- **Where it occurs**: When syncing configuration changes from Praxrr/Recyclarr to Arr instances.
- **Impact**: Users cannot preview what a sync will change before it happens. They must commit to the sync and deal with any consequences after the fact.
- **Current workarounds**: Users manually compare their configuration to the Arr instance's current state, or they make a backup before syncing.
- **Feature idea**: A "dry run" or "preview" mode that fetches the current state of the target Arr instance, computes the diff against the desired configuration, and presents it as a reviewable changeset before the user confirms. Include a "what would change" summary with per-entity details.
- **Confidence**: High
- **Source**: [Recyclarr Allow Config YAML to Dictate Updates #43](https://github.com/recyclarr/recyclarr/issues/43)

### No Cross-Instance Configuration Comparison

- **Where it occurs**: When managing multiple Radarr or Sonarr instances (e.g., 1080p and 4K instances, or staging and production).
- **Impact**: Users cannot easily see how two instances differ in configuration. Identifying inconsistencies requires manually comparing settings across each instance.
- **Current workarounds**: Users maintain separate configuration files and manually diff them, or they use the same configuration for all instances without the ability to verify.
- **Feature idea**: A side-by-side comparison view that shows configuration differences between any two managed Arr instances, with the ability to selectively sync specific settings from one to another.
- **Confidence**: Medium
- **Source**: [TRaSH Sync 2 Radarr/Sonarr](https://trash-guides.info/Radarr/Tips/Sync-2-radarr-sonarr/)

### Scoring System Requires Trial and Error

- **Where it occurs**: When setting up custom format scores in quality profiles.
- **Impact**: Users do not understand how their scoring configuration will affect download decisions until they see actual results, which can take days or weeks.
- **Current workarounds**: Users follow TRaSH Guides recommendations exactly without understanding them, or they experiment and fix problems reactively.
- **Feature idea**: An interactive scoring playground where users can input sample release names and see how their configuration would score and rank them. Include historical data from past downloads to show how the current scoring would have affected previous decisions.
- **Confidence**: High
- **Source**: [Sonarr Custom Format Scoring Confusion](https://forums.sonarr.tv/t/still-struggling-with-custom-format-for-quality/33657)

### No Notification for Configuration Issues

- **Where it occurs**: When configurations have problems that do not manifest immediately (e.g., a custom format that matches nothing, a quality profile with contradictory settings, or a profile that would block all releases).
- **Impact**: Users discover configuration problems only when downloads behave unexpectedly, which can be days after the configuration was applied.
- **Current workarounds**: None -- users discover problems reactively through unexpected behavior.
- **Feature idea**: A "configuration health check" that proactively identifies potential issues: custom formats that have never matched, scoring configurations that mathematically block all releases, quality profiles with no enabled qualities, and other detectable antipatterns. Run this check after every sync and present results as actionable warnings.
- **Confidence**: Medium
- **Source**: [Radarr Custom Format Score Not Updated #9231](https://github.com/Radarr/Radarr/issues/9231)

## Silent Stakeholders

### Non-Technical Household Members

- **Who's not at the table**: Partners, children, and extended family members who use the media server but have no voice in how it is configured. The "Awesome Self-hosting for the whole family" GitHub repository explicitly addresses this gap, acknowledging that most self-hosted tools are unusable by non-technical family members.
- **Why they matter**: They are the primary consumers of the media the Arr stack manages. Their preferences (content types, quality expectations, language requirements) should inform configuration decisions but currently have no input mechanism.
- **What they might need**: A simplified "request" interface, curated configuration presets that match common household scenarios, and visual status displays that do not require technical knowledge to understand.
- **Sources**: [Awesome Self-hosting for the Whole Family](https://github.com/relink2013/Awesome-Self-hosting-for-the-whole-family), [Self-hosted Tools for Non-Technical Users](https://www.xda-developers.com/self-hosted-tools-that-feel-ready-for-non-technical-users/)

### Non-English-Speaking Users

- **Who's not at the table**: Users who are not fluent in English. The entire Arr ecosystem -- applications, documentation, community forums, TRaSH Guides, and configuration tools -- operates exclusively in English.
- **Why they matter**: Self-hosted media servers are popular worldwide. Non-English users must navigate complex technical concepts in a foreign language, raising the adoption barrier significantly.
- **What they might need**: UI localization, translated documentation, and community-contributed translations. Even partial localization of key UI elements would significantly improve accessibility.
- **Sources**: [Sonarr Language Question](https://forums.sonarr.tv/t/how-do-i-change-the-ui-and-sonaar-data-language-to-other-than-english/27036)

### Users with Disabilities

- **Who's not at the table**: Users with visual impairments, color blindness, motor disabilities, or cognitive disabilities. The Radarr color blind mode issue (#5095) demonstrates that even when accessibility concerns are raised, they are deprioritized ("Status: Maybe One Day").
- **Why they matter**: Accessibility is both an ethical imperative and a legal requirement in many jurisdictions. Self-hosted tools are not exempt from the expectation that software should be usable by everyone.
- **What they might need**: WCAG 2.1 AA compliance, screen reader support, full keyboard navigation, customizable color schemes, and reduced-motion options.
- **Sources**: [Radarr Color Blind Mode #5095](https://github.com/Radarr/Radarr/issues/5095), [WCAG 2.2 Guide](https://www.accessibility.works/blog/wcag-2-2-guide/)

### Users Transitioning from Managed Services

- **Who's not at the table**: Users leaving commercial media services (Netflix, Hulu, etc.) who want the same level of "just works" experience. They are not represented in community forums because the complexity barrier prevents them from ever getting started.
- **Why they matter**: This is the largest potential growth segment for self-hosted media. Every friction point in the Arr ecosystem is a reason for these users to stay with managed services.
- **What they might need**: Opinionated defaults that work without configuration, visual dashboards that show system status at a glance, and one-click solutions for common scenarios.

## Key Insights

1. **The YAML wall is the biggest single barrier to adoption.** Every competing tool (Recyclarr, Buildarr, Configarr) requires users to write and maintain YAML configuration files. Praxrr's web UI is its most significant competitive advantage, and this advantage should be amplified with visual builders, guided wizards, and progressive disclosure -- not merely maintained.

2. **Security is discussed in abstract terms but never implemented concretely.** The self-hosted community talks about "securing your services" at the network level (reverse proxies, VPNs, firewalls) but ignores application-level security features like encrypted credential storage, API key rotation, audit trails, and built-in 2FA. Praxrr has an opportunity to set a new standard for security in self-hosted tools.

3. **Configuration drift is the silent failure mode.** No tool in the ecosystem detects when an Arr instance's live state diverges from its managed configuration. Users discover drift only through unexpected behavior (wrong downloads, missed upgrades). Implementing drift detection would be genuinely novel in this space and would directly address a class of problems that users experience but cannot currently diagnose.

4. **The ecosystem systematically excludes three user segments**: non-technical household members who consume the media, non-English speakers who cannot navigate English-only interfaces, and users with disabilities who encounter no accessibility accommodations. Addressing even one of these segments would expand Praxrr's addressable user base significantly.

5. **No tool provides a "safety net" for configuration changes.** The absence of dry-run mode, rollback capability, and configuration health checks means that every sync operation is an irreversible, high-stakes action. This discourages experimentation and locks users into their current configurations even when better options exist.

## Evidence Quality

- **Direct evidence of gaps**: 18 (confirmed through GitHub issues, forum posts, tool documentation, and feature absence verification)
- **Inferred absences**: 7 (gaps identified through the absence of features that are standard in adjacent domains like infrastructure-as-code, modern web applications, and enterprise configuration management)
- **Confidence rating**: High overall -- the majority of findings are corroborated by multiple sources and confirmed through direct examination of existing tools' feature sets.

## Search Queries Executed

1. "Radarr Sonarr missing features users want 2025 2026"
2. "Recyclarr adoption barriers why not use problems"
3. "self-hosted media server security blind spots vulnerabilities"
4. "TRaSH Guides workflow friction problems difficulty"
5. "Arr ecosystem accessibility issues UI problems"
6. "Radarr Sonarr UI usability complaints difficult to use reddit"
7. "self-hosted application security features missing API key management"
8. "media automation configuration sharing barriers community profiles"
9. "home server management UX gaps onboarding new users"
10. "Recyclarr issues YAML configuration difficult complex reddit"
11. "Radarr Sonarr feature request github most requested 2024 2025"
12. "self-hosted apps credential rotation secret management best practices"
13. "Sonarr Radarr mobile responsive design complaints"
14. "Arr stack beginner overwhelming setup complexity problems"
15. "Radarr Sonarr audit log tracking changes who changed what"
16. "self-hosted application RBAC role based access control multi-user"
17. "Radarr Sonarr configuration backup restore version control git"
18. "self-hosted media server legal risks DMCA copyright automation"
19. "Recyclarr Buildarr Notifiarr comparison alternatives limitations"
20. "self-hosted web application WCAG accessibility screen reader keyboard navigation"
21. "Sonarr Radarr multi-user permissions shared household family"
22. "Prowlarr Lidarr Readarr cross-app sync missing integration"
23. "self-hosted dashboard dark patterns non-technical users confusion"
24. "Radarr Sonarr internationalization i18n non-english language support"
25. "self-hosted application undo redo configuration changes rollback"
26. "custom format scoring confusing complex Radarr Sonarr help understand"
27. "self-hosted media automation non-technical wife family partner usability"
28. "Radarr Sonarr API key exposed security vulnerability plain text"
29. "Profilarr configuration sharing export import Radarr Sonarr profiles"
30. "self-hosted application configuration drift detection sync monitoring"
31. "Radarr Sonarr dark mode theme accessibility color blind"
32. "self-hosted application two factor authentication 2FA TOTP implementation"
33. "Radarr Sonarr configuration complexity too many options settings overwhelm"
