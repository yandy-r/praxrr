# Journalistic Research: New Features for Praxrr Media Automation Config Manager

## Executive Summary

The *Arr ecosystem in early 2026 is experiencing a tool proliferation wave: Recyclarr (CLI/YAML, v7.5.2), Profilarr (web GUI, V2 in development), Configarr (Kubernetes-native, v1.21.0), and Notifiarr (Discord-centric notifications with TRaSH sync) all compete in the configuration management space, yet none offers a unified, security-conscious, multi-Arr configuration management platform with audit trails, RBAC, and GitOps-style drift detection. Meanwhile, the autobrr team is building a ground-up *Arr alternative, Sonarr v5 is 85% complete on its milestone, Jellyfin has overtaken Plex in the self-hosted space, and AI/MCP integrations are emerging as the next frontier. The biggest user pain points remain multi-instance configuration complexity, Lidarr's music automation limitations, security of API key management, and the lack of visual diff/preview tooling across all config management tools.

---

## Current State of the \*Arr Ecosystem

### Radarr

- **Current version/status**: Radarr v5 (stable), actively maintained on .NET 6+
- **Recent changes**: API V5 introduced password/API key obfuscation in responses to prevent credential leakage. Smart change detection implemented -- connections, indexers, and download clients are no longer re-tested when saved with identical settings. Fixed qBittorrent login API success check. Set known networks to RFC 1918 ranges during startup.
- **Notable direction**: The obfuscation vs. config-management tension (GitHub issue #9397) is significant for Praxrr -- tools like Buildarr requested un-obfuscation to enable idempotent configuration, but Radarr maintained the security posture and instead improved server-side change detection.
- **Confidence**: High -- based on official GitHub releases and issue tracker.
- **Source**: [Radarr GitHub Releases](https://github.com/Radarr/Radarr/releases), [Radarr Issue #9397](https://github.com/Radarr/Radarr/issues/9397)

### Sonarr

- **Current version/status**: Sonarr v4.0.16.2944 (stable, released November 5, 2025). Sonarr v5 is in active development with an 85% complete milestone (17 of 20 issues closed as of Feb 2026).
- **Recent changes**: V4 is the current stable release with regular maintenance updates. V5 development branch is active.
- **V5 planned features**: The remaining 3 open issues focus on metadata enhancements: (1) "{Season Title}" renaming token, (2) DVD ordering from TVDB (open since 2014), (3) TVDB data in other languages (open since 2015). All three relate to internationalization and metadata flexibility.
- **Community proposal**: A forum proposal to integrate TRaSH Guides directly into Sonarr received no developer response and was auto-closed after 60 days, indicating the Sonarr team prefers to keep TRaSH Guide integration external.
- **Confidence**: High -- based on official GitHub milestone and release data.
- **Source**: [Sonarr GitHub Releases](https://github.com/Sonarr/Sonarr/releases), [Sonarr v5.0 Milestone](https://github.com/Sonarr/Sonarr/milestone/4), [Sonarr Forum TRaSH Proposal](https://forums.sonarr.tv/t/proposal-integrate-trash-guides-directly-into-sonarr/38467)

### Prowlarr

- **Current version/status**: Actively maintained indexer manager/proxy for the \*Arr stack.
- **Recent changes**: Migrated SQLite to SourceGear.sqlite3 (requires GLIBC 2.29+, dropped support for Debian 10, Synology DSM, Ubuntu 18.04). Focus on API improvements and compatibility enhancements.
- **Key role**: Centralized indexer management -- configure indexers once, sync to all \*Arr apps. Eliminates per-app indexer configuration.
- **2026 challenge**: Cloudflare "Verify you are human" challenges blocking public indexers. FlareSolverr emerged as a proxy solution to solve these challenges automatically.
- **Confidence**: Medium -- based on GitHub and wiki documentation but limited direct changelog access.
- **Source**: [Prowlarr GitHub](https://github.com/Prowlarr/Prowlarr), [Prowlarr Releases](https://github.com/Prowlarr/Prowlarr/releases)

### Lidarr

- **Current version/status**: Active but significantly behind Radarr/Sonarr in maturity.
- **Major pain points**: (1) Album-centric workflow forces full album downloads -- individual tracks cannot be downloaded unless released as singles. (2) MusicBrainz metadata server instability and schema-breaking changes. (3) Manual import track number mapping failures. (4) Classical music metadata is unreliable or absent. (5) Albums sometimes import incompletely, downloading all tracks but importing only some.
- **Fundamental limitation**: Music metadata complexity far exceeds video -- the same track can exist across dozens of MusicBrainz releases (original, remaster, compilation, single, live, acoustic). This makes configuration profiles inherently harder.
- **Community sentiment**: "Self-hosted music still sucks in 2025" is the prevailing assessment. The \*Arr ecosystem perfected video automation but music remains stuck with album-centric workflows mismatched with modern track-centric consumption.
- **Confidence**: High -- corroborated by multiple sources including blog posts, GitHub issues, and wiki documentation.
- **Source**: [Lidarr FAQ](https://wiki.servarr.com/lidarr/faq), [Self-Hosted Music Still Sucks in 2025](https://www.joekarlsson.com/2025/06/self-hosted-music-still-sucks-in-2025/), [Lidarr GitHub Issues](https://github.com/Lidarr/Lidarr/issues/5515)

### Readarr & Whisparr

- **Status**: Both remain niche members of the \*Arr family. Readarr manages ebooks and audiobooks. Whisparr manages adult content.
- **Development pace**: Lower velocity than Radarr/Sonarr but maintained.
- **Configarr support**: Experimental support for both Readarr, Lidarr, and Whisparr has been added in Configarr, indicating growing demand for config management across all Arr types.
- **Confidence**: Medium -- limited direct source data available.
- **Source**: [Readarr Guide 2025](https://help.rapidseedbox.com/en/articles/7199064-getting-started-with-readarr-2025-update), [Configarr GitHub](https://github.com/raydak-labs/configarr)

---

## Key Players

### TRaSH (TRaSH Guides)

- **Role**: Community curator of quality profiles, custom formats, and configuration recommendations for Radarr/Sonarr.
- **Contribution**: Established the canonical "recommended settings" that nearly all config management tools synchronize. The TRaSH Guides are the de facto standard for media quality optimization.
- **Recent activity**: Active maintenance of custom format collections, quality definitions, and setup guides. Endorses Recyclarr as the primary sync tool. Also integrates with Notifiarr, Configarr, and Profilarr.
- **Significance for Praxrr**: TRaSH Guides compatibility is table stakes for any config management tool in this ecosystem.
- **Source**: [TRaSH Guides](https://trash-guides.info/Guide-Sync/), [TRaSH Guides Custom Formats Collection](https://trash-guides.info/Radarr/Radarr-collection-of-custom-formats/)

### Recyclarr Maintainers

- **Role**: Developers of the most established CLI-based TRaSH Guide sync tool.
- **Contribution**: Recyclarr v7.5.2 (latest, Jan 27, 2026) -- the mature, YAML-driven option. 17+ pre-built configuration templates. Multi-platform support (Docker, Windows, macOS, Linux, Unraid).
- **Recent activity**: Quality profile auto-repair feature, signal interrupt support, includes subdirectory for templates, Homebrew installation support.
- **Source**: [Recyclarr GitHub](https://github.com/recyclarr/recyclarr), [Recyclarr Website](https://recyclarr.dev/)

### Dictionarry-Hub / Profilarr Team

- **Role**: Developers of Profilarr, a web GUI-based configuration management platform.
- **Contribution**: Git-backed configuration database, visual diff preview before sync, OSQL (append-only SQL operations) for version control, web-based UI for managing quality profiles and custom formats.
- **Recent activity**: V2 under heavy development (NOT production-ready). V1 remains the recommended version. Tech stack: TypeScript (62.2%), Svelte (31.5%), C# (2.8%), Deno 2.x.
- **Significance for Praxrr**: Profilarr V2 and Praxrr V2 share remarkably similar tech stacks (SvelteKit, Deno, SQLite, append-only ops). This makes Profilarr V2 the closest direct competitor. Understanding its feature gaps and user feedback is critical.
- **Confidence**: High -- based on direct GitHub repository analysis.
- **Source**: [Profilarr GitHub](https://github.com/Dictionarry-Hub/profilarr)

### raydak-labs / Configarr Team

- **Role**: Developers of Configarr, a Kubernetes/Docker-native TRaSH sync tool.
- **Contribution**: Full TRaSH Guide support + custom user configs. Regional/language-specific format support (e.g., German dual-language). Native Kubernetes CronJob support. YAML config with !secret, !env, !file tags.
- **Recent activity**: v1.21.0 (Feb 2026), 542 GitHub stars, 55 releases, 15 contributors. AGPL-3.0 licensed.
- **Key differentiator**: Broadest format support beyond TRaSH Guides -- especially for non-English markets.
- **Source**: [Configarr GitHub](https://github.com/raydak-labs/configarr), [Configarr Comparison](https://configarr.de/docs/comparison/)

### Notifiarr Team

- **Role**: Developers of Notifiarr, a notification aggregation platform with TRaSH Guide sync capabilities.
- **Contribution**: Discord-centric notification system, system health monitoring, TRaSH Guide sync (Patron feature), backup corruption checks, media request management.
- **Recent activity**: Active development with regular releases. Integration with Sonarr, Radarr, Lidarr, NZBGet, and other tools.
- **Business model**: Freemium with Patron-gated features (including TRaSH sync).
- **Source**: [Notifiarr](https://notifiarr.com/), [Notifiarr Wiki](https://notifiarr.wiki/), [Notifiarr GitHub](https://github.com/Notifiarr/notifiarr)

### autobrr Team

- **Role**: Building a ground-up \*Arr alternative focused on torrent automation.
- **Contribution**: Community feedback discussions reveal a comprehensive feature wishlist for the next generation of media automation. Their community feedback repository is a goldmine for understanding unmet needs.
- **Recent activity**: Active community discussion with 60+ votes on multiple edition support, 39+ on multi-language, 31+ on pre-import media analysis.
- **Significance**: Represents where the ecosystem may be heading. Their feature requests illuminate what current \*Arr apps lack.
- **Source**: [autobrr Community Feedback](https://github.com/autobrr/community-feedback/discussions/2), [autobrr GitHub](https://github.com/autobrr/autobrr)

### Buildarr Developer (Callum027)

- **Role**: Developer of Buildarr, an idempotent \*Arr stack configuration tool.
- **Contribution**: Python-based, plugin architecture, focuses on declarative configuration with idempotent updates. Supports TRaSH Guides integration. Positioned as improvement over Flemmarr.
- **Key insight**: Filed Radarr issue #9397 requesting un-obfuscation of API keys for config management tools, revealing the tension between security and configuration management in the ecosystem.
- **Source**: [Buildarr GitHub](https://github.com/buildarr/buildarr), [Buildarr Website](https://buildarr.github.io/)

### ElfHosted

- **Role**: Managed hosting platform for self-hosted apps including the full \*Arr stack.
- **Contribution**: Kubernetes-based PaaS using GitOps and SRE principles. Provides the entire \*Arr stack as a managed service. 5-star Trustpilot rating (Jan 2026).
- **Significance**: Represents the "hosting-as-a-service" trend where users want the \*Arr experience without infrastructure management. Configuration management tools that integrate well with managed platforms have a growing addressable market.
- **Source**: [ElfHosted](https://docs.elfhosted.com/), [ElfHosted Store](https://store.elfhosted.com/)

### Seerr Team (Overseerr + Jellyseerr merger)

- **Role**: Maintainers of the unified media request platform.
- **Contribution**: Overseerr and Jellyseerr teams merged into "Seerr" -- one shared codebase supporting Plex, Jellyfin, and Emby with Sonarr/Radarr integration.
- **Significance**: Shows ecosystem consolidation trend. Request management is a complement to configuration management.
- **Source**: [Seerr GitHub](https://github.com/seerr-team/seerr), [Seerr Release Blog](https://docs.seerr.dev/blog/seerr-release)

---

## Competitive Landscape

### Recyclarr

- **Features**: CLI-based TRaSH Guide sync to Radarr/Sonarr. YAML configuration files. 17+ pre-built templates. Quality profile auto-repair. Multi-instance support. Cross-platform (Docker, Windows, macOS, Linux, Unraid, Homebrew).
- **Limitations**: No web GUI. No visual diff/preview. Requires YAML syntax knowledge. No support for custom user formats beyond TRaSH Guides. No Lidarr/Readarr/Whisparr support. No built-in authentication or access control.
- **User sentiment**: Preferred by power users who value precision and lightweight footprint. Described as "the scalpel" -- allows integer-level score overrides. Seen as "set it and forget it" via cron scheduling.
- **Current version**: v7.5.2 (Jan 27, 2026)
- **Confidence**: High
- **Source**: [Recyclarr GitHub](https://github.com/recyclarr/recyclarr), [Recyclarr Website](https://recyclarr.dev/)

### Profilarr (Dictionarry-Hub)

- **Features**: Web-based GUI. Git-backed configuration database. Visual diff preview before sync. OSQL (append-only SQL) for audit history. Reusable regex components. Built-in testing for regex patterns. OIDC/SSO authentication support. Multi-instance management via dropdown.
- **Limitations**: V2 NOT production-ready (in heavy development). V1 is simpler (import/export only). Less granular control than Recyclarr -- more "all or nothing" with profile subscriptions. Limited to Radarr/Sonarr.
- **User sentiment**: Praised for visual approach and ease of use. Described as "the more approachable, user-friendly on-ramp." The diff preview feature is frequently highlighted as a key differentiator.
- **Significance for Praxrr**: Profilarr V2 is architecturally the closest competitor to Praxrr. Both use SvelteKit, Deno, SQLite, and append-only ops. Praxrr's broader Arr support (Lidarr metadata profiles) and existing production features (upgrade engine, rename processor, job queue, notification system) give it advantages if V2 ships first.
- **Confidence**: High
- **Source**: [Profilarr GitHub](https://github.com/Dictionarry-Hub/profilarr), [Profilarr vs Recyclarr](https://corelab.tech/profilarr-vs-trash/)

### Configarr

- **Features**: TRaSH Guide sync + custom user configs. Kubernetes CronJob native. Docker and bare metal support. Recyclarr template compatibility. Regional/language-specific format support. YAML config with !secret, !env, !file tags. Experimental Whisparr, Readarr, Lidarr support.
- **Limitations**: No web GUI. Configuration-as-code approach (YAML files). No visual preview. No built-in authentication. Limited to scheduled sync jobs.
- **User sentiment**: Favored by Kubernetes operators and those with non-English media libraries. The broadest Arr app support of any config sync tool.
- **Differentiator**: The only tool with official Kubernetes support and non-English custom format specialization.
- **Current version**: v1.21.0 (Feb 2026), 542 GitHub stars
- **Confidence**: High
- **Source**: [Configarr GitHub](https://github.com/raydak-labs/configarr), [Configarr Comparison](https://configarr.de/docs/comparison/)

### Notifiarr

- **Features**: Discord-centric notification aggregation. System health monitoring (CPU, memory, SMART, IPMI, RAID). TRaSH Guide sync (Patron feature). Backup corruption checks. Media request management via Discord. Script/command triggering from Discord.
- **Limitations**: Freemium model -- TRaSH sync is a paid Patron feature. Discord-first design may not suit all users. Not a standalone config management tool -- notifications and monitoring are the primary focus. Requires Notifiarr client installation.
- **User sentiment**: Valued for its notification aggregation and health monitoring. TRaSH sync is seen as a convenience add-on rather than the primary draw.
- **Differentiator**: The only tool combining notification management, system monitoring, and configuration sync in one platform.
- **Confidence**: High
- **Source**: [Notifiarr](https://notifiarr.com/), [Notifiarr Wiki](https://notifiarr.wiki/)

### Buildarr

- **Features**: Python-based, plugin architecture. Declarative configuration with idempotent updates. TRaSH Guide integration. Prowlarr plugin available. Designed for automated deployment.
- **Limitations**: Lower adoption compared to Recyclarr. Python dependency. Plugin ecosystem still growing.
- **Differentiator**: Idempotent configuration -- only makes changes when needed. Plugin architecture allows extending to new Arr apps.
- **Confidence**: Medium
- **Source**: [Buildarr GitHub](https://github.com/buildarr/buildarr), [Buildarr Website](https://buildarr.github.io/)

### Ecosystem Helper Tools

- **Cleanuparr** (v2.6.2, Feb 2026): Automated cleanup of stalled/blocked downloads. Strike-based removal. Replacement search triggering. Hardlink-aware. Seeding ratio enforcement.
- **Decluttarr**: Download queue management for multiple Arr instances. V2 introduced YAML config with multi-instance support.
- **Maintainerr**: Library lifecycle management -- auto-unmonitor/remove media based on rules. Integrates with Seerr for request clearing. Tautulli integration for usage-based decisions.
- **Managarr**: TUI/CLI for managing all Servarr instances.
- **Toolbarr**: SQLite database repair and problem fixing for Arr apps.
- **Source**: [Cleanuparr GitHub](https://github.com/Cleanuparr/Cleanuparr), [Maintainerr](https://maintainerr.info/)

---

## Latest User Demands

### Most Requested Features (from autobrr community feedback and GitHub issues)

1. **Multiple Editions/Versions Support** (60+ votes)
   - **Description**: Single app managing different cuts, resolutions, and language editions without running separate instances.
   - **Demand level**: High
   - **Platform**: autobrr community feedback, Reddit
   - **Confidence**: High
   - **Source**: [autobrr Discussion #2](https://github.com/autobrr/community-feedback/discussions/2)

2. **Multi-Language/Dubbed Content Support** (39+ votes)
   - **Description**: Better handling of dubbed content, regional titles, simultaneous English and localized title search.
   - **Demand level**: High
   - **Platform**: autobrr community feedback, Sonarr v5 milestone
   - **Confidence**: High
   - **Source**: [autobrr Discussion #2](https://github.com/autobrr/community-feedback/discussions/2), [Sonarr v5 Milestone](https://github.com/Sonarr/Sonarr/milestone/4)

3. **Visual Diff/Preview Before Sync** (widespread)
   - **Description**: Show users exactly what configuration changes will be applied before pushing to Arr instances.
   - **Demand level**: High
   - **Platform**: Profilarr marketing, community discussions
   - **Confidence**: High -- Profilarr's diff feature is consistently highlighted as its key selling point.
   - **Source**: [Profilarr vs Recyclarr](https://corelab.tech/profilarr-vs-trash/)

4. **Pre-Import Media Analysis** (31+ votes)
   - **Description**: Run ffprobe/mediainfo before import to capture codec, audio, and resolution data from releases.
   - **Demand level**: Medium-High
   - **Platform**: autobrr community feedback
   - **Confidence**: High
   - **Source**: [autobrr Discussion #2](https://github.com/autobrr/community-feedback/discussions/2)

5. **OIDC/SSO Authentication** (recurring)
   - **Description**: Proper multi-user support with enterprise-grade identity providers. Currently blocked by tracker concerns in Sonarr/Radarr.
   - **Demand level**: Medium-High
   - **Platform**: Sonarr GitHub issues, self-hosted community
   - **Context**: Multiple private trackers threatened to block \*Arr apps if multi-user support was added. Users continue requesting this despite tracker opposition.
   - **Confidence**: High
   - **Source**: [Sonarr OIDC Issue](https://github.com/Sonarr/Sonarr/issues/7578)

6. **Frontend for Lists/Discovery** (Sonarr #5481)
   - **Description**: No frontend/UI exists to browse added lists. Lists are currently all-or-nothing (auto-add only).
   - **Demand level**: Medium
   - **Platform**: Sonarr GitHub issues
   - **Confidence**: High
   - **Source**: [Sonarr Issue #5481](https://github.com/Sonarr/Sonarr/issues/5481)

7. **Availability Delay** (Sonarr #7731)
   - **Description**: Control over how many days before/after air date to start grabbing content, similar to Radarr's existing feature.
   - **Demand level**: Medium
   - **Platform**: Sonarr GitHub issues
   - **Confidence**: High
   - **Source**: [Sonarr Issue #7731](https://github.com/Sonarr/Sonarr/issues/7731)

---

## Community Pain Points

### Multi-Instance Configuration Complexity

- **Description**: Running separate Radarr instances for 4K and 1080p, or separate Sonarr instances for different quality tiers, requires duplicating and maintaining configuration across instances. No unified view exists to manage configuration drift.
- **Frequency**: Very Common -- nearly every power user runs multiple instances.
- **Current workarounds**: TRaSH Guides' "Sync 2 Radarr/Sonarr" guide, Profilarr multi-instance support, Recyclarr YAML paths, manual duplication.
- **Praxrr opportunity**: Centralized multi-instance configuration with drift detection is a clear differentiator.
- **Confidence**: High
- **Source**: [TRaSH Sync Guide](https://trash-guides.info/Radarr/Tips/Sync-2-radarr-sonarr/), [Overseerr Multi-Instance Issue](https://github.com/sct/overseerr/issues/3615)

### Tool Conflict / "Do Not Run Together" Problem

- **Description**: Running Recyclarr and Profilarr simultaneously causes an endless overwrite loop as each tool pushes its own version of settings. Users must choose one tool and stick with it.
- **Frequency**: Common enough to warrant explicit warnings in documentation.
- **Current workarounds**: Pick one tool. No standard for declaring "this instance is managed by X."
- **Praxrr opportunity**: Implement instance ownership/locking to prevent conflicts with other tools.
- **Confidence**: High
- **Source**: [Profilarr vs Recyclarr](https://corelab.tech/profilarr-vs-trash/)

### API Key Security Exposure

- **Description**: 90% of users running Arr-stack scripts may be exposing API keys to unauthorized access. API keys are passed in URLs, stored in plain text configs, and sometimes visible in browser-based tools. Radarr V5 began obfuscating API keys in responses, but the underlying exposure risk remains.
- **Frequency**: Common -- architectural issue in the ecosystem.
- **Current workarounds**: VPN access (WireGuard), reverse proxy with authentication (Authentik, Authelia), network isolation. Official recommendation: never expose Arr apps directly to the internet.
- **Praxrr opportunity**: Secure API key storage with encryption at rest, key rotation reminders, and audit logging of key usage.
- **Confidence**: High
- **Source**: [Radarr Issue #9397](https://github.com/Radarr/Radarr/issues/9397), [Reiverr API Key Issue](https://github.com/aleksilassila/reiverr/issues/52), [Arr Stack Security Guide](https://www.blog.brightcoding.dev/2025/10/21/ultimate-guide-to-arr-stack-automation-scripts-2024-boost-your-media-server-security-efficiency/)

### Lidarr Music Automation Gaps

- **Description**: Music automation fundamentally lags behind video. Album-centric workflows, MusicBrainz instability, incomplete imports, and classical music metadata absence make Lidarr configuration a "nightmare."
- **Frequency**: Common among users who try to automate music alongside video.
- **Current workarounds**: Manual curation, accept album-only downloads, use alternative tools (Beets, Plexamp).
- **Praxrr opportunity**: If Praxrr can provide better Lidarr configuration management (metadata profiles, quality definitions for music), it addresses a significant gap. However, the fundamental limitations are in Lidarr itself, not configuration tooling.
- **Confidence**: High
- **Source**: [Lidarr FAQ](https://wiki.servarr.com/lidarr/faq), [Self-Hosted Music Still Sucks in 2025](https://www.joekarlsson.com/2025/06/self-hosted-music-still-sucks-in-2025/)

### Cloudflare Challenge Blocking

- **Description**: Many public indexers are behind Cloudflare "Verify you are human" screens. Prowlarr sees these sites as "Down" without intervention.
- **Frequency**: Increasingly common in 2026.
- **Current workarounds**: FlareSolverr proxy to solve Cloudflare challenges.
- **Praxrr relevance**: Low -- this is a Prowlarr/indexer issue, not a configuration management issue.
- **Confidence**: Medium
- **Source**: [The Ultimate Arr Stack Compose Guide (2026)](https://corelab.tech/arr-stack-docker-compose-guide/)

---

## Emerging Trends

### AI/MCP Integration with \*Arr Apps

- **Description**: Multiple MCP (Model Context Protocol) servers have been built for Radarr/Sonarr, enabling AI assistants like Claude to interact with media libraries through natural language queries. At least 3 independent MCP servers exist: Berry Kuipers' Radarr/Sonarr server, the Arr Assistant, and a comprehensive multi-Arr server supporting Sonarr, Radarr, Lidarr, Readarr, and Prowlarr.
- **Evidence**: Active GitHub repositories, integration with Claude Desktop and MCP-compatible clients. Natural language queries for searching, filtering, and managing media.
- **Momentum**: Growing -- part of the broader AI agent ecosystem exploding in 2025-2026.
- **Praxrr opportunity**: An MCP server for Praxrr could enable AI-assisted configuration management, natural language profile creation, and intelligent recommendations.
- **Confidence**: Medium -- emerging trend with growing but still niche adoption.
- **Source**: [Radarr Sonarr MCP](https://mcpmarket.com/es/server/radarr-sonarr), [MCP Arr Server](https://github.com/aplaceforallmystuff/mcp-arr), [Arr Assistant](https://www.pulsemcp.com/servers/omniwaifu-arr-assistant)

### Jellyfin Dominance Over Plex

- **Description**: Jellyfin has "definitively won the media server wars" as Plex's monetization pushes users to open-source alternatives. The 2025 plugin ecosystem explosion, especially hardware transcoding and metadata providers, closed the feature gap.
- **Evidence**: Multiple 2025-2026 homelab guides cite Jellyfin as the default. ElfHosted and other platforms lead with Jellyfin support.
- **Momentum**: Growing strongly.
- **Praxrr relevance**: Indirect -- but indicates the self-hosted media audience is growing and increasingly comfortable with open-source, self-managed tooling.
- **Confidence**: High
- **Source**: [The 2026 Homelab Stack](https://blog.elest.io/the-2026-homelab-stack-what-self-hosters-are-actually-running-this-year/)

### Authentik as the Self-Hosted SSO Standard

- **Description**: Authentik has become the default self-hosted identity provider, replacing Keycloak for many users. 2025.10 release added Single Logout support. Dropped Redis dependency. Supports OIDC, SAML, LDAP, RADIUS, SCIM.
- **Evidence**: Featured in 2026 homelab stack guides. Enterprise deployments replacing Okta/Entra. Active development with frequent releases.
- **Momentum**: Growing -- becoming standard infrastructure for self-hosted environments.
- **Praxrr opportunity**: Deep Authentik integration (OIDC, RBAC via claims) would align with where the self-hosted ecosystem is heading.
- **Confidence**: High
- **Source**: [Authentik 2025.10 Release](https://goauthentik.io/blog/2025-10-28-authentik-version-2025-10/), [Authelia vs Authentik 2025](https://www.houseoffoss.com/post/authelia-vs-authentik-which-self-hosted-identity-provider-is-better-in-2025)

### GitOps and Configuration-as-Code

- **Description**: The broader infrastructure world has fully embraced GitOps -- using Git as the single source of truth for declarative configuration. In 2025, this has shifted from "nice-to-have" to "core engineering practice." Configarr and Profilarr V2 both adopt Git-backed configuration approaches.
- **Evidence**: Industry-wide trend documented extensively. Profilarr uses OSQL (append-only SQL) for Git-native version control. Configarr uses YAML. ElfHosted uses GitOps.
- **Momentum**: Mature and growing.
- **Praxrr opportunity**: Praxrr's PCD (Praxrr Config Database) with append-only ops is already a GitOps-compatible approach. Exposing this as a first-class feature (export/import, version history, rollback) would align with industry trends.
- **Confidence**: High
- **Source**: [GitOps in 2025 CNCF](https://www.cncf.io/blog/2025/06/09/gitops-in-2025-from-old-school-updates-to-the-modern-way/), [IaC 2025](https://blog.madrigan.com/en/blog/202512061342/)

### autobrr's Ground-Up \*Arr Alternative

- **Description**: The autobrr team is building a next-generation \*Arr alternative from scratch, incorporating community feedback. Key planned features: unified app (Movies + TV), multiple editions/versions in one instance, multi-language support, PostgreSQL/SQLite database choice, OIDC/SSO, plugin architecture, subtitle automation.
- **Evidence**: Active community feedback discussion with hundreds of votes across features.
- **Momentum**: Early stage but well-funded by community interest.
- **Praxrr opportunity**: If autobrr ships a new Arr platform, Praxrr would need to support it alongside existing apps. The requested features also indicate where the ecosystem is heading.
- **Confidence**: Medium -- project is in planning/early development phase.
- **Source**: [autobrr Community Feedback](https://github.com/autobrr/community-feedback/discussions/2)

### Ecosystem Consolidation

- **Description**: Multiple consolidation events: Overseerr + Jellyseerr merged into Seerr. Tools like Reiverr combine Jellyfin + TMDB + Radarr + Sonarr into unified UIs. The community is fatigued by managing 10+ separate services.
- **Evidence**: Seerr merger announcement. Multiple "all-in-one" projects emerging. Community sentiment favoring fewer, better-integrated tools.
- **Momentum**: Growing.
- **Praxrr opportunity**: A unified configuration management layer that reduces the number of tools users need to manage is well-positioned in this trend.
- **Confidence**: Medium -- consolidation is happening but fragmented.
- **Source**: [Seerr Release](https://docs.seerr.dev/blog/seerr-release), [awesome-arr](https://github.com/Ravencentric/awesome-arr)

### Local AI for Homelabs

- **Description**: Ollama has made running local language models trivially easy. Homelabbers are integrating AI into everything -- from media recommendations (Recommendarr) to subtitle generation. A used office PC with 32GB RAM can run capable 7B-13B parameter models.
- **Evidence**: Featured in 2026 homelab stack guides. Multiple AI-powered media tools emerging.
- **Momentum**: Rapidly growing.
- **Praxrr opportunity**: AI-assisted configuration recommendations, intelligent custom format suggestions, natural language profile creation.
- **Confidence**: Medium -- trend is clear but specific media config use cases are nascent.
- **Source**: [The 2026 Homelab Stack](https://blog.elest.io/the-2026-homelab-stack-what-self-hosters-are-actually-running-this-year/)

---

## Security Landscape

### Recent Security Events and Concerns

- **Radarr V5 API Key Obfuscation**: Passwords and API keys are now obfuscated in API responses. Configuration management tools must adapt -- they can no longer read back credentials to verify state. Buildarr filed issue #9397 requesting reversal; Radarr maintained security posture and implemented smarter change detection instead.
  - **Confidence**: High
  - **Source**: [Radarr Issue #9397](https://github.com/Radarr/Radarr/issues/9397)

- **API Key Exposure in Browser-Based Tools**: Reiverr issue #52 documented API keys being exposed in browser requests. Solution: proxy Arr API requests through a backend server to hide keys from the client.
  - **Confidence**: High
  - **Source**: [Reiverr Issue #52](https://github.com/aleksilassila/reiverr/issues/52)

- **Script Security**: Reports indicate 90% of users running Arr automation scripts may have vulnerability exposure through improper key handling, lack of TLS, and direct internet exposure.
  - **Confidence**: Medium -- exact percentage likely exaggerated for effect, but the underlying concern is valid.
  - **Source**: [Arr Stack Security Guide](https://www.blog.brightcoding.dev/2025/10/21/ultimate-guide-to-arr-stack-automation-scripts-2024-boost-your-media-server-security-efficiency/)

### Current Security Practices in the Ecosystem

- **Network isolation**: Best practice is to never expose Arr apps to the internet. Use VPN (WireGuard) or authenticated reverse proxy.
- **Authentik/Authelia**: Self-hosted SSO in front of Arr apps that lack native multi-user auth.
- **RFC 1918 defaults**: Radarr now sets known networks to RFC 1918 ranges during startup.
- **Docker network segmentation**: Standard practice for isolating Arr containers.
- **Confidence**: High
- **Source**: [HardForum Security Discussion](https://hardforum.com/threads/securing-usenet-client-plex-server.2038104/)

### Security Gaps

1. **No audit logging in any config management tool**: None of Recyclarr, Configarr, Profilarr, or Notifiarr provide audit trails of who changed what and when.
2. **No RBAC in config management**: All tools are single-user or rely on external auth proxies. No tool implements role-based access control for configuration changes.
3. **API key rotation**: No tool automates or recommends API key rotation. Industry best practice is rotation every 30-90 days.
4. **Encryption at rest**: Configuration files with API keys are typically stored in plain text YAML or SQLite databases without encryption.
5. **No configuration approval workflows**: No tool supports multi-person approval before syncing changes to production Arr instances.

- **Confidence**: High -- verified across all competing tools' documentation and features.
- **Source**: Multiple tool documentation pages cross-referenced.

---

## Key Insights

1. **The config management space is fragmented with no clear winner**. Recyclarr is the most mature but CLI-only. Profilarr V2 is the most ambitious but not production-ready. Configarr serves the Kubernetes niche. Notifiarr bundles config sync as a paid add-on to notifications. No tool addresses security (RBAC, audit, key management), multi-Arr support beyond Radarr/Sonarr, and visual management simultaneously. This is Praxrr's opportunity.

2. **Security is the biggest unaddressed need**. Every config management tool stores and transmits Arr API keys, yet none implements encryption at rest, audit logging, RBAC, or key rotation. As the self-hosted ecosystem moves toward Authentik-based SSO and as Radarr V5 tightens its API security, users will expect their configuration management tools to meet the same standard.

3. **Visual diff/preview is the feature users value most**. Profilarr's diff screen is consistently cited as its defining advantage. Praxrr should implement visual comparison between local configuration and remote Arr instance state, showing exactly what will change before any sync operation.

4. **The GitOps pattern has won for infrastructure configuration**. Praxrr's PCD system (append-only ops, Git-compatible) is already architecturally aligned with this trend. Making version history, rollback, and diff capabilities first-class UX features would resonate with the power-user audience.

5. **Multi-instance management is table stakes but poorly solved**. Every power user runs 2+ Arr instances (4K + 1080p at minimum). Current tools either lack multi-instance support or implement it clumsily. A unified dashboard showing all instances, their configuration state, and drift detection would be a significant differentiator.

6. **Lidarr configuration management is a gap no competitor addresses well**. All existing tools focus on Radarr/Sonarr. Praxrr already supports metadata profiles (Lidarr-specific). Deepening Lidarr support (and preparing for Readarr/Whisparr) provides a clear competitive advantage.

7. **AI integration is the emerging frontier**. MCP servers for Arr apps are appearing. Natural language configuration management, intelligent recommendations, and AI-assisted troubleshooting are nascent but growing. Being early to this space positions Praxrr as forward-looking.

8. **The autobrr alternative may reshape the landscape**. If autobrr ships a unified media automation app with built-in multi-edition support, OIDC, and plugin architecture, the config management tools will need to adapt. Praxrr should design for extensibility to support future Arr platforms.

---

## Evidence Quality

- **Recent sources (<6 months)**: 22+ sources from September 2025 to February 2026
- **Primary announcements**: 6 (GitHub releases, official blog posts, project READMEs)
- **GitHub issue/discussion data**: 8 primary sources with vote counts and developer responses
- **Community analysis**: 4 blog posts and guides from independent sources
- **Tool documentation**: 5+ official documentation sites cross-referenced
- **Overall confidence rating**: High -- findings are corroborated across multiple independent sources with consistent themes.

### Freshness Assessment

All major findings are based on sources from 2025-2026. The \*Arr ecosystem moves moderately fast, so information older than 12 months should be treated with caution. The most time-sensitive findings are:

- Tool version numbers (can change weekly)
- Sonarr v5 milestone status (actively progressing)
- autobrr alternative development (early stage, could stall)
- MCP/AI integration (moving very fast)

---

## Search Queries Executed

1. "Radarr Sonarr 2025 2026 new features updates latest version"
2. "Recyclarr vs Profilarr comparison 2025 2026 TRaSH Guides config management"
3. "self-hosted media management tools 2025 2026 new releases"
4. "TRaSH Guides custom formats latest updates 2025 2026"
5. "Radarr Sonarr feature requests most wanted GitHub issues 2025"
6. "r/selfhosted media automation discussion 2025 2026 Radarr Sonarr pain points"
7. "Arr ecosystem security best practices API key authentication 2025"
8. "Prowlarr Lidarr Readarr latest development 2025 2026 updates"
9. "self-hosted media server trends 2025 2026 homelab automation"
10. "Notifiarr features 2025 Arr management notification system"
11. "autobrr community feedback Arr alternative feature ideas 2025 2026"
12. "Sonarr v4 Radarr v5 development roadmap 2025 2026 GitHub"
13. "Configarr raydak-labs TRaSH sync Kubernetes Docker 2025 features"
14. "self-hosted configuration management RBAC audit log security homelab 2025"
15. "Profilarr GitHub features roadmap import export profiles 2025 2026"
16. "Radarr Sonarr multi-instance management configuration drift detection tools"
17. "Recyclarr latest version features changelog 2025 2026"
18. "Arr MCP server AI integration Sonarr Radarr 2025 2026"
19. "Sonarr v5 develop branch features preview 2025 2026"
20. "Reddit selfhosted Arr stack pain points frustrations 2025"
21. "Cleanuparr Maintainerr Arr ecosystem helper tools 2025 2026"
22. "self-hosted application security OIDC SSO authentication Authentik 2025 trends"
23. "Lidarr music automation problems limitations 2025 album track metadata"
24. "Arr ecosystem GitOps infrastructure as code configuration management approach 2025"
25. "Buildarr Flemsmarr Arr configuration automation tool comparison 2025"
26. "Sonarr Radarr API key exposure security vulnerability self-hosted 2024 2025"
27. "Reiverr Jellyseerr Overseerr 2025 2026 media request management features"
28. "ElfHosted self-hosted managed hosting Arr apps 2025 2026"

### Deep Fetches Executed

1. Profilarr vs Recyclarr comparison article (corelab.tech)
2. Configarr comparison documentation (configarr.de)
3. awesome-arr tool listing (GitHub)
4. autobrr community feedback discussion #2 (GitHub)
5. 2026 Homelab Stack article (blog.elest.io)
6. Profilarr GitHub README (Dictionarry-Hub)
7. Configarr GitHub README (raydak-labs)
8. Radarr API obfuscation issue #9397 (GitHub)
9. Sonarr v5.0 milestone (GitHub)
10. TRaSH Guides integration proposal (Sonarr forums)
11. Recyclarr homepage (recyclarr.dev)
