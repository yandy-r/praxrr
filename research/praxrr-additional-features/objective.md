# Research Objective: New Features for Praxrr - Media Automation Configuration Manager

## About Praxrr

Praxrr is a self-hosted web application that manages quality profiles, custom formats, and release profiles for Radarr/Sonarr (collectively "\*Arr" applications). It syncs curated configuration databases (PCDs - Praxrr Config Databases) into Arr instances. Think of it as a centralized configuration management layer that sits above your Arr stack.

### Current Feature Set

- **Custom Formats Management**: Create, edit, clone, and sync custom format definitions across Arr instances
- **Quality Profiles**: Manage quality profiles with custom format scoring, quality definitions, and per-Arr-app filtering
- **Release Profiles**: Manage release profiles (Sonarr-specific preferred words/terms)
- **Delay Profiles**: Configure delay profiles for download handling
- **Media Management Profiles**: Media management configuration per Arr instance
- **Metadata Profiles**: Metadata agent configuration (Lidarr)
- **Regular Expressions**: Shared regex library for custom format conditions
- **Database Management (PCD)**: Append-only ops-based configuration database with base ops (canonical) and user ops (overrides)
- **Sync Pipeline**: Push configuration to Arr instances with conflict detection
- **Upgrade Engine**: Automated quality upgrade searches
- **Rename Processor**: Bulk rename operations
- **Job Queue**: Background job scheduling and execution
- **Notification System**: Alerts via various notification providers
- **Authentication**: Local auth, OIDC support
- **Backup System**: Configuration backup and restore
- **Release Title Parser**: C# microservice for parsing release titles (being migrated to Go)

### Tech Stack

- Deno 2.x runtime, SvelteKit web framework, SQLite database (Kysely ORM), Tailwind CSS v4
- Contract-first API design (OpenAPI spec → generated types)
- Docker deployment support

### Target Users

- Self-hosted media automation enthusiasts running Radarr, Sonarr, Lidarr
- Power users who want centralized, version-controlled configuration across multiple Arr instances
- TRaSH Guides community members who follow curated quality/format recommendations

## Core Research Questions

1. **What features do users of media automation tools (Radarr, Sonarr, Lidarr, Prowlarr, etc.) most want but don't currently have in any configuration management tool?**

2. **What security features and practices should a self-hosted media management application implement, considering it has access to Arr API keys, authentication credentials, and network access to media servers?**

3. **What UX patterns and workflows from adjacent domains (infrastructure-as-code, GitOps, configuration management) could dramatically improve the Praxrr user experience?**

4. **What features would differentiate Praxrr from competitors like TRaSH Guides Recyclarr, Notifiarr, and similar tools in the \*Arr ecosystem?**

5. **What emerging trends in self-hosted software, media automation, and home server management suggest opportunities for new features?**

## Success Criteria

- [ ] All 8 personas deployed with distinct search strategies
- [ ] Minimum 8-10 parallel searches per persona executed
- [ ] Contradictions and disagreements captured, not smoothed over
- [ ] Evidence hierarchy applied (primary > secondary > synthetic > speculative)
- [ ] Cross-domain analogies explored
- [ ] Temporal range covered (past, present, future)
- [ ] Security implications considered for every recommended feature

## Evidence Standards

- Primary sources preferred over secondary analysis
- Citations required for all claims
- Confidence ratings assigned to findings
- Contradictions explicitly documented

## Perspectives to Consider

- Historical evolution of media automation and configuration management
- Current state of the \*Arr ecosystem and self-hosted media landscape
- Future possibilities with AI, edge computing, and decentralized media
- Alternative viewpoints from different user segments (casual vs power users)
- What's NOT being discussed in the community

## Potential Biases to Guard Against

1. **Feature creep bias**: Assuming more features = better product; focus on UX quality over quantity
2. **Power user bias**: The loudest community voices may not represent the majority of users
3. **Technology-first bias**: Suggesting features based on technical novelty rather than real user needs
4. **Security theater bias**: Recommending security features that look impressive but don't address real threat models
