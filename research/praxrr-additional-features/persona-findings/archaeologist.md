# Archaeological Research: New Features for Praxrr Media Automation Config Manager

## Executive Summary

The history of media automation and self-hosted configuration management reveals several patterns that were abandoned -- often for practical reasons at the time -- but deserve reconsideration with modern technology. The most valuable insights come from three areas: (1) the middleware/bridge architecture pioneered by nzbToMedia (2012-era), which centralized configuration across disparate media tools before the *Arr ecosystem existed; (2) the event-driven plugin system of CouchPotato, which enabled extensibility that the modern *Arr stack largely lost; and (3) the modular, multi-service administration approach of Webmin (1997-present), which solved the "too many web interfaces" problem that plagues self-hosted media stacks today. These historical patterns, combined with lessons from CFEngine's idempotent configuration management (1993) and Kodi's community addon repository trust model, offer concrete feature ideas for Praxrr that would differentiate it from Recyclarr, Notifiarr, and Buildarr.

---

## Old Media Automation Approaches

### 2008-2013: SickBeard -- The Pioneer PVR

- **How it worked**: SickBeard was a Personal Video Recorder for newsgroup users (with limited torrent support). It watched for new episodes, downloaded them via SABnzbd, sorted and renamed them, and optionally generated metadata. Users configured quality preferences (SD TV, SD DVD, HD TV, 720p) and naming conventions through a web UI.
- **Configuration approach**: INI-style configuration file stored on disk. Quality was a simple ordered list -- the system searched from top to bottom and stopped at the first match. Post-processing was handled through scripts in an `autoProcessTV/` directory with a `autoProcessTV.cfg` config file containing host, port, username, password, web_root, and SSL settings.
- **Advantages**: Simplicity. The "wanted/skipped/downloaded" model was immediately understandable. Configuration was a single text file that could be backed up or shared trivially. Post-processing scripts were extensible without modifying the core application.
- **Why discontinued**: Python 2 dependency, limited torrent support, slow development, and the creator (Nic Wolfe) stepped back from the project. Forks like SickRage and SickChill fragmented the community.
- **Modern relevance**: The simplicity of SickBeard's quality model (ordered list with "stop searching" flag) is something Praxrr could offer as a "simple mode" for users overwhelmed by custom format scoring. The post-processing script extensibility pattern is worth considering for Praxrr's sync pipeline.
- **Confidence**: High -- multiple primary sources confirm these details.
- **Sources**: [SickBeard vs NzbDrone](https://www.simplehomelab.com/sickbeard-alternative-nzbdrone-vs-sickbeard/), [Kodi Forum Setup Guide](https://forum.kodi.tv/showthread.php?tid=120406), [SickBeard Post Processing Wiki](https://code.google.com/archive/p/sickbeard/wikis/PostProcessing.wiki)

### 2011-2016: CouchPotato -- Event-Driven Movie Automation

- **How it worked**: CouchPotato maintained a "movies I want" list and searched for NZBs/torrents every X hours. When found, it sent them to SABnzbd or a torrent client. Quality was managed through a priority system where users could drag-and-drop quality tiers and check "Finish" to stop searching when a certain quality was reached.
- **Configuration approach**: INI-format `config.ini` file with sections (`[automation]`, `[manage]`, `[renamer]`, `[searcher]`, `[nzb]`, `[subtitle]`, `[trailer]`). More notably, CouchPotato used an **event-driven plugin architecture** where plugins inherited from a Plugin base class, registered handlers with `addEvent()`, and triggered events with `fireEvent()`. Custom plugins could be loaded from the CouchPotato data folder.
- **Advantages**: The plugin system was genuinely powerful. The event-driven architecture meant third parties could extend functionality without forking. The quality drag-and-drop UI with the "Finish" checkbox was more intuitive than numeric scoring for most users. The INI config format was universally understood.
- **Why discontinued**: CouchPotato stagnated as its maintainer lost interest. Radarr (a Sonarr fork for movies) superseded it around 2016-2017 with a more polished UI and better integration with the emerging \*Arr ecosystem.
- **Modern relevance**: CouchPotato's plugin/event system is a pattern Praxrr should consider. Allowing community-contributed sync processors, notification handlers, or config transformers through an event bus would be a significant differentiator. The drag-and-drop quality priority UI is more intuitive than abstract numeric scoring and could serve as a "simplified view" in Praxrr.
- **Confidence**: High -- source code on GitHub and ReadTheDocs documentation confirm architecture.
- **Sources**: [CouchPotato GitHub](https://github.com/CouchPotato/CouchPotatoServer), [CouchPotato Quality Module](https://couchpotatoserver.readthedocs.io/en/stable/_modules/couchpotato/core/plugins/quality/main.html), [Configure CouchPotato V2](https://www.simplehomelab.com/configure-couchpotato-v2/)

### 2013-2014: NzbDrone/Sonarr -- The Paradigm Shift

- **How it worked**: NzbDrone (renamed to Sonarr) was built in C# (.NET) and represented a fundamental architectural departure from SickBeard. It introduced proper quality profiles with upgradeable tiers, calendar views with series box art, and a REST API from the start. The UI was significantly more polished than SickBeard.
- **Configuration approach**: Moved from flat config files to SQLite database for state management and XML config for application settings. Quality profiles became first-class database entities with relationships rather than simple ordered lists. API keys were auto-generated and stored in config.xml.
- **Advantages**: The database-backed approach enabled much richer configuration management. Quality profiles could reference multiple quality definitions. The REST API enabled the entire ecosystem of tools that followed (Recyclarr, Notifiarr, etc.).
- **Why discontinued**: Not discontinued -- it became the foundation of the entire \*Arr ecosystem. However, in the transition from SickBeard to Sonarr, several things were **lost**: the simplicity of a text-file config that could be trivially versioned in Git, the extensibility of post-processing scripts, and the straightforward wanted/skipped/downloaded model.
- **Modern relevance**: The things lost in this transition are exactly what Praxrr can provide. Praxrr's PCD system (append-only ops stored as SQL) bridges the gap between SickBeard's "config as text file" simplicity and Sonarr's database-backed richness. Praxrr should emphasize this heritage: it brings version-controlled, shareable configuration back to the \*Arr ecosystem.
- **Confidence**: High -- well-documented transition in community forums.
- **Sources**: [Sonarr Replaces Sick Beard](http://www.totalhtpc.com/sonarr-replaces-sick-beard-as-the-htpc-dvr/), [SickBeard to Sonarr Migration](https://forums.sonarr.tv/t/making-switch-from-sickbeard-to-sonarr-formerly-known-as-nzbdrone-but-i-have-1-problem/2722)

### 2010-Present: FlexGet -- The YAML Configuration Pioneer

- **How it worked**: FlexGet is a multi-purpose automation tool that pulls content from RSS feeds, Trakt, IMDb, HTML pages, CSV files, and search engines. Users define rules in YAML that specify what to look for, how to match it, and what to do with it.
- **Configuration approach**: Single YAML configuration file. FlexGet pioneered the idea that all media automation rules could be expressed declaratively in a single, human-readable, version-controllable file. Tasks are defined with inputs (sources), filters (quality, regex, series tracking), and outputs (download clients).
- **Advantages**: Full declarative configuration. Infinitely composable through YAML. Easy to version control, share, and diff. The "pipeline" model (input -> filter -> output) is conceptually clean and powerful.
- **Why discontinued**: Not discontinued, but has been eclipsed by the *Arr apps for most users because FlexGet requires comfort with YAML and lacks a GUI. Power users still use it alongside *Arr apps.
- **Modern relevance**: FlexGet's approach validates Praxrr's direction. The idea that media automation configuration should be declarative, version-controlled, and shareable is exactly what Praxrr's PCD system provides. Praxrr could offer a "FlexGet-like" YAML export format for power users who want to manage configuration as code.
- **Confidence**: High -- active project with extensive documentation.
- **Sources**: [FlexGet Official](https://flexget.com/), [FlexGet Configuration](https://flexget.com/Configuration), [FlexGet GitHub](https://github.com/Flexget/Flexget)

### 2012-Present: nzbToMedia -- The Middleware Bridge Pattern

- **How it worked**: nzbToMedia served as postprocessing middleware between download clients (SABnzbd, NZBGet, Deluge, Transmission, etc.) and media managers (SickBeard, CouchPotato, HeadPhones, Mylar, Gamez). Originally based on sabToSickBeard, it evolved to support virtually every combination of downloader and media manager.
- **Configuration approach**: Centralized `autoProcessMedia.cfg` configuration file that contained settings for all connected services. One script (`nzbToMedia.py`) could handle all categories, or multiple specialized scripts could be used. The middleware abstracted away the differences between downloaders and media managers.
- **Advantages**: The bridge/middleware pattern is the key insight. nzbToMedia solved the N-by-M integration problem by sitting in the middle: N downloaders x M media managers could be handled through a single configuration point instead of N\*M individual integrations. It also provided unified failed-download handling and transcoding.
- **Why discontinued**: The \*Arr apps (Sonarr, Radarr) eventually built direct download client integration, reducing the need for external middleware. However, nzbToMedia is still maintained and used.
- **Modern relevance**: This middleware pattern is directly applicable to Praxrr. Praxrr already sits between users and their \*Arr instances. The nzbToMedia pattern suggests Praxrr could serve as a configuration bridge that translates a single canonical configuration into instance-specific formats, handling the differences between Radarr, Sonarr, and Lidarr automatically. The centralized config file approach also validates Praxrr's PCD model.
- **Confidence**: High -- well-documented open source project with clear architecture.
- **Sources**: [nzbToMedia GitHub](https://github.com/clinton-hall/nzbToMedia), [nzbToMedia Wiki](https://github.com/clinton-hall/nzbToMedia/wiki), [autoProcessMedia.cfg](https://github.com/clinton-hall/nzbToMedia/wiki/autoProcessMedia.cfg)

### 2013-2017: HTPC Manager -- The Unified Dashboard

- **How it worked**: HTPC Manager was a Python web application that provided a single interface for managing Plex, Kodi/XBMC, Sonarr, SABnzbd, NZBGet, HeadPhones, SickRage, SickBeard, CouchPotato, and more. It addressed the "too many web interfaces" problem by embedding each service's management into a unified dashboard built with Twitter Bootstrap.
- **Configuration approach**: Modular service integration through a plugin-like module system. Each supported application had its own management module within HTPC Manager. Configuration was centralized but each module maintained its own connection settings.
- **Advantages**: Single pane of glass for the entire media stack. Responsive design (Bootstrap) meant it worked on all devices. The modular approach meant new services could be added without redesigning the entire application.
- **Why discontinued**: Lost momentum as the *Arr ecosystem grew and each *Arr app developed increasingly polished individual UIs. Organizr (PHP-based) largely replaced it by 2017-2018 by offering tabbed iframes for each service rather than trying to re-implement each service's UI.
- **Modern relevance**: The "single pane of glass" pattern is relevant but the implementation lesson is crucial: HTPC Manager tried to replicate each service's UI (which was unsustainable), while Organizr pragmatically embedded them. Praxrr should avoid trying to replicate *Arr UIs and instead focus on the configuration management layer that *Arr apps themselves do not provide. The dashboard pattern could be useful for showing sync status across all connected instances.
- **Confidence**: Medium -- project is largely dormant, documentation limited to archived sources.
- **Sources**: [HTPC Manager GitHub](https://github.com/HTPC-Manager/HTPC-Manager), [HTPC Manager](https://htpc.io/), [SimpleHomelab HTPC Manager](https://www.simplehomelab.com/htpc-manager-for-web-interfaces/)

---

## Obsolete Configuration Patterns

### Pattern: INI/Config File-Based Application Configuration (1990s-2010s)

- **Description**: Applications like SickBeard, CouchPotato, SABnzbd, and most PHP-era self-hosted tools stored all configuration in INI, CFG, or PHP array files on disk. Configuration was read at startup, modified through the web UI, and written back to disk.
- **When used**: Dominant from the mid-1990s through early 2010s.
- **Why discontinued**: Database-backed configuration (SQLite, PostgreSQL) offered richer data relationships, concurrent access, and transactional integrity. Config files could not represent complex relationships between entities (e.g., quality profiles referencing quality definitions).
- **Hidden advantages**: Config files were trivially version-controllable with Git. They could be diffed, merged, shared, and reviewed using standard development tools. Backup was "copy a file." Disaster recovery was "paste a file." Configuration sharing between users was "send a file." None of these operations are simple with database-backed configuration.
- **Revival potential**: **High** -- Praxrr's PCD system already partially revives this pattern by storing configuration as append-only ops that can be versioned and shared. The key insight is that the \*Arr ecosystem moved to databases for good reasons (complex relationships, concurrent access) but lost the version-controllability and shareability of config files. Praxrr bridges this gap.
- **Confidence**: High
- **Sources**: [SickBeard Config on Synology](https://forum.synology.com/enu/viewtopic.php?t=65060), [CouchPotato Settings Config](https://github.com/rwood/ServerInstall/blob/master/configs/couchpotato.settings.conf)

### Pattern: CFEngine's Idempotent Convergence Model (1993)

- **Description**: CFEngine pioneered the idea that configuration management should be idempotent -- describing the desired state rather than the steps to achieve it. The system would compare actual state against desired state and take only the minimum necessary corrective action. This was revolutionary compared to the previous approach of procedural shell scripts.
- **When used**: 1993-present (CFEngine still exists), but the pattern was adopted by Puppet (2005), Chef (2008), Ansible (2012), and ultimately Terraform (2014).
- **Why discontinued**: CFEngine itself was not discontinued but was eclipsed by more user-friendly tools. The core pattern (idempotent convergence) became standard practice.
- **Hidden advantages**: CFEngine's original model was simpler than what followed. It focused on convergence (gradually moving toward desired state) rather than hard enforcement. This graceful-degradation approach is valuable for configuration management of remote instances that may be temporarily unreachable or partially configured.
- **Revival potential**: **High** -- Praxrr's sync pipeline should adopt convergent behavior. Rather than "apply this exact config" (which fails on partial errors), Praxrr should "converge toward this desired state" over multiple sync cycles. This is exactly how Buildarr handles it with idempotent operations, validating this approach.
- **Confidence**: High -- extensive academic and industry documentation.
- **Sources**: [Ops School Config Management](https://www.opsschool.org/config_management.html), [CFEngine vs Puppet](https://www.upguard.com/blog/puppet-vs-cfengine), [Revisionist History of CM](https://purpleidea.com/blog/2016/11/30/a-revisionist-history-of-configuration-management/)

### Pattern: Webmin's Modular Multi-Service Administration (1997)

- **Description**: Webmin, created by Jamie Cameron, provided a web-based administration interface built around 110+ modules. Each module managed a specific service (Apache, BIND, MySQL, users, etc.) through a standardized interface that translated web UI actions into configuration file modifications. Modules could be added/removed without affecting others. Webmin could manage multiple machines through a single interface.
- **When used**: 1997-present (still actively maintained with ~1M yearly installations).
- **Why discontinued**: Not discontinued, but its pattern of "web UI that edits config files" was largely supplanted by applications with native web UIs (like the \*Arr apps). The modular administration pattern was not widely adopted outside Webmin.
- **Hidden advantages**: The module system was genuinely elegant. Each module was a self-contained package that understood a specific service's configuration format. The modules could be community-contributed. Webmin solved the "multiple service administration" problem decades before the self-hosted media stack created the same problem. The pattern of "centralized UI that understands multiple backend config formats" is directly applicable.
- **Revival potential**: **High** -- Praxrr could adopt a module-like pattern for different \*Arr apps. Each "module" would understand Radarr's, Sonarr's, or Lidarr's specific configuration semantics while presenting a unified management interface. This aligns with Praxrr's existing Cross-Arr Semantic Validation Policy.
- **Confidence**: High -- Webmin is well-documented and still actively maintained.
- **Sources**: [Webmin Wikipedia](https://en.wikipedia.org/wiki/Webmin), [Webmin Configuration Module](https://webmin.com/docs/modules/webmin-configuration/), [Linux Journal on Webmin](https://www.linuxjournal.com/content/simplifying-linux-system-administration-webmin)

### Pattern: PHP-Era Hosting Panel Templates and Plans (2000s)

- **Description**: cPanel, Virtualmin, and similar hosting panels introduced the concept of "templates" and "plans" -- predefined configuration bundles that could be applied to new accounts or servers. In Virtualmin, server templates defined defaults for DNS, mail, web, etc., while plans defined resource limits. Templates had to be created before products could be provisioned.
- **When used**: 2000s-present (still used in hosting industry).
- **Why discontinued**: Not discontinued in hosting, but the pattern was never adopted by self-hosted media tools.
- **Hidden advantages**: The template/plan separation is powerful. Templates define "how" (configuration details), while plans define "what" (resource allocation and feature sets). This dual-layer approach allows a small number of templates to serve many different use cases. The requirement that "templates must exist before provisioning" enforced configuration discipline.
- **Revival potential**: **Medium** -- Praxrr could offer "configuration plans" -- predefined bundles of quality profiles, custom formats, and release profiles that can be applied to new \*Arr instances in one click. This is conceptually what TRaSH Guides provides, but Praxrr could formalize it as a first-class concept with versioning and community sharing.
- **Confidence**: Medium -- pattern well-documented but adaptation to media automation is speculative.
- **Sources**: [Virtualmin Pro WHMCS Integration](https://docs.whmcs.com/Virtualmin_Pro), [cPanel vs Webmin](https://ultahost.com/blog/cpanel-vs-webmin/)

### Pattern: Declarative-to-Imperative Translation (2011-2015)

- **Description**: The Infrastructure as Code era (2011-2015) saw a fundamental tension between declarative configuration (CloudFormation, Terraform) and imperative scripting (Chef, shell scripts). The eventual resolution was hybrid approaches: declarative files that could embed procedural logic when needed. AWS CDK (2019) took this further by using full programming languages to generate declarative templates.
- **When used**: 2011-present, evolving continuously.
- **Why discontinued**: Pure declarative approaches were found insufficient for complex business logic. Pure imperative approaches lacked reproducibility. The field converged on hybrid models.
- **Hidden advantages**: The lesson is that neither pure declarative nor pure imperative wins. The best systems let users start with simple declarative config and progressively add procedural logic only where needed. Early IaC tools that forced a single paradigm (declarative-only or imperative-only) were superseded by tools that supported both.
- **Revival potential**: **High** -- Praxrr's PCD system is declarative (append-only ops define desired state). Adding a scripting or expression layer for conditional configuration (e.g., "if instance is Sonarr v4, apply these custom formats") would follow the historical pattern of successful configuration tools.
- **Confidence**: High -- extensively documented evolution.
- **Sources**: [10 Years of Cloud IaC](https://www.nordhero.com/posts/10-years-iac/), [History of IaC - DevOpsBay](https://www.devopsbay.com/blog/entire-history-of-infrastructure-as-code), [IaC History - End of Line](https://www.endoflineblog.com/history-and-future-of-infrastructure-as-code)

---

## Community Config Sharing History

### Kodi Official Add-on Repository (2010-present)

- **How it worked**: Introduced in Kodi "Dharma" version, the addon repository followed the Linux distribution model: a carefully curated main repository enabled by default, with the ability to add third-party repositories. The official repo required manual code review for every addon submission, with Team Kodi checking contents and intentions before inclusion. Each Kodi version had a specific repository branch managed via Git. HTTPS was recommended (and eventually required) for repository transport.
- **Scale**: Hundreds of official addons, thousands of unofficial addons across dozens of third-party repositories. Multiple repository models emerged: developer cooperatives (multiple developers maintaining addons in one repo), curated collections (manually selected addons from various sources), and automated aggregators (scraping whatever was available).
- **Why it ended**: The official repo continues, but the third-party ecosystem was damaged by piracy-related addons that brought legal pressure on Kodi. The lack of code signing and strong authentication in early versions allowed malicious addons to proliferate through unofficial repos.
- **Lessons**: (1) A tiered trust model (official/trusted/untrusted) is essential for community config sharing. (2) Code review for initial submissions is worthwhile but doesn't scale. (3) Repository security (HTTPS, signing) should be built in from the start, not added later. (4) The Linux distribution model (curated default repo + opt-in third-party repos) works well for community content.
- **Confidence**: High -- well-documented by Kodi wiki.
- **Sources**: [Kodi Official Addon Repo](https://kodi.wiki/view/Official_add-on_repository), [Kodi Addon Repositories](https://kodi.wiki/view/Add-on_repositories), [Kodi Unofficial Repos](https://kodi.wiki/view/Unofficial_add-on_repositories)

### TRaSH Guides / Community Custom Format Curation (2020-present)

- **How it worked**: TRaSH Guides emerged from Discord discussions in the *Arr community. Custom formats and quality profile settings were collected, tested, and documented collaboratively. After requesting Team Radarr to add JSON import/export for custom formats, the community gained the ability to share configurations as structured data rather than screenshots. Recyclarr (formerly "Trash Updater") automated the sync of these community-curated settings to *Arr instances.
- **Scale**: The de facto standard for \*Arr configuration. Used by the majority of power users in the community.
- **Why it ended**: Has not ended -- it is the current dominant approach. However, it has limitations: updates are manual unless automated by Recyclarr/Notifiarr, the curation process is opaque, and there is no mechanism for community members to submit variations or locale-specific configurations.
- **Lessons**: (1) Community curation works when there is a clear leader/maintainer (TRaSH). (2) Machine-readable export formats (JSON) are essential for automation. (3) The "single canonical source" model has a bottleneck: one person's preferences become the community standard. (4) There is unmet demand for locale-specific, use-case-specific configuration variants.
- **Confidence**: High -- TRaSH Guides is the current standard.
- **Sources**: [TRaSH Guides](https://trash-guides.info/), [TRaSH Custom Formats Collection](https://trash-guides.info/Radarr/Radarr-collection-of-custom-formats/), [Recyclarr](https://recyclarr.dev/)

### Dotfiles Community (2000s-present)

- **How it worked**: The Unix/Linux community developed a practice of sharing personal configuration files ("dotfiles") through version control. This evolved from manual symlink management to specialized tools: GNU Stow (symlink farm manager), then modern tools like chezmoi (template-based dotfile management with encryption and machine-specific configuration). GitHub dotfiles repositories became a cultural practice where developers would share and fork each other's configurations.
- **Scale**: Millions of dotfiles repositories on GitHub. A thriving ecosystem of management tools.
- **Why it ended**: Has not ended -- continues to evolve. The pattern shifted from "share my exact config" to "share a template that adapts to the target machine."
- **Lessons**: (1) Configuration sharing is a fundamental human desire -- people want to learn from others' setups. (2) Templates are more useful than exact copies because every setup is slightly different. (3) Encryption support is needed for sharing configs that contain secrets. (4) Machine-specific overrides (chezmoi's templates) solve the "one config doesn't fit all" problem.
- **Confidence**: High -- extremely well-documented cultural practice.
- **Sources**: [Chezmoi Why](https://www.chezmoi.io/why-use-chezmoi/), [Brief History of Dotfile Management](https://jonathanbartlett.co.uk/2021/05/14/a-brief-history-of-my-dotfiles.html), [Exploring Dotfile Management Tools](https://gbergatto.github.io/posts/tools-managing-dotfiles/)

### Pre-TRaSH Community Config Sharing (2014-2019)

- **How it worked**: Before TRaSH Guides formalized community configuration, users shared settings through Discord channels, Reddit posts, forum threads, and blog posts. Quality profile settings were communicated through screenshots of \*Arr UI configurations. Custom format definitions were shared as JSON blobs in Discord messages. There was no standardized format, no version control, and no way to track when upstream changes invalidated shared configurations.
- **Scale**: Fragmented across dozens of Discord servers and subreddits.
- **Why it ended**: TRaSH Guides consolidated this fragmented knowledge into a single authoritative source.
- **Lessons**: (1) Configuration sharing will happen regardless of tooling -- it is better to provide good tools than to let ad-hoc sharing proliferate. (2) Screenshots of UI configurations are the worst possible format for config sharing, yet they were ubiquitous because no better option existed. (3) Discord/forums are poor media for versioned configuration data. (4) The demand for "what settings should I use?" is universal and persistent.
- **Confidence**: Medium -- based on community observation rather than formal documentation.
- **Sources**: Community forum discussions on [Sonarr Forums](https://forums.sonarr.tv/), [Reddit r/sonarr](https://www.reddit.com/r/sonarr/), [Reddit r/radarr](https://www.reddit.com/r/radarr/)

---

## Historical Security Approaches

### Apache/Nginx Basic Auth + Reverse Proxy (2000s-2010s)

- **How it worked**: Before self-hosted applications had built-in authentication, administrators placed them behind Apache or Nginx reverse proxies with HTTP Basic Authentication. The htpasswd utility generated credential files, and the reverse proxy would challenge users before forwarding requests to the backend application. Some setups used Digest Authentication (which avoided sending passwords in cleartext) or client certificates.
- **Advantages**: Dead simple to implement. Worked with any backend application regardless of its own auth support. Could protect multiple applications with a single configuration. htpasswd files could be managed independently of the application.
- **Why abandoned**: HTTP Basic Auth sends credentials in base64 (not encrypted) unless HTTPS is used. No support for session management, multi-factor authentication, or single sign-on. Digest Auth was more secure but poorly supported by clients. Modern auth requirements (OAuth, OIDC, MFA) made basic auth insufficient.
- **Modern application**: The pattern of "auth layer in front of application" evolved into Authelia, Authentik, and other forward-auth proxies. However, the simplicity of the original approach is worth noting. For Praxrr, the lesson is that authentication should be separable from the application itself -- Praxrr already supports OIDC, but should also be easy to run behind a forward-auth proxy like Authelia without conflicts.
- **Confidence**: High -- well-documented pattern.
- **Sources**: [Nginx Basic Auth Reverse Proxy](https://medium.com/pernod-ricard-tech/adding-basic-authentication-with-nginx-as-a-reverse-proxy-a229f9d12b73), [Authentication for Multiple Apps Behind Reverse Proxy](https://morganridel.fr/authentication-for-multiple-apps-behind-a-reverse-proxy/)

### API Key as Sole Authentication (2010s)

- **How it worked**: Early self-hosted applications (including the \*Arr apps) used a single API key for all API access. This key was auto-generated, stored in the config file (often XML or JSON), and used by all clients connecting to the application. There was no per-user API key, no scoping, and no key rotation mechanism.
- **Advantages**: Extremely simple. One key, one config entry, done. Low barrier to integration -- any tool could connect by including the API key in the request header.
- **Why abandoned**: Not fully abandoned -- \*Arr apps still use this model. However, it has well-documented problems: if one integration is compromised, all integrations are compromised (single key). API keys were frequently found exposed on the open web. Radarr v5 began obfuscating API keys in API responses, acknowledging the risk. There is no audit trail of which client performed which action.
- **Modern application**: Praxrr stores \*Arr API keys to communicate with instances. It should implement: (1) encrypted storage of API keys (not plaintext in DB), (2) per-integration scoped tokens for its own API, (3) key rotation support, and (4) audit logging of which actions were performed using which credentials. The historical lesson is clear: single shared API keys are a security liability that the community has tolerated because alternatives seemed too complex.
- **Confidence**: High -- current security issue documented by Radarr community.
- **Sources**: [Radarr API Key Obfuscation Issue](https://github.com/Radarr/Radarr/issues/9397), [Exportarr API Key Issue](https://github.com/onedr0p/exportarr/issues/8)

### KeePass / Password Safe -- Self-Hosted Secret Management (2003-2010s)

- **How it worked**: Before HashiCorp Vault (2015) and modern secret managers, self-hosted users relied on KeePass (2003), Password Safe (1997/Bruce Schneier), or encrypted text files for managing credentials. KeePass stored passwords in an AES-encrypted database file that could be synchronized across machines. Some power users wrote scripts to extract credentials from KeePass databases and inject them into application configuration files.
- **Advantages**: Simple, portable, and well-understood. The encrypted database file could be backed up, synced, and shared (with the master password). No server infrastructure required.
- **Why abandoned**: Not abandoned for personal use, but inadequate for application-to-application secret management. KeePass required manual copy-paste or custom scripting for API-driven access. Modern secret managers (Vault, Bitwarden Secrets Manager) offer API access, automatic rotation, and lease-based secrets.
- **Modern application**: Praxrr could integrate with existing secret managers (Vault, Bitwarden) for storing \*Arr API keys instead of keeping them in its own database. Alternatively, Praxrr could offer built-in encrypted credential storage with a master key, following the KeePass model. The lesson is that users already have secret management tools -- Praxrr should integrate with them rather than inventing its own.
- **Confidence**: Medium -- adaptation to Praxrr is speculative.
- **Sources**: [KeePass Wikipedia](https://en.wikipedia.org/wiki/KeePass), [History of Password Management](https://www.acciyo.com/the-long-and-winding-road-a-history-of-password-management/)

### VPN-Only Access / Network Segmentation (2010s)

- **How it worked**: The predominant security advice for self-hosted \*Arr applications was (and remains): "Do not expose to the internet. Use a VPN." Users set up OpenVPN or WireGuard servers on their home networks and connected remotely through the VPN tunnel. Application-level authentication was considered secondary because network access was the primary control.
- **Advantages**: Strong security model -- if the application is not reachable from the internet, most attack vectors are eliminated. Works regardless of the application's own security posture. VPN provides encrypted transport automatically.
- **Why abandoned**: Not abandoned as a recommendation, but increasingly impractical. Users want mobile access, sharing with family members, and integration with cloud services (Overseerr, Jellyseerr) that cannot be behind a VPN. The rise of Tailscale and Cloudflare Tunnels has made "network-level access control" more user-friendly but the fundamental tension between accessibility and security remains.
- **Modern application**: Praxrr should acknowledge this reality in its security model. For users behind VPNs, Praxrr's own auth can be lightweight (AUTH=off or AUTH=local). For users who expose Praxrr to the internet, robust auth (OIDC, MFA) is essential. The feature idea: Praxrr could detect its network context (local only vs. internet-exposed) and recommend appropriate security settings, similar to how Sonarr warns about API exposure.
- **Confidence**: High -- well-documented community security practice.
- **Sources**: [HardForum Securing Plex/Usenet](https://hardforum.com/threads/securing-usenet-client-plex-server.2038104/)

---

## Revival Candidates

### 1. Event-Driven Plugin System (from CouchPotato)

- **Original form**: CouchPotato's `addEvent()`/`fireEvent()` system allowed plugins to hook into any lifecycle event (movie added, search completed, download finished, etc.) without modifying core code. Custom plugins were loaded from a data directory.
- **Why worth reviving**: The \*Arr ecosystem has become largely monolithic -- each app handles everything internally. There is no extension point for community-contributed logic. Praxrr, as a configuration management layer, could offer hooks where custom logic runs during sync, validation, or profile compilation.
- **Modern modifications**: Instead of Python plugins loaded from disk, use JavaScript/TypeScript modules that can be loaded from a plugins directory or a community repository. Leverage Deno's module system for sandboxed execution. Define a clear event API: `onBeforeSync`, `onAfterSync`, `onConfigValidation`, `onProfileCompile`, etc.
- **Feature idea for Praxrr**: A plugin/hook system that allows community-contributed sync validators, config transformers, and notification handlers. Example: a plugin that validates custom format scoring against community benchmarks before sync, or a plugin that transforms quality profiles based on the target instance's version.
- **Confidence**: Medium -- technically feasible with Deno's module system, but adds complexity.
- **Sources**: [CouchPotato Automation Module](https://github.com/CouchPotato/CouchPotatoServer/blob/master/couchpotato/core/plugins/automation.py)

### 2. Configuration Drift Detection (from CFEngine/Puppet)

- **Original form**: CFEngine (1993) and Puppet (2005) continuously compared actual system state against declared desired state and reported/corrected differences. This "drift detection" became a core capability of all configuration management tools.
- **Why worth reviving**: Praxrr syncs configuration to *Arr instances, but currently has limited ability to detect when those instances have been manually modified after sync (configuration drift). Users may tweak settings in the *Arr UI and forget, leading to inconsistencies between what Praxrr thinks is configured and what actually exists.
- **Modern modifications**: Implement a "drift report" that periodically reads \*Arr instance configuration via API and compares it against the PCD-defined desired state. Show diffs in the UI. Optionally auto-correct drift or alert the user. This is exactly what Puppet and Ansible do for infrastructure, applied to application configuration.
- **Feature idea for Praxrr**: A "Configuration Health Check" dashboard that shows: (1) which instances match their PCD configuration, (2) which have drifted, (3) what specifically changed, and (4) one-click reconciliation to bring instances back into desired state.
- **Confidence**: High -- this is a proven pattern from infrastructure management directly applicable to Praxrr.
- **Sources**: [Puppet Configuration Drift](https://www.puppet.com/blog/configuration-drift), [Spacelift on Config Drift](https://spacelift.io/blog/what-is-configuration-drift)

### 3. Centralized Middleware Bridge (from nzbToMedia)

- **Original form**: nzbToMedia sat between N downloaders and M media managers, providing a single configuration point for all integrations instead of N\*M individual configurations.
- **Why worth reviving**: Praxrr manages configuration for multiple \*Arr instances, but each instance type (Radarr, Sonarr, Lidarr) has different configuration semantics. Currently, users must understand these differences. A middleware layer that translates "universal" configuration intent into instance-specific configuration would dramatically simplify multi-instance management.
- **Modern modifications**: Praxrr could define a "universal quality intent" language (e.g., "I want the best quality Bluray releases with lossless audio in movies and TV, and I want standard quality for music") and translate this into Radarr-specific custom formats and quality profiles, Sonarr-specific equivalents, and Lidarr-specific metadata profiles. The PCD would store the intent, and the sync pipeline would generate the instance-specific configuration.
- **Feature idea for Praxrr**: An "intent-based configuration" mode where users describe what they want in plain terms and Praxrr generates the appropriate custom formats, quality profiles, and scoring for each \*Arr instance type. This inverts the current model of "configure technical details per instance."
- **Confidence**: Low -- ambitious and may oversimplify configuration that genuinely requires per-app tuning. However, providing good defaults that can be customized would serve the majority of users.
- **Sources**: [nzbToMedia Wiki](https://github.com/clinton-hall/nzbToMedia/wiki)

### 4. Tiered Community Repository with Trust Levels (from Kodi)

- **Original form**: Kodi's addon repository system had official (code-reviewed, team-maintained), trusted unofficial (known developers, community-verified), and untrusted (use at own risk) tiers. Each tier had different installation workflows and warning levels.
- **Why worth reviving**: Praxrr's PCD system stores curated configuration, but there is no mechanism for community members to share their own PCDs or configuration variants. TRaSH Guides is the only community curation source. A tiered repository would allow multiple configuration sources with appropriate trust levels.
- **Modern modifications**: Implement a PCD repository system: (1) "Official" PCDs maintained by the Praxrr team (e.g., TRaSH Guides integration). (2) "Verified" community PCDs from known contributors (e.g., locale-specific configs, niche use cases). (3) "Community" PCDs from any user (shared at own risk). Each tier would have different import workflows and UI indicators. PCDs could be signed using Ed25519 keys to verify authorship.
- **Feature idea for Praxrr**: A "PCD Hub" -- a community repository where users can publish, discover, and subscribe to configuration databases. Include versioning, changelogs, compatibility metadata (which *Arr versions are supported), and a rating/review system. This would be the "npm for *Arr configuration."
- **Confidence**: Medium -- the technical implementation is straightforward, but building a community around it requires critical mass.
- **Sources**: [Kodi Official Addon Repo](https://kodi.wiki/view/Official_add-on_repository), [Kodi Addon Security Discussion](https://forum.kodi.tv/showthread.php?tid=257492)

### 5. Simplified Quality Drag-and-Drop (from CouchPotato)

- **Original form**: CouchPotato let users drag quality tiers up and down in a list to set priority, and check "Finish" next to a quality tier to stop searching when that quality was found. No numbers, no scoring -- just visual ordering.
- **Why worth reviving**: Quality profile configuration in the \*Arr ecosystem requires understanding numeric scoring (e.g., custom format scores of -10000, 0, 15, 25, 100000). This is powerful but intimidating for new users. CouchPotato's drag-and-drop approach was immediately intuitive.
- **Modern modifications**: Offer a "Simple Mode" for quality profiles that uses drag-and-drop ordering and "stop here" checkboxes, which Praxrr then translates into proper custom format scores and quality profile configurations. Power users can switch to "Advanced Mode" to see and edit the numeric scores directly.
- **Feature idea for Praxrr**: A dual-mode quality profile editor: Simple Mode (drag-and-drop with CouchPotato-style "Finish" checkboxes) and Advanced Mode (current numeric scoring). The Simple Mode generates correct configurations for users who just want "Blu-ray > HDTV > WEB-DL, stop searching at Blu-ray."
- **Confidence**: Medium -- the UI concept is sound, but mapping simplified intent to the complex reality of custom format scoring may produce unexpected results in edge cases.
- **Sources**: [CouchPotato Quality Settings](https://www.simplehomelab.com/configure-couchpotato-v2/), [CouchPotato Quality Module](https://couchpotatoserver.readthedocs.io/en/stable/_modules/couchpotato/core/plugins/quality/main.html)

### 6. YAML/Text Export Format for Config-as-Code (from FlexGet/Dotfiles)

- **Original form**: FlexGet's entire automation is defined in a single YAML file. The dotfiles community shares configuration as version-controlled text files. Both approaches prioritize human-readability and Git-friendliness over GUI-only management.
- **Why worth reviving**: The *Arr ecosystem forces GUI-first configuration with no standard export format. Recyclarr and Buildarr use YAML, but they define their own formats. There is no standard "configuration interchange format" for the *Arr ecosystem.
- **Modern modifications**: Praxrr could define and popularize a standard YAML/TOML format for *Arr configuration that encompasses quality profiles, custom formats, release profiles, and scoring. This format would be: human-readable, version-controllable in Git, diffable, commentable, and importable by Praxrr. Think "docker-compose.yml but for *Arr configuration."
- **Feature idea for Praxrr**: A "Configuration as Code" export/import that produces a clean, documented YAML file representing the entire PCD configuration. Users could manage this file in Git, share it, and import it into other Praxrr instances. This would position Praxrr as the "Terraform of the \*Arr ecosystem."
- **Confidence**: High -- this directly extends Praxrr's existing PCD philosophy and has clear precedent in multiple domains.
- **Sources**: [FlexGet Configuration](https://flexget.com/Configuration), [Chezmoi Design](https://www.chezmoi.io/user-guide/frequently-asked-questions/design/)

---

## Key Insights

1. **The \*Arr ecosystem lost version-controllable configuration when it moved from config files to databases.** SickBeard and CouchPotato had trivially shareable, diffable, backupable configuration. The modern *Arr stack has richer configuration but it is trapped in SQLite databases. Praxrr's PCD system is uniquely positioned to solve this by providing version-controlled configuration that maps to the rich database-backed *Arr configuration. This is Praxrr's strongest historical argument: it restores what the community lost in the SickBeard-to-Sonarr transition.

2. **Middleware/bridge patterns reduce integration complexity from N\*M to N+M.** nzbToMedia proved that sitting between services with a standardized configuration layer dramatically simplifies multi-service management. Praxrr already does this for configuration, but could go further by abstracting instance-specific differences and presenting a unified configuration model that is translated per-instance during sync.

3. **Configuration drift detection is a solved problem in infrastructure management but absent in media automation.** CFEngine pioneered this in 1993. Puppet, Chef, and Ansible made it mainstream. The \*Arr ecosystem has no equivalent -- once configuration is synced, there is no mechanism to detect manual changes. Praxrr could provide this immediately and it would be a genuine differentiator against all competitors (Recyclarr, Notifiarr, Buildarr).

4. **Community curation needs tiered trust and structured repositories.** Kodi's addon repository (2010) and the dotfiles community both demonstrate that users want to share configuration, and that a tiered trust model (official/verified/community) prevents the chaos of unmoderated sharing while still enabling community contribution. TRaSH Guides is a single-tier system (one maintainer, one set of recommendations). Praxrr could enable multi-tier community configuration sharing.

5. **Simplicity and power must coexist through progressive disclosure.** CouchPotato's drag-and-drop quality ordering was more intuitive than numeric scoring, but numeric scoring is more powerful. The IaC evolution showed that pure declarative and pure imperative approaches both fail -- the winners offer both. Praxrr should offer Simple Mode and Advanced Mode for every major configuration surface, not force all users through the power-user path.

---

## Evidence Quality

- **Primary historical sources**: 12 (GitHub repositories, official documentation, archived wikis)
- **Secondary analysis sources**: 8 (community forums, comparison articles, blog posts)
- **Comparative/synthesis sources**: 6 (IaC history analyses, configuration management overviews)
- **Overall confidence rating**: High for historical facts, Medium for modern application recommendations

### Gaps and Uncertainties

- Specific founding dates and motivations for some early tools (SickBeard, CouchPotato) are poorly documented as their original wikis have been taken down or redirected.
- The pre-TRaSH Guides community configuration sharing landscape is reconstructed from community memory rather than archived sources.
- The specific reasons for HTPC Manager's decline are inferred from ecosystem changes rather than documented by the project maintainers.
- The viability of an "intent-based configuration" system (Revival Candidate 3) is speculative and would require significant user research to validate.

---

## Search Queries Executed

1. "CouchPotato SickBeard media automation configuration how it worked history"
2. "SickRage Headphones Mylar media automation features configuration management"
3. "XBMC Kodi addon manager configuration repository history evolution"
4. "NZB torrent automation quality profiles history SABnzbd NZBGet early days"
5. "cfengine early Puppet Chef configuration management lessons learned history 2000s"
6. "PHP self-hosted application admin panel UX patterns cPanel Webmin 2000s 2010s"
7. "early home server security API key management self-hosted apps 2010s approaches"
8. "community curated configuration templates presets sharing platforms history open source"
9. "CouchPotato quality settings configuration ini file format movie automation 2012 2013"
10. "SickBeard quality presets scene naming conventions early Sonarr evolution NzbDrone"
11. "self-hosted media center configuration evolution HTPC 2005 2015 history"
12. "TRaSH Guides history origin Radarr Sonarr custom formats community curation before"
13. "Webmin configuration management module system approach self-hosted server admin history"
14. "reverse proxy authentication self-hosted apps 2010s Apache nginx basic auth"
15. "Recyclarr Notifiarr Buildarr history alternatives Radarr Sonarr configuration automation tools"
16. "config as code infrastructure as code early history 2010 2015 evolution"
17. "CouchPotato plugin system architecture Python media automation extensible"
18. "SickBeard post processing scripts configuration sharing export import history"
19. "Authelia Organizr Heimdall self-hosted dashboard authentication evolution SSO"
20. "htpc-manager self-hosted media server management centralized configuration 2013 2014 2015"
21. "NzbDrone Sonarr history origin creator why built replacement SickBeard 2013 2014"
22. "Radarr origin history fork Sonarr CouchPotato replacement 2016 2017"
23. "WHMCS Virtualmin self-hosted multi-instance management UX credentials"
24. "Kodi addon repository community curation security signing trust model evolution"
25. "FlexGet media automation configuration YAML history features RSS feed automation"
26. "Plex XBMC media library management configuration migration evolution 2010 2015"
27. "early self-hosted application credential vault password management before Vault"
28. "nzbToMedia clinton-hall post processing automation architecture media middleware"
29. "Organizr HTPC dashboard centralized media server management 2017 2018"
30. "Sonarr Radarr API key security plain text configuration file risk"
31. "dotfiles sharing community configuration management stow chezmoi history"
32. "diff configuration drift detection self-hosted applications monitoring"
33. "MythTV XMLTV configuration management TV automation 2000s history"
