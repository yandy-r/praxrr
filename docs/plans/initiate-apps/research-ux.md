# UX Research: Environment-Variable-Based Instance Configuration (initiate-apps)

**Date**: 2026-02-19
**Scope**: User experience patterns, competitive analysis, and best practices for configuring Arr app instances from environment variables in a Docker/self-hosted context.

---

## Executive Summary

Environment-variable-based instance configuration is a well-established pattern in the self-hosted Docker ecosystem. The most successful implementations follow a `PREFIX_APPTYPE_INDEX_PARAMETER` naming convention (e.g., `DN_SONARR_0_URL`), provide clear startup log output for validation, and visually distinguish env-configured instances from manually-added ones in the UI. Grafana's provisioned-resource pattern---displaying a read-only banner with an explanation---is the gold standard for communicating that a resource was configured externally. The research identifies five critical UX decisions: naming convention design, first-run experience flow, read-only vs. override behavior, error reporting strategy, and health-check visualization.

**Confidence**: High --- based on multiple corroborating implementations (Notifiarr, Unpackerr, Recyclarr, Configarr, Grafana, Open WebUI) with consistent patterns.

---

## 1. User Workflows

### 1.1 Docker Compose Configuration Workflow

The typical user workflow for environment-variable-based instance setup follows this sequence:

1. **Discovery**: User reads documentation or README examples showing environment variable names.
2. **Configuration**: User adds variables to `docker-compose.yml` `environment:` block or a `.env` file.
3. **Deployment**: User runs `docker compose up -d`.
4. **Validation**: User checks container logs (`docker logs <container>`) for startup confirmation.
5. **Verification**: User opens the web UI to confirm instances appear and are reachable.

**Key insight**: Users overwhelmingly prefer `.env` file-based configuration over inline `environment:` blocks in compose files, because `.env` files keep secrets separate and are easier to manage across updates.

**Confidence**: High --- Docker official documentation and LinuxServer.io conventions confirm this as the dominant pattern.

**Sources**:

- [Docker Compose Environment Variables Best Practices](https://docs.docker.com/compose/how-tos/environment-variables/best-practices/)
- [LinuxServer.io Docker Compose Guide](https://docs.linuxserver.io/general/docker-compose/)

### 1.2 How Users Discover and Set Up Environment Variables

Users discover environment variable configuration through four primary channels:

1. **README / Docker Hub page**: The single most important discovery point. Users expect a table of environment variables with names, descriptions, defaults, and required/optional flags.
2. **Example docker-compose.yml**: Copy-paste-ready examples are the primary onboarding mechanism. Users adapt these rather than building from scratch.
3. **Example `.env` file**: A `.env.example` or documented `.env` template that users copy and fill in.
4. **Startup log output**: When misconfigured, clear log messages that name the missing/invalid variable guide users to fix issues.

**Pattern from LinuxServer.io**: The most successful Docker images provide both an example `docker-compose.yml` and document every environment variable in a structured table on the Docker Hub page and project README.

**Confidence**: High --- consistent across LinuxServer.io, Notifiarr, Unpackerr, and Configarr documentation patterns.

### 1.3 First-Run Experience with Pre-Configured Instances

When instances are pre-configured via environment variables, the first-run experience should differ from a blank-slate setup:

**Pattern: Skip or Auto-Complete Setup Wizard**

- If all required instances are configured via env vars, the app should skip the "add your first instance" onboarding step.
- The first screen should show a dashboard/overview with the pre-configured instances already visible.
- A startup log line should confirm: `Loaded 2 instance(s) from environment: Radarr-4K, Sonarr-Main`.

**Pattern: Hybrid First-Run (Overseerr/Jellyseerr model)**

- Overseerr's setup wizard requires users to manually add Radarr/Sonarr instances even on first run. Users must enter connection details, click "Test", then "Save".
- For env-var-configured instances, this wizard step should be pre-populated and auto-tested, with the user only needing to confirm.

**Recommendation for Praxrr**: When env-configured instances are detected, show them on the instances/settings page as already-connected with a health check result. Skip any "add your first instance" prompts. Show a first-run banner: "X instance(s) were configured from environment variables."

**Confidence**: Medium --- based on inference from Overseerr/Jellyseerr patterns and general self-hosted app onboarding conventions. No single app does this perfectly.

### 1.4 Managing Instances After Initial Env-Based Setup

Two competing models exist in the ecosystem:

**Model A: Environment Variables Are Authoritative (Recommended)**

- Env-configured instances are read-only in the UI.
- Users can add _additional_ instances manually through the UI.
- To modify an env-configured instance, users must change the env var and restart.
- This is the Grafana provisioning model.

**Model B: Environment Variables Seed, Then Database Owns**

- Env vars are used only on first run to seed the database.
- After seeding, the database becomes the source of truth.
- Users can modify everything through the UI.
- This is the Open WebUI `PersistentConfig` model.

**Trade-off analysis**:

| Aspect                   | Model A (Env Authoritative)                   | Model B (Seed-then-DB)                        |
| ------------------------ | --------------------------------------------- | --------------------------------------------- |
| Docker-native feel       | Better --- restart to reconfigure is expected | Worse --- env changes ignored after first run |
| GitOps/IaC compatibility | Better --- env vars always respected          | Worse --- drift between env and actual state  |
| User control             | Less --- must use env vars for changes        | More --- full UI control after setup          |
| Complexity               | Lower --- single source of truth              | Higher --- must track which source wins       |
| Surprise factor          | Lower --- predictable behavior                | Higher --- "why did my env change not apply?" |

**Recommendation for Praxrr**: Use Model A (Environment Variables Are Authoritative). This aligns with Docker ecosystem expectations and prevents configuration drift. Env-configured instances should be read-only in the UI, clearly marked as such, and re-read on every startup.

**Confidence**: High --- Grafana, Recyclarr, and Authelia all follow this pattern. Docker best practices documentation reinforces environment variables as the authoritative configuration source for containerized apps.

**Sources**:

- [Grafana Provisioning Documentation](https://grafana.com/docs/grafana/latest/administration/provisioning/)
- [Open WebUI Environment Configuration](https://docs.openwebui.com/reference/env-configuration/)

---

## 2. UI/UX Best Practices

### 2.1 Competitive Landscape: How Self-Hosted Apps Handle Env-Based Instance Config

#### Notifiarr (DN\_ prefix pattern)

- **Naming**: `DN_SONARR_0_URL`, `DN_SONARR_0_API_KEY`, `DN_SONARR_0_NAME` (0-indexed)
- **UI**: Web UI at port 5454 with sidebar navigation to "Starr Apps" section
- **Testing**: Green double-checkmark button next to URL field for inline connection testing
- **Multi-instance**: Increment index (`DN_SONARR_1_URL`, `DN_SONARR_2_URL`); no limit on instances
- **Config precedence**: "Environmental variables take precedent over config file settings"
- **Health checks**: Automatic service checks with configurable check intervals

**Confidence**: High

**Source**: [Notifiarr Client Configuration](https://notifiarr.wiki/pages/client/configuration/)

#### Unpackerr (UN\_ prefix pattern)

- **Naming**: `UN_RADARR_0_URL`, `UN_RADARR_0_API_KEY` (0-indexed)
- **Parameters per instance**: URL, API key, paths (sub-indexed: `UN_SONARR_0_PATHS_0`), protocols, timeout, delete_delay, delete_orig, syncthing
- **Validation**: URL and API key are required; omitting API key produces a startup warning
- **Multi-instance**: Unlimited instances via incrementing index
- **Time formats**: Go Duration format (`10s`, `5m`)

**Confidence**: High

**Source**: [Unpackerr Application Configuration](https://unpackerr.zip/docs/install/configuration/)

#### Recyclarr (YAML + env var interpolation)

- **Naming**: YAML-first with `!env_var RADARR_BASE_URL` interpolation syntax
- **Multi-instance**: Named instances in YAML (`radarr4k:`, `sonarr_anime:`)
- **Secrets**: Separate `secrets.yml` file for sensitive values
- **Default values**: Supports `!env_var VARIABLE_NAME default_value` syntax
- **Error reporting**: Errors in any section cause the entire sync command to fail; debug and verbose log files generated per run

**Confidence**: High

**Sources**:

- [Recyclarr Configuration](https://recyclarr.dev/reference/configuration/)
- [Recyclarr Errors & Warnings](https://recyclarr.dev/guide/troubleshooting/errors/)

#### Configarr (YAML + multi-source secrets)

- **Naming**: YAML with `!env SONARR_URL` and `!secret SONARR_API_KEY` tags
- **Multi-instance**: Named blocks in YAML (`instance1:`, `instance2:`)
- **Secret sources**: Three methods --- `!env` (environment variables), `!secret` (secrets.yml), `!file` (file contents)
- **Enable/disable**: Per-instance `enabled: true/false` and global `sonarrEnabled`/`radarrEnabled` flags

**Confidence**: High

**Source**: [Configarr Configuration File](https://configarr.de/docs/configuration/config-file/)

#### Grafana (Provisioning + read-only UI)

- **Provisioning**: YAML files define data sources with `editable: false` flag
- **UI indicator**: Banner message: "This datasource was added by config and cannot be modified using the UI. Please contact your server admin to update this datasource."
- **Behavior**: Provisioned resources are read-only in UI; manual resources are fully editable
- **Environment interpolation**: `GF_<SectionName>_<KeyName>` pattern; env vars in provisioning files via `$VARIABLE` syntax

**Confidence**: High --- this is the most widely cited pattern for read-only provisioned resources in web UIs.

**Source**: [Grafana Provisioning Documentation](https://grafana.com/docs/grafana/latest/administration/provisioning/)

#### Prowlarr (UI-first instance management)

- **Approach**: Purely UI-driven; no env-var-based instance configuration
- **Workflow**: Settings -> Apps -> + button -> fill form -> save
- **Multi-instance**: Each instance of the same app type added separately through the UI
- **Sync**: Changes to indexers/download clients propagate to connected apps automatically

**Confidence**: High

**Source**: [Prowlarr Quick Start Guide](https://wiki.servarr.com/prowlarr/quick-start-guide)

#### Overseerr/Jellyseerr (Setup wizard with test-before-save)

- **Approach**: UI wizard on first run; settings page for subsequent management
- **Workflow**: Enter connection details -> Click "Test" -> On success, "Save" button enables -> Save
- **Validation**: Test button is mandatory before save is allowed
- **Visual feedback**: Checkmark for success, exclamation mark for failure, notification toast in top-right

**Confidence**: High

**Sources**:

- [Overseerr Guide](https://www.rapidseedbox.com/blog/overseerr-guide)
- [Jellyseerr Guide](https://www.rapidseedbox.com/blog/jellyseerr-guide)

### 2.2 Visual Indicators for Env-Configured vs. Manually-Added Instances

The following patterns emerge from the competitive analysis:

#### Pattern 1: Banner/Alert Message (Grafana model)

A prominent banner at the top of the instance detail view:

```
This instance was configured from environment variables and cannot be modified in the UI.
To change settings, update your environment variables and restart the container.
```

- **Pros**: Extremely clear; no ambiguity about why fields are disabled
- **Cons**: Takes vertical space; can feel heavy if many instances are provisioned

#### Pattern 2: Badge/Tag on Instance Card

A small badge or tag on the instance list card:

```
[Radarr-4K]  [ENV]  Connected
[Sonarr-Main]  [ENV]  Connected
[Lidarr-Music]         Connected    <-- no badge = manually added
```

- **Pros**: Compact; scannable at a glance in list views
- **Cons**: Badge alone may not explain _why_ the instance is different

#### Pattern 3: Lock Icon on Fields

Individual form fields show a lock icon when they are read-only due to env-var sourcing:

```
URL:      [http://radarr:7878    ] [lock icon]
API Key:  [********              ] [lock icon]
Name:     [Radarr-4K             ] [lock icon]
```

- **Pros**: Granular; user sees exactly which fields are env-controlled
- **Cons**: More complex implementation; may confuse users who expect to edit

**Recommendation for Praxrr**: Use a combination of Pattern 1 and Pattern 2.

- In the instance **list view**, show an `ENV` badge/tag next to the instance name.
- In the instance **detail/edit view**, show a banner explaining the read-only status with guidance on how to make changes.
- Disable all form fields for env-configured instances (grayed out, non-interactive).

**Confidence**: High --- Grafana's pattern is the industry standard; badge patterns are common in Kubernetes/cloud UIs.

### 2.3 Lock/Read-Only Patterns for Env-Sourced Configuration

**Critical UX principle**: Read-only fields must explain _why_ they are read-only, not just _that_ they are.

Best practices:

1. **Disable, don't hide**: Show all fields for env-configured instances, but make them non-interactive. This lets users see the current configuration without needing to check env vars.
2. **Show the source**: Optionally show which env var controls each field (e.g., "Set by RADARR_INSTANCE_URL_1").
3. **Provide escape hatch documentation**: Link to documentation explaining how to modify env-configured instances.
4. **Allow supplementary fields**: If the env var only sets URL and API key, allow users to set non-env fields (like display name or tags) through the UI.

**Confidence**: Medium --- inferred from Grafana provisioning behavior and general UX heuristics. No self-hosted Arr tool does this comprehensively.

### 2.4 Instance Health/Status Display

**Status indicator patterns from design systems** (Carbon, Astro UX, HPE):

| Status      | Color        | Icon             | Meaning                                       |
| ----------- | ------------ | ---------------- | --------------------------------------------- |
| Connected   | Green        | Filled circle    | Instance is reachable and API key is valid    |
| Degraded    | Yellow/Amber | Warning triangle | Instance is reachable but returned warnings   |
| Unreachable | Red          | X circle         | Instance is not responding or returned errors |
| Unknown     | Gray         | Empty circle     | Not yet checked or check in progress          |
| Checking    | Blue         | Spinner          | Health check currently running                |

**Accessibility requirement**: Never rely solely on color. Always pair with an icon shape and text label.

**Real-world patterns**:

- **Notifiarr**: Green double-checkmark for successful test; automatic service checks with configurable intervals.
- **Jellyseerr**: Checkmark for success, exclamation mark for failure, toast notification for result.
- **Prowlarr**: "Test" button on each instance with success/failure feedback.

**Recommendation for Praxrr**: Use a status dot (colored circle) paired with text in list views. In detail views, show the last check time and a "Test Now" button.

**Confidence**: High --- design system patterns are well-established; status indicators are standard in every Arr ecosystem tool.

**Sources**:

- [Carbon Design System - Status Indicator Pattern](https://carbondesignsystem.com/patterns/status-indicator-pattern/)
- [Astro UX - Status System](https://www.astrouxds.com/patterns/status-system/)

---

## 3. Error Handling UX

### 3.1 Invalid Environment Variable Feedback

Two feedback channels exist for env var errors: **logs** (Docker container logs) and **UI** (web interface).

**Log-first principle**: All env var validation errors MUST appear in container logs, because users check `docker logs` before the UI is even accessible. The UI is a secondary feedback channel.

**Error categories and handling**:

| Error Type           | Log Level | Log Message Pattern                                                                          | UI Behavior                                  |
| -------------------- | --------- | -------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Missing required var | WARN      | `RADARR_INSTANCE_URL_1 is set but RADARR_INSTANCE_API_KEY_1 is missing; instance 1 skipped`  | Instance not shown; warning on settings page |
| Invalid URL format   | ERROR     | `RADARR_INSTANCE_URL_1="not-a-url" is not a valid URL; instance 1 skipped`                   | Instance not shown; error on settings page   |
| Invalid index gap    | WARN      | `RADARR_INSTANCE_URL_2 found but RADARR_INSTANCE_URL_1 is missing; check numbering`          | Process found instances; warn about gap      |
| Duplicate instance   | WARN      | `RADARR_INSTANCE_URL_1 and RADARR_INSTANCE_URL_2 point to the same host; possible duplicate` | Show both; warn in UI                        |
| Connection failure   | WARN      | `Radarr instance 1 (http://radarr:7878) is not reachable; will retry in background`          | Show instance with "Unreachable" status      |

**Best practice from Authelia**: All env vars with the app prefix must be valid configuration keys. Unknown keys should produce warnings, not silent failures. This catches typos early.

**Best practice from Recyclarr**: Generate both debug and verbose log files. Console output shows warnings/errors; log files contain full diagnostic information.

**Confidence**: High --- Authelia, Recyclarr, and Docker best practices documentation all converge on this approach.

**Sources**:

- [Authelia Environment Configuration](https://www.authelia.com/configuration/methods/environment/)
- [Recyclarr Errors & Warnings](https://recyclarr.dev/guide/troubleshooting/errors/)

### 3.2 Instance Connectivity Failure Indicators

**Startup behavior**: Do NOT block startup on instance connectivity failures. Start the app, show instances as "Unreachable", and retry in the background.

**Rationale**: In Docker Compose, services start in parallel. The Arr instance might not be ready yet when Praxrr starts. Blocking startup would cause restart loops.

**UI indicators for connectivity failures**:

1. **Instance list**: Red status dot + "Unreachable" text
2. **Instance detail**: Banner with specific error: "Connection refused", "Timeout", "401 Unauthorized (invalid API key)", "404 Not Found (check URL/base path)"
3. **Actionable guidance**: Each error type should include a hint:
   - Connection refused: "Ensure the Arr instance is running and the URL is correct."
   - 401 Unauthorized: "Check that the API key matches the key in your Arr instance's Settings > General."
   - Timeout: "The instance is taking too long to respond. Check network connectivity."

**Confidence**: High --- standard practice across all Arr ecosystem tools.

### 3.3 Partial Configuration Handling

When some fields are provided but others are missing for an instance:

**Required fields**: URL and API key. If either is missing, skip the instance entirely and log a warning.

**Optional fields with defaults**:

| Field                           | Default Behavior                                        |
| ------------------------------- | ------------------------------------------------------- |
| Instance name                   | Auto-generate from type + index: "Radarr 1", "Sonarr 2" |
| Instance type (generic pattern) | Required if using generic `INSTANCE_TYPE_N` pattern     |
| Base URL path                   | Default to `/`                                          |
| SSL verification                | Default to `true`                                       |
| Tags                            | Default to empty                                        |

**Error message for partial config**:

```
WARN: Found RADARR_INSTANCE_URL_1="http://radarr:7878" but RADARR_INSTANCE_API_KEY_1 is not set.
      Instance "Radarr 1" will not be loaded. Set RADARR_INSTANCE_API_KEY_1 to enable it.
```

**Confidence**: High --- Unpackerr and Notifiarr both follow this pattern of requiring URL + API key as minimum viable config.

### 3.4 Clear Error Messages for Common Mistakes

Common mistakes and their error messages:

| Mistake                        | Detection                         | Error Message                                                                                      |
| ------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------- |
| Quotes around values in `.env` | Value starts/ends with `"` or `'` | `RADARR_INSTANCE_URL_1 contains quotes. Remove surrounding quotes from the value.`                 |
| Trailing slash in URL          | URL ends with `/`                 | (Auto-strip; no error. Log at DEBUG level.)                                                        |
| HTTP vs HTTPS mismatch         | N/A                               | (Accept both; no error.)                                                                           |
| Using 0-index when 1-indexed   | `_0` suffix found                 | `Found RADARR_INSTANCE_URL_0. Instance numbering starts at 1. Did you mean RADARR_INSTANCE_URL_1?` |
| Spaces in API key              | Whitespace detected               | `RADARR_INSTANCE_API_KEY_1 contains whitespace. API keys should not contain spaces.`               |
| Wrong variable name            | Close match to known var          | `Unknown variable RADARR_INSTANC_URL_1. Did you mean RADARR_INSTANCE_URL_1?`                       |

**Confidence**: Medium --- error message specifics are inferred from best practices rather than observed implementations. The common mistake patterns are well-documented.

---

## 4. Performance UX

### 4.1 Startup Time with Multiple Instances

**Principle**: Environment variable parsing should be near-instantaneous. Startup time impact comes from connection validation, not configuration loading.

**Benchmark expectations**:

- Env var parsing: < 10ms for any reasonable number of instances
- Per-instance connection validation: 1-10 seconds depending on network
- Total startup with 5 instances (sequential validation): 5-50 seconds
- Total startup with 5 instances (parallel validation): 1-10 seconds

**Recommendation**: Parse all env vars synchronously during startup (fast). Validate connections asynchronously in parallel after the web server is running. Show instances immediately with "Checking..." status.

**Confidence**: High --- this is the standard pattern for service-oriented Docker apps.

### 4.2 Connection Validation During Startup

**Three-phase startup model**:

1. **Phase 1 - Parse** (synchronous, blocking): Read env vars, validate format, construct instance configurations. Log any parsing errors. This phase must complete before the web server starts.

2. **Phase 2 - Serve** (synchronous, blocking): Start the web server. Instances appear in the UI with "Checking..." status.

3. **Phase 3 - Validate** (asynchronous, non-blocking): For each instance, in parallel:
   - Attempt connection to the Arr instance URL
   - Validate the API key by calling a lightweight endpoint (e.g., `/api/v3/system/status`)
   - Update instance status in the UI (Connected / Unreachable / Auth Error)
   - If unreachable, schedule retry with exponential backoff (1s, 2s, 4s, 8s, max 60s)

**Docker Compose integration**: This model works well with `depends_on` + `service_healthy` health checks. Praxrr should expose a `/health` endpoint that reports healthy once Phase 2 completes (web server is ready), regardless of instance connectivity status.

**Confidence**: High --- Docker health check patterns and startup ordering are well-documented.

**Sources**:

- [Docker Compose Startup Order](https://docs.docker.com/compose/how-tos/startup-order/)
- [Docker Compose Health Checks Guide](https://last9.io/blog/docker-compose-health-checks/)

### 4.3 Background Health Checks

**Recommended health check cadence**:

| Check Type            | Interval                     | Purpose                         |
| --------------------- | ---------------------------- | ------------------------------- |
| Initial validation    | On startup                   | Confirm instance is reachable   |
| Periodic health check | Every 60 seconds             | Detect instance going down      |
| On-demand check       | User clicks "Test"           | Manual verification             |
| Retry after failure   | Exponential backoff (1s-60s) | Recover from transient failures |

**What to check**: A lightweight API call that validates both connectivity and authentication. For Radarr/Sonarr, `GET /api/v3/system/status` is ideal---it requires a valid API key and returns quickly.

**What NOT to do**:

- Do not fetch full library data on health checks
- Do not block sync operations on health check results (check at sync time instead)
- Do not spam the Arr instance with checks (respect rate limits)

**Confidence**: High --- Notifiarr's configurable check intervals and standard monitoring patterns confirm this approach.

---

## 5. Competitive Analysis

### 5.1 Recyclarr: YAML-Based Multi-Instance Config

**Approach**: Configuration-file-first with environment variable interpolation.

**Strengths**:

- Named instances (`radarr4k:`, `sonarr_anime:`) are human-readable
- `!env_var` tag with default values: `!env_var RADARR_URL http://localhost:7878`
- Separate `secrets.yml` for credential isolation
- Supports multiple config files in a `configs/` directory
- Detailed error/warning documentation

**Weaknesses**:

- Requires YAML knowledge (not pure env-var)
- Config file must be mounted into the container
- Errors in unused sections still cause failures

**Relevance to Praxrr**: Recyclarr's approach is more complex than what Praxrr needs. The pure env-var approach (like Notifiarr/Unpackerr) is better suited for Praxrr's Docker-first use case.

**Confidence**: High

**Source**: [Recyclarr Configuration Reference](https://recyclarr.dev/reference/configuration/)

### 5.2 Notifiarr: Indexed Env-Var Multi-Instance Config

**Approach**: `DN_` prefix with 0-indexed instance numbers.

**Strengths**:

- Pure environment variable configuration---no config files needed
- Consistent pattern across all app types
- Web UI for visual configuration as an alternative
- Env vars take precedence over config file
- Unlimited instances

**Weaknesses**:

- 0-indexed (less intuitive for non-developers)
- Many parameters per instance can create long env var lists
- Config file format is compressed/binary; direct editing discouraged

**Pattern adopted**: `DN_APPTYPE_INDEX_PARAMETER`

- `DN_SONARR_0_URL`, `DN_SONARR_0_API_KEY`, `DN_SONARR_0_NAME`
- `DN_RADARR_0_URL`, `DN_RADARR_0_API_KEY`, `DN_RADARR_0_NAME`
- `DN_LIDARR_0_URL`, `DN_LIDARR_0_API_KEY`, `DN_LIDARR_0_NAME`

**Relevance to Praxrr**: This is the closest analog to Praxrr's planned feature. The naming pattern is proven and widely understood in the self-hosted community.

**Confidence**: High

**Source**: [Notifiarr Client Configuration](https://notifiarr.wiki/pages/client/configuration/)

### 5.3 Buildarr: Configuration-as-Code for Arr Instances

**Approach**: YAML configuration with plugin-based architecture.

**Strengths**:

- "Don't touch what is not explicitly defined" philosophy
- Idempotent operation (only pushes changes when needed)
- `instances` attribute for managing multiple instances of the same type
- Watch mode for automatic config reload
- Docker image bundled with plugins

**Weaknesses**:

- YAML-only; no pure env-var mode
- Limited env var support (only `$BUILDARR_LOG_LEVEL`, `$BUILDARR_INSTALL_PACKAGES`)
- Heavier setup than simple env vars

**Relevance to Praxrr**: Buildarr's "don't touch what is not explicitly defined" principle is valuable. Praxrr should similarly not overwrite manually-configured settings when env vars only define a subset of instance properties.

**Confidence**: High

**Source**: [Buildarr Configuration](https://buildarr.github.io/configuration/)

### 5.4 Prowlarr: UI-First Instance Management

**Approach**: Entirely UI-driven; no env-var or file-based instance configuration.

**Strengths**:

- Simple, intuitive UI: Settings -> Apps -> + -> fill form -> save
- Centralized indexer management that propagates to connected apps
- Per-instance sync profiles and tag filtering
- Automatic indexer sync to connected apps

**Weaknesses**:

- No infrastructure-as-code support
- Cannot pre-configure instances for Docker deployments
- Each instance must be manually added, even in identical deployments

**Relevance to Praxrr**: Prowlarr represents the "before" state---what users want to avoid with env-var configuration. Praxrr should support both UI-based and env-var-based instance management.

**Confidence**: High

**Source**: [Prowlarr Quick Start Guide](https://wiki.servarr.com/prowlarr/quick-start-guide)

### 5.5 Docker-First Self-Hosted App Patterns

**LinuxServer.io conventions** (adopted by most self-hosted apps):

- Standard env vars: `PUID`, `PGID`, `TZ`, `UMASK`
- `FILE__` prefix for secret file injection: `FILE__PASSWORD=/run/secrets/pass`
- Docker Compose + `.env` file as the primary configuration method
- Documentation table format: Variable | Default | Description

**Authelia** (strict validation pattern):

- `AUTHELIA_` prefix required for all env vars
- Hierarchical naming: `AUTHELIA_SERVER_BUFFERS_READ`
- Unknown env vars with the prefix cause errors (catches typos)
- `_FILE` suffix for secret file references
- Cannot configure list-based structures via env vars (explicit limitation)

**Open WebUI** (dual-mode configuration):

- `ENABLE_PERSISTENT_CONFIG` toggle determines whether env vars or DB wins
- PersistentConfig variables are seeded from env on first run, then stored in DB
- When persistent config is off, UI changes are session-only and lost on restart

**Confidence**: High --- these patterns are well-documented and widely adopted.

**Sources**:

- [LinuxServer.io Docker Images](https://docs.linuxserver.io/images/docker-overseerr/)
- [Authelia Environment Configuration](https://www.authelia.com/configuration/methods/environment/)
- [Open WebUI Environment Configuration](https://docs.openwebui.com/reference/env-configuration/)

---

## 6. Naming Convention Analysis

### 6.1 Observed Patterns in the Ecosystem

| App       | Pattern                       | Index Start | Example                        |
| --------- | ----------------------------- | ----------- | ------------------------------ |
| Notifiarr | `DN_APPTYPE_INDEX_PARAM`      | 0           | `DN_SONARR_0_URL`              |
| Unpackerr | `UN_APPTYPE_INDEX_PARAM`      | 0           | `UN_RADARR_0_URL`              |
| Authelia  | `AUTHELIA_SECTION_SUBSECTION` | N/A         | `AUTHELIA_SERVER_BUFFERS_READ` |
| Grafana   | `GF_SECTION_KEY`              | N/A         | `GF_AUTH_BASIC_ENABLED`        |

### 6.2 Praxrr's Proposed Dual Pattern

**Pattern A: App-type-prefixed (recommended as primary)**

```
RADARR_INSTANCE_URL_1=http://radarr:7878
RADARR_INSTANCE_API_KEY_1=abc123
RADARR_INSTANCE_NAME_1=Radarr-4K

SONARR_INSTANCE_URL_1=http://sonarr:8989
SONARR_INSTANCE_API_KEY_1=def456
```

**Pattern B: Generic indexed**

```
INSTANCE_TYPE_1=RADARR
INSTANCE_URL_1=http://radarr:7878
INSTANCE_API_KEY_1=abc123
INSTANCE_NAME_1=Radarr-4K
```

### 6.3 Design Recommendations

1. **Use 1-based indexing**: Unlike Notifiarr/Unpackerr (0-based), use 1-based indexing. It is more intuitive for non-developer users who are the primary audience for Docker-based self-hosting. The `_0` suffix looks like a mistake to non-programmers.

2. **Prefer app-type-prefixed (Pattern A)**: It is more explicit, avoids the ambiguity of a separate `INSTANCE_TYPE` variable, and is easier to scan in a `.env` file.

3. **Support both patterns**: Parse Pattern A first, then Pattern B for any remaining instances. Document Pattern A as the recommended approach.

4. **Allow `PRAXRR_` prefix optionally**: Support both `RADARR_INSTANCE_URL_1` and `PRAXRR_RADARR_INSTANCE_URL_1` to avoid conflicts with other apps that might use similar variable names. Document the prefixed version as the "safe" option.

5. **Support `_FILE` suffix for secrets**: Following the LinuxServer.io convention, allow `RADARR_INSTANCE_API_KEY_FILE_1=/run/secrets/radarr_key` to read the value from a file.

**Confidence**: Medium --- the 1-based vs 0-based decision is a judgment call. The Notifiarr/Unpackerr ecosystem uses 0-based, but user-facing Docker tools typically use 1-based or no numbering.

---

## 7. Actionable UX Patterns Summary

### 7.1 Must-Have Patterns

1. **Startup log summary**: On startup, log a clear summary of all parsed instances with their status:

   ```
   INFO: Environment instance configuration:
     [1] Radarr-4K    (http://radarr:7878)  - Checking...
     [2] Sonarr-Main  (http://sonarr:8989)  - Checking...
     [3] Lidarr       (http://lidarr:8686)  - Checking...
   ```

2. **Read-only banner for env instances**: In the instance detail view, display a prominent banner explaining the instance was configured from environment variables and cannot be modified in the UI.

3. **`ENV` badge in list view**: Show a small badge or tag on env-configured instances in any list or card view.

4. **Status indicators with text**: Green/Red/Yellow/Gray dots paired with text labels (Connected, Unreachable, Error, Checking).

5. **Non-blocking startup**: Never block the web server on instance connectivity checks. Show "Checking..." and validate asynchronously.

6. **Test button**: Provide a manual "Test Connection" button for each instance, regardless of whether it was env-configured or manually added.

### 7.2 Should-Have Patterns

7. **Error guidance in logs**: When an env var is invalid, log the specific variable name, the problem, and what the user should do to fix it.

8. **Skip setup wizard**: When env-configured instances exist, skip any "add your first instance" onboarding.

9. **`_FILE` suffix support**: Allow reading sensitive values from files for Docker Secrets compatibility.

10. **Partial config warnings**: Warn (don't error) when some fields for an instance index are present but others are missing.

### 7.3 Nice-to-Have Patterns

11. **Source annotation on fields**: Show which env var controls each read-only field (e.g., "Set by `RADARR_INSTANCE_URL_1`").

12. **Fuzzy typo detection**: If an env var is close to a known variable name but does not match exactly, suggest the correct name.

13. **Mixed mode**: Allow env vars to set URL/API key while the UI controls non-critical fields like display name and tags.

14. **Health check history**: Show last N health check results with timestamps for troubleshooting intermittent connectivity.

---

## 8. Uncertainties and Gaps

1. **No single app does everything well**: No self-hosted Arr-adjacent tool combines env-var instance configuration, read-only UI indicators, and health checks into a cohesive UX. Praxrr has an opportunity to set a new standard.

2. **1-indexed vs 0-indexed debate**: The ecosystem is split. Notifiarr/Unpackerr use 0-indexed; general Docker conventions do not use indexing at all. User testing would help resolve this.

3. **Override behavior on restart**: The research clearly favors "env vars are authoritative on every restart" over "env vars seed on first run." However, this means users cannot make UI changes to env-configured instances at all, which may frustrate some users. Consider a hybrid where non-env fields (like display name) are editable.

4. **Generic pattern (`INSTANCE_TYPE_N`) adoption**: No observed tool uses a generic indexed pattern without a type prefix. This is novel for Praxrr and may confuse users who expect app-specific prefixes. Consider documenting it as an alternative rather than the primary approach.

5. **Secrets management depth**: The `_FILE` suffix convention (LinuxServer.io) is well-established, but integration with Docker Secrets, Kubernetes Secrets, and Vault is a rabbit hole. Scope the initial implementation to `_FILE` suffix only.

6. **Lidarr-specific validation gaps**: Research for this document focused on Radarr/Sonarr patterns. Lidarr's API may have different endpoints or authentication requirements that need per-app validation (consistent with Praxrr's Cross-Arr Semantic Validation Policy).

---

## 9. Search Queries Executed

1. `Recyclarr YAML configuration multiple Radarr Sonarr instances environment variables`
2. `Notifiarr multi-instance Arr configuration setup UX`
3. `Buildarr environment variable configuration Radarr Sonarr Docker`
4. `self-hosted Docker apps environment variable configuration patterns best practices 2025`
5. `Prowlarr manage Radarr Sonarr instances configuration UI UX`
6. `Overseerr Docker environment variables configuration instances setup`
7. `Portainer environment variable management Docker containers UI patterns`
8. `Heimdall Organizr self-hosted dashboard instance configuration UX patterns`
9. `Notifiarr environment variable naming pattern DN_SONARR_1_URL DN_RADARR multi-instance Docker`
10. `Docker self-hosted app read-only environment variable configured settings UI lock pattern`
11. `Configarr environment variable Docker Radarr Sonarr configuration`
12. `Unpackerr environment variable indexed instance configuration DN_SONARR DN_RADARR pattern`
13. `self-hosted app startup environment variable validation error handling UX patterns Docker logs`
14. `Grafana provisioning data sources environment variables read-only UI pattern`
15. `Prowlarr quick start guide add application instances Radarr Sonarr Lidarr UI workflow`
16. `"environment variable" "read-only" "managed by" UI indicator self-hosted configuration pattern`
17. `Docker health check pattern self-hosted app instance connectivity startup validation`
18. `Grafana provisioned datasource "This datasource was added by config" UI screenshot read-only banner`
19. `Jellyseerr Overseerr Radarr Sonarr instance management UI add test connection health status`
20. `LinuxServer.io Docker environment variable pattern convention FILE__ prefix secrets`
21. `Docker Compose environment variable naming convention indexed numbered instances best practice pattern`
22. `self-hosted app first-run experience Docker pre-configured instances onboarding UX`
23. `Authelia Authentik environment variable Docker configuration validation startup error messages`
24. `Docker app startup connection validation retry backoff pattern multiple external services`
25. `web application health check status indicator green red yellow dot UX pattern design system`
26. `Overseerr Radarr Sonarr instance setup wizard UI test connection save workflow first run`

---

## 10. Sources

### Primary Sources (directly relevant implementations)

- [Notifiarr Client Configuration](https://notifiarr.wiki/pages/client/configuration/) --- Multi-instance env var pattern with DN\_ prefix
- [Notifiarr Client Web UI](https://notifiarr.wiki/pages/client/gui/) --- Web UI for instance management
- [Unpackerr Application Configuration](https://unpackerr.zip/docs/install/configuration/) --- Multi-instance env var pattern with UN\_ prefix
- [Recyclarr Configuration Reference](https://recyclarr.dev/reference/configuration/) --- YAML-based multi-instance config
- [Recyclarr Environment Variables](https://recyclarr.dev/wiki/yaml/env-vars/) --- Env var interpolation in YAML
- [Configarr Configuration File](https://configarr.de/docs/configuration/config-file/) --- YAML with !env and !secret tags
- [Buildarr Configuration](https://buildarr.github.io/configuration/) --- Configuration-as-code for Arr instances
- [Grafana Provisioning Documentation](https://grafana.com/docs/grafana/latest/administration/provisioning/) --- Read-only provisioned resource pattern

### Secondary Sources (design patterns and conventions)

- [Docker Compose Environment Variables Best Practices](https://docs.docker.com/compose/how-tos/environment-variables/best-practices/)
- [Docker Compose Startup Order](https://docs.docker.com/compose/how-tos/startup-order/)
- [Authelia Environment Configuration](https://www.authelia.com/configuration/methods/environment/) --- Strict env var validation
- [Open WebUI Environment Configuration](https://docs.openwebui.com/reference/env-configuration/) --- PersistentConfig dual-mode pattern
- [Carbon Design System - Status Indicator Pattern](https://carbondesignsystem.com/patterns/status-indicator-pattern/)
- [Astro UX Design System - Status System](https://www.astrouxds.com/patterns/status-system/)
- [Prowlarr Quick Start Guide](https://wiki.servarr.com/prowlarr/quick-start-guide) --- UI-first instance management
- [LinuxServer.io Docker Images](https://docs.linuxserver.io/images/docker-overseerr/) --- FILE\_\_ prefix convention
- [Overseerr Guide](https://www.rapidseedbox.com/blog/overseerr-guide) --- Setup wizard with test-before-save
- [Jellyseerr Guide](https://www.rapidseedbox.com/blog/jellyseerr-guide) --- Instance test/save workflow
- [Portainer Environment Variable Management](https://docs.portainer.io/faqs/troubleshooting/stacks-deployments-and-updates/environment-variable-management-in-docker-.env-vs.-stack.env)
- [Docker Health Checks Guide](https://last9.io/blog/docker-compose-health-checks/)
- [Grafana Provisioned Datasource UI Behavior](https://community.zenduty.com/t/grafana-this-data-source-was-added-by-config-and-cannot-be-modified-using-the-ui/439)
