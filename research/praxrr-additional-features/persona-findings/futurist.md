# Futurist Research: New Features for Praxrr Media Automation Config Manager

## Executive Summary

The convergence of locally-hosted AI models, WebAssembly plugin architectures, and passkey authentication creates a transformative window for Praxrr between 2026 and 2028. AI-powered configuration assistants using local LLMs (via Ollama/MCP) can analyze media libraries and recommend optimal custom format scoring, while WASM-based plugin systems (via Extism) could enable community-contributed parsers and format evaluators without compromising host security. The shift toward rootless containers, zero-trust credential management, and federated configuration sharing represents the near-term infrastructure evolution Praxrr should prepare for today.

---

## AI/ML Integration Opportunities

### Local LLM-Powered Configuration Assistant

- **What's emerging**: Self-hosted LLMs via Ollama have reached practical capability thresholds. Entry-level hardware (8-16 GB VRAM) now runs models that outperform older 70B models in logic tasks. The Model Context Protocol (MCP) enables AI assistants to directly interact with Radarr/Sonarr APIs through natural language, with multiple MCP servers (GPTDARR, Berry Kuipers' MCP server, Media Server MCP) already demonstrating this capability.
- **Application to Praxrr**: Praxrr could embed an MCP-compatible interface that lets a local LLM analyze a user's media library, existing custom formats, and quality profile scores, then recommend optimizations. Rather than requiring deep TRaSH Guides knowledge, users could describe their preferences in natural language ("I want the best quality Dolby Vision content but my storage is limited to 50TB").
- **Feature idea**: "Praxrr AI Advisor" -- an optional MCP server that exposes Praxrr's PCD database, sync status, and Arr instance metadata to local LLMs. The advisor could suggest custom format score adjustments based on actual download history, flag misconfigured profiles, and generate new custom formats from natural language descriptions.
- **Timeline**: Near-term (6-12 months). MCP infrastructure is already mature; Ollama integration is straightforward.
- **Confidence**: Medium -- The MCP ecosystem for \*Arr apps is proven, but deep configuration optimization via LLM requires careful prompt engineering and validation to avoid bad recommendations.
- **Sources**:
  - [GPTDARR MCP Server](https://mcp.aibase.com/server/1916354472639963137)
  - [Media Server MCP on GitHub](https://github.com/wyattjoh/media-server-mcp)
  - [Radarr Sonarr MCP](https://mcpmarket.com/es/server/radarr-sonarr)
  - [Self-Hosted LLMs in 2026](https://createaiagent.net/self-hosted-llm/)

### AI-Powered Media Quality Assessment

- **What's emerging**: No-Reference VMAF (NR-VMAF) uses deep convolutional neural networks to estimate perceived video quality without needing a reference file. Netflix's VMAF NEG uses neural network backends to penalize perceptual distortions like over-sharpening and structural hallucination. AI-QC systems in broadcast can now distinguish between intentional artistic choices (film grain, camera shake) and encoding artifacts.
- **Application to Praxrr**: Custom format conditions could be enhanced with AI-based quality scoring. Instead of relying solely on regex-based release title parsing to identify quality characteristics, Praxrr could integrate with a local quality assessment model that evaluates actual file quality post-download. This creates a feedback loop: the AI scores downloads, Praxrr adjusts format preferences accordingly.
- **Feature idea**: "Quality Feedback Loop" -- after sync and download, Praxrr collects quality metrics (VMAF score, resolution verification, HDR metadata validation) from a lightweight local service and surfaces them in the UI. Over time, the system learns which indexers and release groups consistently deliver high quality, automatically adjusting custom format scores.
- **Timeline**: Mid-term (12-24 months). NR-VMAF models exist but require GPU resources; lightweight versions for home servers are still maturing.
- **Confidence**: Medium -- The technology is proven in broadcast/streaming but consumer-grade deployment on home servers requires further miniaturization of models.
- **Sources**:
  - [No-Reference VMAF Paper (IEEE)](https://ieeexplore.ieee.org/document/10564175/)
  - [VMAF or SSIM in 2025 (Simalabs)](https://www.simalabs.ai/resources/vmaf-vs-ssim-2025-ai-enhanced-video-quality-evaluation-guide)
  - [AI-QC Automated Media Quality Control (Promwad)](https://promwad.com/news/ai-qc-automated-media-quality-control)

### AI Configuration Drift Detection and Remediation

- **What's emerging**: Agentic AI systems use graph-based models of configuration dependencies to trace drift origins, identify contributing factors, and predict cascading effects. These systems employ anomaly detection algorithms trained on historical configuration data to continuously monitor configuration states. In DevOps contexts, AI can detect errors, find solutions, and either apply fixes automatically or generate pull requests for review.
- **Application to Praxrr**: Praxrr's PCD ops system (append-only operations with value guards) is already well-positioned for drift detection. AI could enhance this by learning patterns of "healthy" configuration states and flagging anomalies -- for example, detecting when a user's custom format scores diverge significantly from community recommendations, or when sync conflicts indicate upstream schema changes that require user attention.
- **Feature idea**: "Config Health Monitor" -- an AI-powered dashboard widget that continuously compares user ops against base ops and community baselines, flagging configurations that may produce unexpected results. It could also detect when upstream PCD changes would conflict with user overrides before the sync is attempted.
- **Timeline**: Near-term (6-12 months) for rule-based drift detection; mid-term (12-18 months) for ML-enhanced anomaly detection.
- **Confidence**: Medium -- Rule-based drift detection is straightforward; ML-based anomaly detection requires sufficient training data from user configurations.
- **Sources**:
  - [Agentic AI for Configuration Remediation (Algomox)](https://www.algomox.com/resources/blog/agentic_ai_configuration_remediation_from_insight_to_action/)
  - [AI-Based Observability Insights 2026 (Middleware)](https://middleware.io/blog/how-ai-based-insights-can-change-the-observability/)

### Natural Language Custom Format Builder

- **What's emerging**: Natural language interfaces for configuration management are maturing rapidly. OpenClaw translates natural language into executable commands, while n8n's self-hosted AI starter kit enables complex workflow creation through conversational interfaces. The pattern of "describe what you want, get executable configuration" is becoming mainstream.
- **Application to Praxrr**: Custom format creation currently requires understanding regex patterns, field conditions, and scoring logic. A natural language interface could let users describe what they want ("Block low-quality web-dl releases from specific groups" or "Prefer x265 with Dolby Vision profile 8 but accept HDR10+ as fallback") and generate the appropriate custom format definition.
- **Feature idea**: "Natural Language Format Builder" -- a conversational interface (powered by local LLM or API) that translates user intent into custom format conditions, tests them against the PCD cache, and shows which existing releases in their library would match.
- **Timeline**: Near-term (6-12 months). The underlying technology exists; the challenge is domain-specific training/prompting.
- **Confidence**: Medium -- General NL-to-config works; domain-specific accuracy for \*Arr custom format conditions needs validation.
- **Sources**:
  - [OpenClaw Self-Hosted AI Agent (Contabo)](https://contabo.com/blog/what-is-openclaw-self-hosted-ai-agent-guide/)
  - [n8n Self-Hosted AI Starter Kit (GitHub)](https://github.com/n8n-io/self-hosted-ai-starter-kit)

---

## Emerging Technologies

### WebAssembly Plugin System via Extism

- **Current maturity**: WebAssembly 3.0 was released in September 2025 with garbage collection, 64-bit address spaces, and exception handling. Extism is a production-ready framework that enables WASM-based plugin systems in any host language. It supports PDK (Plug-in Development Kit) libraries for C/C++, Java, JavaScript, Go, Rust, Ruby, Python, .NET, and more. Plugins run in sandboxed Wasm runtimes with carefully-controlled interfaces.
- **Impact on media config tools**: A WASM plugin architecture would allow Praxrr to support community-contributed extensions without the security risks of native code execution. Users or community members could write custom format evaluators, release title parsers, notification providers, or sync adapters in any supported language, compile to WASM, and load them into Praxrr.
- **Feature idea for Praxrr**: "Praxrr Plugin Engine" built on Extism. Priority plugin types: (1) custom release title parser plugins (replacing/extending the C#/Go parser), (2) custom format condition evaluators (beyond regex), (3) notification provider plugins, (4) import/export format adapters. Plugins would have constrained access -- they can read input data and return results but cannot access the filesystem or network directly unless explicitly granted permission.
- **Timeline**: Mid-term (12-18 months). Extism is production-ready; the investment is in designing the plugin API surface and PDK.
- **Confidence**: Medium -- WASM plugin systems are proven (Istio, Envoy, moonrepo use them), but WebAssembly's identity in the broader ecosystem remains contested. As RedMonk analyst Kate Holterhoff noted in October 2025, "Wasm's greatest challenge isn't technical, it's existential."
- **Sources**:
  - [Extism on GitHub](https://github.com/extism/extism)
  - [Building Native Plugin Systems with WASM Components](https://tartanllama.xyz/posts/wasm-plugins/)
  - [WASM 3.0 Identity Crisis (RedMonk)](https://redmonk.com/kholterhoff/2025/10/17/wasms-identity-crisis/)
  - [WebAssembly Feature Status](https://webassembly.org/features/)

### Passkey / WebAuthn Authentication

- **Current maturity**: By 2026, all major browsers and mobile platforms fully support passkeys. Integration that used to be a six-month migration is now a 2-3 sprint project. WebAuthn Level 3 specification was published as a Working Draft in January 2025. The FIDO Alliance's Credential Exchange Protocol (CXP) and Credential Exchange Format (CXF) enable secure passkey transfer between providers. The simplewebauthn library provides both client-side and server-side tools for easy integration.
- **Impact on media config tools**: For self-hosted applications like Praxrr that manage sensitive API keys and have network access to media servers, passkeys eliminate the risk of credential theft via phishing, keylogging, or database breaches. No shared secrets need to be stored server-side.
- **Feature idea for Praxrr**: Add passkey/WebAuthn as a first-class authentication option alongside existing local auth and OIDC. Implementation using simplewebauthn (server-side Deno-compatible) with a migration path from password-based auth. This should also support hardware security keys (YubiKey) for high-security deployments.
- **Timeline**: Near-term (3-6 months). Libraries are mature; browser support is universal.
- **Confidence**: High -- The technology is standardized, widely supported, and libraries exist for the Deno/Node ecosystem.
- **Sources**:
  - [Authentication Trends in 2026 (C# Corner)](https://www.c-sharpcorner.com/article/authentication-trends-in-2026-passkeys-oauth3-and-webauthn/)
  - [Passkeys & WebAuthn PRF for E2E Encryption (Corbado)](https://www.corbado.com/blog/passkeys-prf-webauthn)
  - [Passkeys & WebAuthn in 2026 Migration Playbook (Medium)](https://kawaldeepsingh.medium.com/passkeys-webauthn-in-2026-a-practical-migration-playbook-for-passwordless-authentication-5202f09c62a3)
  - [Awesome WebAuthn (GitHub)](https://github.com/yackermann/awesome-webauthn)

### Rootless Container Deployment (Podman / Quadlet)

- **Current maturity**: Podman rootless containers are no longer niche -- they are common in regulated industries as of 2026. Podman's performance is significant: 4x faster startup than Docker, 75% lower memory footprint (no daemon), and can scale to 10,000 containers per user on 16GB RAM. Quadlet (Podman's systemd integration) has effectively replaced Docker Compose for many use cases in the Red Hat/Enterprise Linux ecosystem.
- **Impact on media config tools**: Many \*Arr stack users deploy via Docker Compose. Offering first-class Podman/Quadlet support positions Praxrr for the security-conscious segment of the self-hosted community. Rootless operation means compromising the container does not grant root access to the host -- critical for an application that stores API keys.
- **Feature idea for Praxrr**: Provide official Podman Quadlet unit files alongside Docker Compose files. Document rootless deployment as the recommended production setup. Consider testing CI/CD against both Docker and Podman to ensure compatibility.
- **Timeline**: Near-term (3-6 months). Minimal code changes; primarily documentation and deployment artifact additions.
- **Confidence**: High -- Podman is production-ready and growing; providing Quadlet files is low effort with high security value.
- **Sources**:
  - [Docker vs Podman 2025 Benchmarks (sanj.dev)](https://sanj.dev/post/container-runtime-showdown-2025)
  - [Low-Effort Self-Hosting Using Podman (jasminchen.dev)](https://jasminchen.dev/articles/2025/low-effort-self-hosting-using-podman/)
  - [5 Reasons to Choose Podman in 2025 (Red Hat)](https://www.redhat.com/en/blog/5-reasons-choose-podman-2025)
  - [Docker vs Podman Daemonless Containerization 2026 (toolshelf.tech)](https://toolshelf.tech/blog/docker-vs-podman-daemonless-containerization-2026/)

### Edge Computing and Mesh Networking for Home Servers

- **Current maturity**: The edge computing market is growing from $21.4B (2025) to $28.5B (2026). NPU-first architectures are becoming standard in edge hardware. Edge mesh enables distributed processing with self-healing capability -- if a node fails, traffic reroutes automatically. Small Language Models (SLMs) run effectively on modern edge hardware.
- **Impact on media config tools**: For power users running distributed media setups (multiple locations, NAS devices, remote instances), Praxrr could leverage edge/mesh patterns to sync configurations across geographically distributed \*Arr instances with conflict resolution and eventual consistency.
- **Feature idea for Praxrr**: "Multi-Site Config Sync" -- a peer-to-peer configuration synchronization mode where multiple Praxrr instances share PCD state. Each instance maintains local authority but can pull base ops from peers. Uses CRDTs (Conflict-free Replicated Data Types) or the existing append-only ops model for consistency.
- **Timeline**: Long-term (18-36 months). Requires significant architectural investment.
- **Confidence**: Low -- While edge/mesh technology is maturing, the user base for multi-site Praxrr deployments may be too small to justify the complexity.
- **Sources**:
  - [Edge Computing for Web Hosting 2026 (ActSupport)](https://actsupport.com/edge-computing-for-web-hosting-2026/)
  - [Edge Mesh for Distributed Intelligence (Barbara)](https://www.barbara.tech/blog/why-is-edge-mesh-the-next-hot-topic-for-distributed-intelligence)
  - [Edge AI Future of Local Compute (InfoWorld)](https://www.infoworld.com/article/4117620/edge-ai-the-future-of-ai-inference-is-smarter-local-compute.html)

---

## Future of Media Automation

### AV1 Dominance and AV2 Emergence

- **What experts predict**: AV1 now powers 30% of Netflix streaming and is "on track to become number one." 88% of large-screen devices certified between 2021-2025 support AV1. AV1 achieves 45% fewer buffering interruptions and uses one-third less bandwidth than HEVC while maintaining higher VMAF scores. AV2 is planned with up to 30% better compression than AV1, with hardware support expected 2026-2027. The NGVC (Next-Generation Video Codecs) spec is nearing completion with neural prediction models and AI-driven optimization.
- **Impact on Praxrr**: Custom formats will need to evolve to handle AV1 as the dominant codec and AV2 as it emerges. Current custom format conditions likely already handle AV1, but scoring logic may need adjustment as AV1 quality becomes the baseline rather than the premium. Neural codecs will eventually require entirely new quality assessment approaches.
- **Preparation needed**: (1) Ensure custom format conditions can differentiate AV1 profiles and levels, (2) Add AV2 recognition to the parser when releases appear, (3) Consider how AI-enhanced/neural codec releases will be identified and scored -- these won't fit neatly into existing codec hierarchies.
- **Confidence**: High -- AV1 dominance is confirmed by market data; AV2 timeline has industry backing from AOMedia members.
- **Sources**:
  - [AV1 Powers 30% of Netflix (FlatpanelsHD)](https://www.flatpanelshd.com/news.php?subaction=showfull&id=1764912460)
  - [AV1 vs H.265 Codec Comparison 2026 (Red5)](https://www.red5.net/blog/av1-vs-h265/)
  - [AV1 Codec Dominates 2026 (Free-Codecs)](https://www.free-codecs.com/news/av1-codec-dominates-streaming-landscape-as-2026-begins.htm)

### Neural Codec Impact on Release Quality Assessment

- **What experts predict**: Neural/AI codecs can compress video 30-50% smaller than traditional codecs without quality loss, with some research showing 22.7% better compression than H.266 (VVC). The industry is moving toward hybrid approaches (AI-enhanced traditional codecs) rather than fully neural codecs. Full AI-native codecs are estimated to be a decade away from standardization. Samsung notes that with improving networks, low decoder complexity matters more than bitrate savings.
- **Impact on Praxrr**: As hybrid AI-enhanced encodes proliferate, existing bitrate-based quality heuristics will become unreliable. A low-bitrate AI-enhanced encode could look better than a high-bitrate traditional encode. Custom format conditions will need new signals beyond codec/resolution/bitrate to assess quality.
- **Preparation needed**: (1) Track emerging release group naming conventions for AI-enhanced encodes, (2) Design custom format condition types that can accommodate new quality signals, (3) Consider integration points for external quality assessment tools.
- **Confidence**: Medium -- The technology is real but consumer-facing AI codec releases are still limited. Timeline for widespread impact on the \*Arr ecosystem is uncertain.
- **Sources**:
  - [Neural Video Codecs Future (ahmadsandid.com)](https://www.ahmadsandid.com/blog/how-neural-networks-are-rewriting-the-rules-of-video-compression/)
  - [AI Video Compression Standards Timeline (Streaming Learning Center)](https://streaminglearningcenter.com/codecs/ai-video-compression-standards-whos-doing-what-and-when.html)
  - [AI-Driven Video Compression (Visionular)](https://visionular.ai/what-is-ai-driven-video-compression/)

### Streaming Service Changes Driving Self-Hosting Growth

- **What experts predict**: Self-hosting is surging in 2026, with the market projected to reach $85.2B by 2034. Key drivers: data breaches, rising subscription costs, and privacy concerns. Plex's March 2025 decision to end free remote streaming pushes users toward fully open-source alternatives like Jellyfin. Users are increasingly moving toward open-source, self-hosted solutions to escape subscription models and unwanted advertising. AI assistants (like Claude Code) are making self-hosting dramatically easier, "democratizing access."
- **Impact on Praxrr**: Growing self-hosted media user base means a larger potential audience. As more casual users enter the ecosystem (aided by AI setup assistants), there is increased demand for simplified configuration management. The shift from Plex to Jellyfin may also mean new integration opportunities (Jellyfin API support, Jellyfin-specific configuration profiles).
- **Preparation needed**: (1) Invest in onboarding UX for new self-hosters, (2) Explore Jellyfin integration alongside \*Arr stack support, (3) Consider "wizard" or "template" based setup flows.
- **Confidence**: High -- Market growth data is from multiple sources; Plex policy changes are confirmed.
- **Sources**:
  - [Self-Hosting Surges in 2026 (WebProNews)](https://www.webpronews.com/self-hosting-surges-in-2026-market-to-reach-85-2b-by-2034/)
  - [2026 is the Year of Self-Hosting (fulghum.io)](https://fulghum.io/self-hosting)
  - [Plex vs Jellyfin 2026 (HomeDock)](https://www.homedock.cloud/blog/self-hosting/plex-vs-jellyfin-2026/)
  - [Why I'm Self-Hosting in 2026 (Android Police)](https://www.androidpolice.com/why-im-self-hosting-my-entire-digital-life-in-2026/)

### Sonarr v5 and Arr Ecosystem Evolution

- **What experts predict**: Sonarr v5.0 is 85% complete on GitHub, with remaining features focused on renaming tokens, DVD ordering, and multilingual metadata support. The broader \*Arr ecosystem continues to evolve but at a measured pace. External tools like Profilarr and Configarr are emerging alongside Recyclarr to address configuration management gaps.
- **Impact on Praxrr**: Sonarr v5 API changes will require Praxrr sync pipeline updates. The growing number of configuration management competitors (Profilarr, Configarr, Recyclarr) means Praxrr must differentiate through superior UX, deeper customization, and capabilities these tools lack (multi-Arr support, PCD system, visual configuration).
- **Preparation needed**: (1) Monitor Sonarr v5 API changes on the v5-develop branch, (2) Maintain API version compatibility layer, (3) Track competitor features to identify differentiation opportunities.
- **Confidence**: High -- GitHub milestone data is authoritative; competitor landscape is observable.
- **Sources**:
  - [Sonarr v5.0 Milestone (GitHub)](https://github.com/Sonarr/Sonarr/milestone/4)
  - [Profilarr vs Recyclarr 2026 (CoreLab)](https://corelab.tech/profilarr-vs-trash/)
  - [Configarr on GitHub](https://github.com/raydak-labs/configarr)

---

## Security Innovation Opportunities

### Zero-Trust Credential Management

- **What's emerging**: The 2026 security trend is "identity over network" -- zero trust is shifting from network segmentation to identity-based access. Ephemeral credentials (just-in-time, short-lived) are replacing static API keys and long-lived tokens. Weak secrets management contributed to 22% of security incidents in 2025. Leading self-hosted solutions include Infisical and OpenBao (open-source HashiCorp Vault fork).
- **Application**: Praxrr stores Arr API keys that grant full access to media server instances. Instead of storing these as plaintext in the database, Praxrr could integrate with secrets management tools (Infisical, OpenBao, or even encrypted local vault) and retrieve credentials at sync time only. API keys could be rotated automatically.
- **Feature idea**: "Secrets Vault Integration" -- support for external secrets providers (environment variables, Docker secrets, Infisical, OpenBao) as Arr credential sources. Additionally, implement encrypted-at-rest storage for the local SQLite database using SQLCipher, with the encryption key sourced from the vault or environment.
- **Confidence**: High -- The threat model is real (API keys in plaintext SQLite); solutions are mature.
- **Sources**:
  - [Best Secrets Management Tools 2026 (Cycode)](https://cycode.com/blog/best-secrets-management-tools/)
  - [Open Source Secrets Management for DevOps (Infisical)](https://infisical.com/blog/open-source-secrets-management-devops)
  - [Identity Over Network: 2026 Zero Trust (Aembit)](https://aembit.io/blog/identity-over-network-2026-zero-trust/)

### Passkey Authentication with PRF Extension

- **What's emerging**: The WebAuthn PRF (Pseudo-Random Function) extension enables passkeys to derive encryption keys alongside authentication. This means a single passkey can both authenticate the user AND provide an encryption key for end-to-end encrypted data. Corbado's 2026 research demonstrates using passkey PRF for client-side encryption of sensitive data.
- **Application**: Praxrr could use passkey PRF to encrypt sensitive configuration data (API keys, notification webhook URLs) client-side before storage. Even if the database is compromised, the encrypted data is unreadable without the user's passkey.
- **Feature idea**: "Passkey-Protected Secrets" -- when a user authenticates via passkey, the PRF extension derives an encryption key. This key encrypts/decrypts sensitive fields in the PCD database. The server never sees the plaintext secrets at rest; they're decrypted only during active sessions.
- **Confidence**: Medium -- PRF extension is specified but not yet universally supported across all authenticators.
- **Sources**:
  - [Passkeys & WebAuthn PRF for E2E Encryption (Corbado)](https://www.corbado.com/blog/passkeys-prf-webauthn)

### Audit Trail and Compliance

- **What's emerging**: Configuration management best practices now mandate comprehensive audit trails with policy-based access control. AI-powered observability tools can correlate configuration changes with downstream effects (sync failures, quality degradation). The append-only ops model Praxrr already uses is architecturally aligned with these requirements.
- **Application**: Praxrr's PCD ops system is inherently auditable (append-only). Enhancing this with structured event logging, diff visualization, and rollback capabilities would meet enterprise-grade compliance needs and provide users with full visibility into configuration history.
- **Feature idea**: "Configuration Timeline" -- a visual history of all PCD ops with diffs, showing who changed what, when, and why. Include one-click rollback to any previous state. Integrate with the notification system to alert on unexpected configuration changes.
- **Confidence**: High -- This extends Praxrr's existing architecture rather than requiring new infrastructure.
- **Sources**:
  - [Secrets Management Best Practices 2026 (StrongDM)](https://www.strongdm.com/blog/secrets-management)
  - [AI Configuration Remediation (Algomox)](https://www.algomox.com/resources/blog/agentic_ai_configuration_remediation_from_insight_to_action/)

---

## UX Innovation Opportunities

### AI-Guided Onboarding Wizard

- **What's emerging**: AI agents (Claude Code, OpenClaw) are making self-hosting "borderline boring" by eliminating setup complexity. The pattern of conversational setup wizards that learn user preferences and generate configuration is becoming standard. For media automation specifically, tools like Profilarr offer visual dashboards that simplify what was previously CLI-only configuration.
- **Application to Praxrr**: New users often struggle with understanding custom formats, quality profiles, and scoring. An AI-guided wizard could interview users about their preferences (storage capacity, quality priorities, Arr instances) and generate a complete initial configuration.
- **Feature idea**: "Smart Setup Wizard" -- a step-by-step onboarding flow that (1) discovers connected Arr instances, (2) asks natural language questions about preferences, (3) recommends appropriate PCD database and base ops, (4) generates initial quality profiles with scoring, (5) performs a dry-run sync showing what would change. Optionally enhanced with local LLM for conversational guidance.
- **Confidence**: Medium -- Wizard UX is straightforward; LLM enhancement requires optional dependency management.
- **Sources**:
  - [2026 Year of Self-Hosting (fulghum.io)](https://fulghum.io/self-hosting)
  - [Profilarr Docker Guide 2026 (CoreLab)](https://corelab.tech/setup-profilarr/)

### GitOps-Native Configuration Workflow

- **What's emerging**: GitOps is evolving with AI assistance -- tools can now propose configuration changes, summarize diffs, and provision infrastructure from natural language while enforcing policy and audit trails. The convergence of GitOps, IaC, and AI is creating "intelligent infrastructure management" where configuration changes are automatically validated, tested, and deployed.
- **Application to Praxrr**: Praxrr's PCD system already uses Git for PCD repos. Extending this to a full GitOps workflow where all configuration changes flow through Git (PR-based reviews, automated validation, rollback via revert) would appeal to infrastructure-minded users.
- **Feature idea**: "GitOps Mode" -- an optional workflow where user ops are stored as Git-tracked YAML/JSON files rather than database ops. Changes go through a PR-like review process (even for single-user deployments, as a validation step). AI can summarize what a configuration change will affect across all connected Arr instances before it's applied.
- **Confidence**: Medium -- The technical approach is sound but may over-engineer the workflow for typical users. Should be optional, not default.
- **Sources**:
  - [Convergence of GitOps, IaC, and AI (Medium)](https://medium.com/@Saba_Farooq/the-convergence-of-gitops-infrastructure-as-code-and-ai-revolutionizing-modern-devops-21512f5bab26)
  - [ClickOps to GitOps (Jamf)](https://www.jamf.com/blog/clickops-to-gitops-infrastructure-as-code/)
  - [GitOps Tools 2026 (Spacelift)](https://spacelift.io/blog/gitops-tools)

### Visual Configuration Diff and Preview

- **What's emerging**: Modern DevOps tools increasingly offer visual diff and preview capabilities for configuration changes. AI-assisted tools can summarize complex diffs in natural language, showing not just what changed but what the expected downstream impact will be.
- **Application to Praxrr**: Before syncing configuration to Arr instances, users should see a clear visual preview of every change that will be made -- new custom formats, modified scores, deleted profiles -- with a confidence indicator for each change.
- **Feature idea**: "Sync Preview Dashboard" -- a pre-sync visualization showing: (1) side-by-side diff of current vs. proposed state per Arr instance, (2) impact analysis (how many items affected, which quality profiles change scoring), (3) risk indicators (flagging destructive changes like profile deletions), (4) one-click approval or selective sync (apply some changes, defer others).
- **Confidence**: High -- This is a UX improvement on existing sync functionality; no new infrastructure required.
- **Sources**:
  - [AI DevOps Tools 2026 (Spacelift)](https://spacelift.io/blog/ai-devops-tools)

---

## Future Scenarios

### Optimistic: AI-Native Configuration Management (2027-2028)

Praxrr becomes the central intelligence layer for the \*Arr ecosystem. Local LLMs analyze download history, quality metrics, and community trends to continuously optimize custom formats and quality profiles. A WASM plugin ecosystem thrives, with community contributors writing specialized parsers for niche release formats. Passkey authentication and encrypted secrets make Praxrr the most secure configuration manager in the ecosystem. The growing self-hosted market (projected $85.2B by 2034) brings 10x more users who discover Praxrr through AI-powered setup assistants. Praxrr's federated config sharing lets users publish and subscribe to curated configurations, creating a decentralized alternative to centralized guide repositories.

### Base Case: Enhanced Automation with Selective AI (2026-2027)

Praxrr adds passkey authentication, MCP-compatible API, rootless container support, and improved sync preview UX. Local LLM integration is available as an optional feature for power users. The WASM plugin system is designed but limited to parser plugins initially. Configuration drift detection uses rule-based approaches. The self-hosted market grows steadily, with Praxrr maintaining differentiation through its PCD system and multi-Arr support. AI features enhance but don't replace the core manual configuration workflow.

### Pessimistic: Feature Parity Arms Race (2026-2027)

Competitors (Profilarr, Configarr) adopt AI features faster or the \*Arr apps themselves integrate configuration management (as proposed in the Sonarr forums). AI integration proves noisy -- LLM recommendations are unreliable for nuanced quality preferences, eroding user trust. The WASM ecosystem fragments, making plugin development impractical. Passkey adoption stalls for self-hosted apps due to complexity of managing authenticator registrations without cloud backup. Praxrr's differentiation narrows to the PCD ops system, which most users find overly complex compared to simpler YAML-based tools.

---

## Wild Cards

### What If: Arr Apps Integrate Configuration Management Natively

- **What if**: A proposal already exists on the Sonarr forums to [integrate TRaSH Guides directly into Sonarr](https://forums.sonarr.tv/t/proposal-integrate-trash-guides-directly-into-sonarr/38467). If Sonarr/Radarr build native configuration sync, the value proposition of external tools like Praxrr, Recyclarr, and Profilarr is fundamentally challenged.
- **Impact on Praxrr**: Praxrr would need to pivot from "sync configurations into Arr" to "multi-instance orchestration and advanced configuration that exceeds what Arr apps provide natively." The PCD system's append-only ops, user overrides, and cross-Arr management would remain differentiators that native integration cannot easily replicate.

### What If: Neural Codecs Break Quality Hierarchies

- **What if**: AI-enhanced encodes become common but inconsistent in quality. Some releases labeled "AI-upscale" or "neural-encoded" look better than source; others have hallucination artifacts. The existing quality hierarchy (Remux > Bluray > WEB-DL) breaks down.
- **Impact on Praxrr**: Custom format conditions would need entirely new signal types beyond codec/resolution/bitrate. Quality scoring would need to become probabilistic rather than deterministic. Integration with quality assessment tools (NR-VMAF) would shift from "nice to have" to essential.

### What If: Decentralized/Federated Configuration Sharing Takes Off

- **What if**: Instead of centralized TRaSH Guides and Dictionarry repos, configuration sharing becomes federated via ActivityPub or a custom protocol. Users publish configuration "feeds" that others can subscribe to, with reputation systems ensuring quality.
- **Impact on Praxrr**: Praxrr's PCD system (base ops from repos + user overrides) is already architecturally suited for federated config sources. Adding support for multiple PCD source repositories with priority/merge rules would position Praxrr as the natural client for a federated configuration ecosystem.

### What If: Apple/Google Mandate Passkeys, Passwords Deprecated

- **What if**: Major platforms deprecate password authentication entirely by 2028, as some industry predictions suggest. Self-hosted apps without passkey support become inaccessible from modern devices.
- **Impact on Praxrr**: Early passkey adoption becomes a necessity rather than a feature. Praxrr's existing OIDC support provides partial coverage (if the OIDC provider supports passkeys), but native WebAuthn support would be required for local auth deployments.

---

## Key Feature Ideas for the Future

### Near-Term (3-12 months) -- Build Now

1. **Passkey/WebAuthn Authentication**: Add as first-class auth option alongside local and OIDC. Use simplewebauthn library. Low effort, high security value. **(High Confidence)**
2. **MCP Server Interface**: Expose Praxrr's PCD database and sync capabilities via Model Context Protocol for local LLM integration. Enables AI advisor features without coupling to specific LLM providers. **(Medium Confidence)**
3. **Podman/Quadlet Deployment Support**: Provide official Quadlet unit files and document rootless deployment. Low effort, signals security maturity. **(High Confidence)**
4. **Sync Preview Dashboard**: Visual diff/preview before sync with impact analysis and selective sync capability. High UX value, no new infrastructure. **(High Confidence)**

### Mid-Term (12-24 months) -- Design Now, Build Later

5. **WASM Plugin System (Extism)**: Start with parser plugins, expand to custom format evaluators and notification providers. Design the plugin API surface now, even if implementation comes later. **(Medium Confidence)**
6. **Natural Language Custom Format Builder**: Conversational interface for creating custom formats. Requires local LLM or API integration. Design the domain-specific prompt engineering now. **(Medium Confidence)**
7. **Secrets Vault Integration**: Support external secrets providers (Infisical, OpenBao, Docker secrets) for Arr API key storage. Implement encrypted-at-rest for local storage. **(High Confidence)**

### Long-Term (24-36 months) -- Watch and Plan

8. **AI Quality Feedback Loop**: Post-download quality assessment feeding back into custom format scoring. Requires lightweight NR-VMAF deployment on home servers. **(Medium Confidence)**
9. **Federated Configuration Sharing**: Multi-source PCD subscription with priority/merge rules. Positions Praxrr for decentralized config ecosystem. **(Low Confidence)**
10. **Multi-Site Config Sync**: Peer-to-peer PCD synchronization across distributed Praxrr instances using CRDTs or append-only ops reconciliation. **(Low Confidence)**

---

## Evidence Quality

- **Expert predictions cited**: 12 (from industry analysts, IEEE research, market reports)
- **Market data points**: 6 (self-hosting market size, AV1 adoption, edge computing growth, secrets management incidents)
- **Production-tested technologies**: 8 (Extism WASM, Ollama, passkeys/WebAuthn, Podman, MCP, VMAF, AV1, ActivityPub)
- **Speculative claims**: 5 (federated config sharing, neural codec impact on quality hierarchies, full AI-native configuration management, multi-site sync demand, passkey deprecation of passwords)
- **Confidence rating**: Medium overall -- Near-term features (passkeys, MCP, Podman) are high confidence; mid-term features (WASM plugins, NL builder) are medium; long-term scenarios (federation, AI quality loops) are speculative.

### Temporal Freshness Assessment

- All primary sources are from 2025-2026
- Fast-moving topics (AI/LLM, passkeys, AV1) sourced from 2025-2026 publications
- Stable topics (GitOps, federation protocols) sourced from 2024-2026 publications
- No sources older than 2024 used for technology maturity assessments

### Key Uncertainties

1. **LLM reliability for domain-specific config**: Can local LLMs reliably generate correct custom format conditions, or will they produce plausible-but-wrong configurations?
2. **WASM plugin adoption**: Will the community invest in writing WASM plugins, or is the developer audience too small?
3. **Neural codec timeline**: When will AI-enhanced encodes appear frequently enough in release groups to require new custom format handling?
4. **Federated config demand**: Is there actual user demand for decentralized configuration sharing, or are centralized guides sufficient?
5. **Passkey UX for self-hosted**: How well do passkeys work when the self-hosted app is accessed from multiple devices/locations without cloud sync?

---

## Search Queries Executed

1. "AI powered media quality assessment automation future 2025 2026"
2. "self-hosted application future trends 2026 2027 home server"
3. "AI configuration management optimization self-hosted infrastructure"
4. "WebAssembly self-hosted applications future WASM plugins"
5. "passkey authentication self-hosted applications WebAuthn 2025 2026"
6. "media automation AI integration Radarr Sonarr custom format 2025 2026"
7. "future of home media servers streaming alternatives self-hosted Plex Jellyfin 2026"
8. "GitOps configuration management AI future evolution infrastructure as code 2026"
9. "AV1 Dolby Vision HDR media quality future trends codec 2026"
10. "decentralized self-hosted federation future community configuration sharing"
11. "MCP Model Context Protocol Radarr Sonarr AI media library management 2025 2026"
12. "natural language configuration management interface AI assistant self-hosted tools"
13. "Podman rootless containers self-hosted deployment trends 2025 2026"
14. "credential management secrets vault self-hosted future zero trust 2026"
15. "AI video quality scoring no-reference VMAF perceptual quality model 2025"
16. "Profilarr Recyclarr TRaSH Guides configuration sync comparison 2025 2026"
17. "edge computing home server mesh networking self-hosted future 2025 2026"
18. "open source business model sustainability community curated configuration 2025 2026"
19. "local LLM self-hosted AI assistant configuration recommendation home server Ollama 2026"
20. "WASM plugin system extensibility architecture pattern 2025 Extism"
21. "Sonarr Radarr v5 future roadmap features 2025 2026"
22. "neural codec AI encode video compression future media quality 2025 2026"
23. "ActivityPub federation protocol self-hosted applications sharing configuration community 2025"
24. "AI anomaly detection configuration drift automated remediation self-hosted 2025 2026"
