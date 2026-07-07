# Setup Wizard — UX Research

## Executive Summary

Industry data consistently shows that **60–90% of new signups abandon a product within the first week**, and long/unclear signup or setup flows are cited as a leading driver (Baymard, UXCam, Appcues, SaaSFactor — see Competitive Analysis sources). Praxrr's 80%+ onboarding abandonment sits squarely in this band and is addressable with well-established patterns, not novel invention.

The `/setup/` wizard (Welcome → Connect Arr → Link PCD DB → Select profiles/formats → Preview & Sync → Done) maps cleanly onto the **6-step ceiling** that UX research recommends before completion rates degrade, and its final "Preview & Sync" step mirrors the **dry-run pattern** used by Terraform, rclone, and other tools that mutate external systems — a strong fit given Praxrr writes to a user's live Radarr/Sonarr/Lidarr instances.

The most important finding for differentiation: *_no *arr-ecosystem app (Radarr, Sonarr, Prowlarr) ships a first-run wizard.*_ Users configure everything manually through nested Settings menus, and community guides exist specifically to compensate for this gap. A guided wizard is a genuine differentiator, not table stakes — but it must not feel like it's hiding the power-user shortcuts these users already expect (see "Skip wizard" requirement).

Five design commitments emerge as highest-leverage:

1. **Back-and-forth navigation is non-negotiable** — blocking backward movement increases anxiety and abandonment.
2. **Every async/destructive action needs a distinct state machine** (idle → testing → success/fail) with specific, actionable error copy — never a generic "failed."
3. **The Preview & Sync step should function as a dry run**, not a confirmation dialog — showing a diff of what will change, not just an "Are you sure?" modal.
4. **Skip wizard must persist as a real exit, not a dead end** — power users should land in a normal empty-state dashboard with a persistent "Resume setup" affordance, not be forced to start over if they change their mind.
5. **Accessibility is structural, not cosmetic** — focus management between steps, live-region announcements for async validation, and progress communicated via page title/heading, not color alone.

---

## User Workflows

### Primary flow (first-run, guided)

1. **Welcome** — plain-language explanation of what Praxrr does ("syncs curated quality profiles and custom formats into your Radarr/Sonarr/Lidarr instances"). Single CTA forward; secondary "Skip wizard" link, de-emphasized but always visible.
2. **Connect first Arr instance** — URL + API key, inline validation, explicit "Test Connection" action with idle/testing/success/fail states.
3. **Link PCD database** — default (`Praxrr-DB`) pre-selected as a low-friction default; "use a custom source" as progressive disclosure (collapsed by default).
4. **Select quality profiles + custom formats** — this is the step most likely to overwhelm; needs sensible pre-selected defaults (e.g., a recommended starter profile) rather than a blank multi-select.
5. **Preview & Sync** — dry-run diff of exactly what will be written to the connected Arr instance before the first real sync fires.
6. **Done** — confirmation + "what's next" (e.g., link to databases page, docs, or adding a second instance).

Step count (6) sits at the upper bound of the recommended 3–6 step range — do not add a 7th without splitting into a sub-phase.

### Navigation & control requirements

- **Back must always work.** Every source on stepper UX agrees that blocking backward navigation to "protect" data integrity backfires — users need to feel corrections are possible without restarting. Praxrr's steps have no destructive side effects until the final sync, so back-navigation has no technical hazard to guard against until step 5.
- **Forward-only gating is acceptable only where correctness truly depends on it** — e.g., you cannot select quality profiles (step 4) before an Arr instance and PCD source exist (steps 2–3). Gate on data dependency, not arbitrary sequence.
- **Non-linear/tab-style navigation is not appropriate here** — this is a genuine sequence (each step's options depend on the prior step's data), which is exactly the case where a linear stepper is correct and a free-jump tab pattern would invite invalid states.

### Resumability

- **Persist wizard state server-side** as the user completes each step (Praxrr already has an app DB — a `setup_state` row or reusing existing entity tables is sufficient; no need for a separate ephemeral session store).
- If a user closes the browser mid-wizard, returning to `/setup/` should resume at the last completed step, not restart from Welcome. This addresses the well-documented failure mode where "wizard flows assume one session" and users lose progress on interruption.
- **Skip wizard** should not be a one-way door: exiting to the dashboard should leave a persistent, dismissible banner or checklist item ("Finish setup") so users who skip can resume later without hunting for `/setup/` again.

### Decision points needing explicit design attention

- **What happens after "Test Connection" fails repeatedly?** Provide an escape hatch (e.g., "Save anyway and fix later" is _not_ recommended here — an unreachable Arr instance blocks every downstream step, so failure should block forward progress but must give a specific, actionable reason, not just a red X).
- **What if the user has zero quality profiles/custom formats available from the linked PCD?** This is an empty-state case (see UI/UX Best Practices) that must be designed explicitly, not left as a blank list.

---

## UI/UX Best Practices

### Stepper pattern selection

- Use a **horizontal stepper with 6 labeled steps** for desktop widths, collapsing to a **"Step X of 6" text counter** on narrow/mobile viewports — dot indicators lose the "how many are left" signal past ~5 steps, and Praxrr's wizard is exactly at that boundary.
- Keep step labels short (Welcome, Connect, Database, Profiles, Preview, Done) — long labels wrap and break the horizontal rail.
- Maintain identical stepper placement and style across all 6 screens — don't switch to vertical or drop the stepper on any step, including Preview & Sync, since that step's visual weight (a diff/table view) will be tempting to treat as "different."
- Place Next/Back actions **below the step content**, not floating at the top — consistent with standard wizard button placement guidance.

### Progressive disclosure & sensible defaults

- **Step 3 (Link PCD database):** default to `Praxrr-DB` pre-selected; hide the custom-URL/branch/token fields behind a collapsed "Use a different source" disclosure. This mirrors the "guided start" pattern (sensible defaults + empty-state concierge) recommended for first-time users without cluttering the screen for the common case.
- **Step 4 (Select profiles/formats):** do not present a blank multi-select against a cold empty state. Pre-check a recommended baseline set (if PCD metadata defines one) so the user's first action is _deselecting_ rather than _building from nothing_ — this is the single highest-risk step for cognitive overload given it's the most information-dense screen in the flow.
- Advanced/rare options at every step (custom PCD source, non-default branch, alternate schema ref) should stay in conditional disclosure, not on the main path — consistent with the step-by-step + conditional variants of progressive disclosure.

### Empty states

- If the linked PCD source has zero compatible quality profiles for the connected Arr's `arr_type` (a real scenario per this repo's Arr-parity rules), the empty state must explain _why_ (e.g., "This database has no Sonarr-compatible profiles yet") rather than showing a silent blank list — generic empty states are a documented abandonment trigger (Hotjar: 84% of users hitting unexplained blank states abandon within the session).

### Accessibility (WCAG)

- **Page title / heading per step** should include progress (e.g., "Connect Arr Instance — Step 2 of 6") since screen readers announce the title first on navigation.
- **Focus management:** moving to the next step must programmatically move focus to that step's heading or first field — do not rely on scroll position alone. Never trigger a step transition purely from a focus event; require an explicit Next/Back click or Enter/Space activation.
- **Async validation (Test Connection) must use an ARIA live region** so screen reader users hear "Testing connection…" → "Connected" / "Failed: invalid API key" without needing to re-focus the result.
- **Errors move focus to the first invalid field** with a specific message, not a generic banner alone.
- **Respect reduced motion / no forced timing** — if any inactivity timeout is ever added to the wizard session, WCAG 2.2.1 requires it be extendable or disableable. Simplest compliant choice: no session timeout on the wizard at all, since state is persisted server-side anyway.
- Manual testing with a keyboard-only pass and at least one screen reader (NVDA or VoiceOver) is worth doing before shipping, since automated scanners reliably miss focus-order and live-region issues.

### Responsive

- Horizontal stepper → text counter breakpoint should match the app's existing Tailwind breakpoints rather than introducing a new one.
- Step 5 (Preview & Sync) will likely render a diff/table of changes — this needs a mobile-safe layout (stacked cards or horizontal scroll with visible affordance) since tables are the most common responsive-breakage point in this kind of flow.

---

## Error Handling

### Connection test state machine (Step 2: Connect Arr instance)

| State                          | Trigger                                                                     | UI                                                                        | Copy pattern                                                                            |
| ------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Idle                           | Fields empty or untouched                                                   | Neutral, "Test Connection" button disabled until both fields have content | —                                                                                       |
| Testing                        | User clicks "Test Connection" (or debounced 500ms–1s after typing pause)    | Spinner inline next to button (not full-page — this is a <2s operation)   | "Testing connection…"                                                                   |
| Success                        | 200 + valid API response from Arr instance                                  | Green check, fields locked/confirmed, Next enabled                        | "Connected to Radarr v5.x"                                                              |
| Fail — bad URL/unreachable     | Network error, DNS failure, timeout                                         | Red state on URL field specifically                                       | "Could not reach this address — check the URL and that the instance is running"         |
| Fail — bad API key             | 401/403 from Arr                                                            | Red state on API key field specifically                                   | "Connected, but the API key was rejected — check it in Settings → General → Security"   |
| Fail — wrong arr_type mismatch | Instance responds but type doesn't match expected (if type is pre-selected) | Red state, blocks forward progress                                        | "This looks like a Sonarr instance, but you selected Radarr — check your instance type" |

The distinction between "unreachable" and "reachable but rejected" is the single most valuable error-message improvement over a generic failure — it tells the user which of two completely different problems (network vs. credentials) to fix first, consistent with the general guidance that generic messages ("Validation error") leave users unable to act.

### PCD database link failures (Step 3)

- **Clone/fetch failure** (bad URL, auth required for private repo, network unreachable): show the underlying reason distinctly — "Could not reach repository" vs. "Authentication required — this repository needs a token" vs. "Branch 'main' not found." This repo's own guardrails (local-path sources may not be git repos at all) mean the error surface must not assume every failure is a git error — a local filesystem path should have its own distinct failure copy ("Path not found" / "Path is not readable").
- **Empty/incompatible database** (source has no entities for the connected `arr_type`): treat as an empty state, not an error — see Empty States above.

### Preview & Sync (Step 5)

- If the dry-run/preview computation itself fails (e.g., a malformed op, a compile error against the cache), this is a real error state and should say what failed to compute, not silently show an empty diff — an empty preview and a failed preview must be visually distinguishable.
- If the preview succeeds but shows **zero changes** (already in sync), this is a valid, non-error terminal state — copy should say so explicitly ("Nothing to sync — your instance already matches this configuration") rather than showing a blank diff that reads as broken.

### General validation timing

- Client-side format checks (URL well-formed, API key non-empty) fire on blur, not on every keystroke — real-time keystroke validation is known to disrupt screen reader announcements and feels punitive.
- Once an error is shown, clear it live as soon as the field becomes valid again (don't wait for the next blur) — this "reward early, punish late" asymmetry is the most consistently cited inline-validation principle across sources.

---

## Performance UX

- **Test Connection (Step 2):** this is a <2s network round-trip in the common case. Use a spinner, not a skeleton — skeletons are for layout-heavy content loads (lists, cards), not short blocking actions. Debounce automatic re-tests by 500ms–1s if triggered on typing-pause rather than an explicit button, to avoid hammering the Arr instance on every keystroke.
- **PCD clone (Step 3):** cloning a remote git repo can take several seconds depending on repo size and network. This crosses the "skeleton vs. spinner" threshold research puts at ~1.5–3s — show a determinate or at least labeled indeterminate state ("Cloning Praxrr-DB…") rather than a bare spinner, since unlabeled waits over a few seconds feel worse than labeled ones even at identical duration.
- **Preview & Sync diff computation (Step 5):** this is the step most likely to involve nontrivial server work (compiling ops, diffing against the live Arr state across potentially many profiles/formats). If this can exceed ~3s, use a determinate progress signal or staged microcopy ("Comparing profiles…" → "Comparing custom formats…") rather than a generic "Loading…" — vague progress labels are a documented source of perceived-wait frustration even when actual latency is unchanged.
- **Optimistic vs. pessimistic:** Steps 2–4 (connection test, database link, profile/format selection) should be pessimistic — don't advance the stepper until the server confirms success, since each step's data is a hard dependency for the next. Step 5→6 (actual sync execution) should also be pessimistic given it mutates a real Arr instance; do not show "Done" until the sync job has actually completed or been confirmed queued.

---

## Competitive Analysis

*_No *arr-ecosystem tool has a first-run wizard.*_ Radarr, Sonarr, and Prowlarr all open directly to a settings-driven dashboard with no guided onboarding; users self-assemble the correct order of operations (root folders → download client → API key → cross-app connections) from community guides, because no in-app guidance exists. This is confirmed across multiple independent setup guides and forum threads — the standard advice pattern ("install → set root folders → add download client → get API keys → connect Prowlarr → sync") is itself evidence that this sequencing knowledge lives outside the product, in tribal documentation. **This is Praxrr's clearest differentiation opportunity** — a wizard here isn't catching up to a norm, it's introducing one to a tool category that has never had it.

**Home Assistant** is the closest self-hosted analog with a real wizard: create account → name home → set location → auto-discover devices → finish, completed in a few minutes in-browser. Two lessons transfer directly:

- Auto-discovery ("scans your network and finds devices it recognizes") is the most-praised part of the flow — Praxrr's equivalent is the PCD default-source pre-fill and pre-selected baseline profiles, doing analogous work of reducing first decisions to confirmations.
- The unresolved community criticism is that a **one-time wizard can't serve users who arrive later needing to reconfigure** (e.g., after adding new hardware) — Home Assistant currently has no way to re-run onboarding. Praxrr's wizard should avoid this dead end: keep `/setup/` reachable post-completion (e.g., via a "Connect another instance" action reusing the same steps) rather than gating it as one-time-only.

**Nextcloud** separates concerns cleanly: its container orchestrator (Portainer) has no app-specific onboarding at all — the "first run wizard" is a distinct, dedicated in-app component (`firstrunwizard`) that only explains usage, with the harder setup (SSL, reverse proxy, trusted domains) left to external documentation and a common source of user pain. The lesson: **don't let the wizard's scope quietly expand to cover infrastructure concerns** (e.g., reverse proxy/TLS for the Arr instance itself) that are outside Praxrr's control — scope Step 2's validation strictly to "can Praxrr reach and authenticate to this Arr API," not the user's broader network setup.

**Directus and n8n** both gate a first-run wizard behind creating the initial admin account, and both support environment-variable pre-seeding for automated/scripted deployments (`ADMIN_*` vars in Directus) as an explicit escape hatch for operators who don't want the interactive flow at all. This is a useful precedent for Praxrr's `PRAXRR_DEFAULT_DB_URL`/`PRAXRR_DEFAULT_DB_TOKEN` env vars already documented in this repo's `CLAUDE.md` — the wizard and the env-var auto-link path should be understood as two entry points to the same state, not competing mechanisms (i.e., if `PRAXRR_DEFAULT_DB_URL` is set and successfully auto-links at startup, the wizard's database step should detect this and show it as already-complete rather than re-prompting).

---

## Recommendations

### Must

- Support back-navigation on every step except after the final sync executes (step 5→6 boundary only).
- Persist wizard progress server-side; resuming `/setup/` continues from the last completed step rather than restarting.
- "Skip wizard" must leave a durable, easy-to-find way back in (banner/checklist item on the dashboard), not a one-way exit.
- Connection test (Step 2) must distinguish "unreachable" vs. "reachable but rejected" (bad key) as separate error states with separate copy.
- Preview & Sync (Step 5) must show an explicit diff of what will change and require a distinct confirm action — treat it as a dry run, not a single "Are you sure?" dialog.
- Focus moves to the new step's heading on every Next/Back transition; async validation results are announced via an ARIA live region.
- If `PRAXRR_DEFAULT_DB_URL` (or other env-based auto-link) has already succeeded at startup, the wizard's database step must detect and reflect that instead of re-prompting for a database link.

### Should

- Pre-select a recommended baseline set of quality profiles/custom formats in Step 4 rather than presenting a blank multi-select.
- Default Step 3 to the built-in `Praxrr-DB` source with custom-source fields behind a collapsed disclosure.
- Use a horizontal 6-step stepper on desktop, collapsing to a "Step X of 6" text counter below the app's existing mobile breakpoint.
- Debounce connection-test and any live-typing-triggered validation by 500ms–1s.
- Distinguish empty-preview ("already in sync") from failed-preview computation with different copy and visual treatment.

### Nice-to-have

- A "Connect another instance" re-entry point into the same Step 2 flow post-setup, so the wizard isn't strictly one-time (addressing the Home Assistant re-run gap).
- Staged microcopy during Preview & Sync diff computation if it exceeds ~3s (e.g., "Comparing profiles…" → "Comparing custom formats…") rather than a generic spinner.
- Cross-device resumability (not just same-browser) if Praxrr's auth model supports it — lower priority since this is a self-hosted single-operator tool more often than a multi-device consumer flow.

---

## Open Questions

1. **Does the PCD schema define a "recommended baseline" set of profiles/custom formats** that Step 4 can pre-select, or does this need to be introduced as new PCD metadata? Confirm with PCD/schema owners before committing to the pre-selected-defaults recommendation.
2. **What is the actual expected latency for Preview & Sync diff computation** against a real Arr instance with a nontrivial number of profiles/formats? This determines whether Step 5 needs a determinate progress signal or a simple spinner is sufficient.
3. **Should Step 2 support connecting multiple Arr instances within the wizard itself**, or is the wizard scoped to exactly one instance with "add more" deferred to the post-setup dashboard? The feature description says "first Arr instance," implying the latter, but this should be confirmed since it affects whether Step 2 needs its own mini-loop.
4. **How should the wizard behave if a user starts it, skips it, and then a different operator (multi-user future) revisits `/setup/`?** Out of scope for an initial single-operator self-hosted deployment, but worth flagging given Praxrr's auth modes (`on`/`local`/`off`/`oidc`) already support multi-user scenarios.
5. **Does "Skip wizard" need its own confirmation** ("Are you sure? You can finish this later from the dashboard") or should it be a frictionless single click? Given the emphasis on respecting power users, a frictionless skip (no confirmation) is likely correct, but this should be validated against the target user profile (self-hosted homelab operators who are typically confident skipping guided flows).

---

## Sources

- [Beyond the Progress Bar: The Art of Stepper UI Design (Medium)](https://medium.com/@david.pham_1649/beyond-the-progress-bar-the-art-of-stepper-ui-design-cfa270a8e862)
- [32 Stepper UI Examples and What Makes Them Work (Eleken)](https://www.eleken.co/blog-posts/stepper-ui-examples)
- [Best Practices for High-Conversion Wizard UI Design & Examples (Lollypop)](https://lollypop.design/blog/2026/january/wizard-ui-design/)
- [Beyond the Progress Bar: The Art of Stepper UI Design (Lollypop)](https://lollypop.design/blog/2026/february/beyond-the-progress-bar-the-art-of-stepper-ui-design/)
- [8 Best Multi-Step Form Examples in 2025 + Best Practices (Webstacks)](https://www.webstacks.com/blog/multi-step-form)
- [Stepper UI: 12 Patterns From SaaS Products That Get It Right (Foundey)](https://foundey.com/blog/stepper-ui-best-practices)
- [Stepper UI: Designing Clear Multi-Step Journeys (Edana)](https://edana.ch/en/2026/04/26/stepper-ui-how-to-design-clear-reassuring-and-effective-multi-step-flows/)
- [Onboarding Home Assistant](https://www.home-assistant.io/getting-started/onboarding/)
- [Option to run through onboarding wizards again and again (Home Assistant GitHub)](https://github.com/home-assistant/architecture/issues/228)
- [Make Home Assistant onboarding a smooth landing (Open Home Foundation roadmap)](https://github.com/home-assistant/roadmap/issues/25)
- [GitHub - nextcloud/firstrunwizard](https://github.com/nextcloud/firstrunwizard)
- [GitHub - nextcloud/all-in-one](https://github.com/nextcloud/all-in-one)
- [Any guide for using Portainer with NextCloud? (Nextcloud community)](https://help.nextcloud.com/t/any-guide-for-using-portainer-with-nextcloud/204446)
- [The UX of form validation: Inline or after submission? (LogRocket)](https://blog.logrocket.com/ux-design/ux-form-validation-inline-after-submission/)
- [Usability Testing of Inline Form Validation (Baymard)](https://baymard.com/blog/inline-form-validation)
- [A Complete Guide To Live Validation UX (Smashing Magazine)](https://www.smashingmagazine.com/2022/09/inline-validation-web-forms-ux/)
- [SaaS Onboarding Optimization to Reduce Early Churn (Loyalty.cx)](https://loyalty.cx/saas-onboarding-optimization/)
- [Why Users Drop Off During Onboarding and How to Fix It (SaaSFactor)](https://www.saasfactor.co/blogs/why-users-drop-off-during-onboarding-and-how-to-fix-it)
- [7 SaaS Onboarding Best Practices to Boost Retention (UXCam)](https://uxcam.com/blog/saas-onboarding-best-practices/)
- [Form Accessibility: WCAG-Compliant Forms (Form.io)](https://form.io/features/form-accessibility/)
- [Accessible Multi-Step Forms: WCAG Compliance & UX Best Practices (accessibility.chat)](https://www.accessibility.chat/articles/multi-step-forms-where-user-experience-and-accessibility-collide)
- [Multi-page Forms (W3C WAI)](https://www.w3.org/WAI/tutorials/forms/multi-page/)
- [Accessibility Support for the Wizard Component (Telerik Design System)](https://www.telerik.com/design-system/docs/components/wizard/accessibility/)
- [Prowlarr Guide: What It Does, Setup, Ports and Sonarr/Radarr (RapidSeedbox)](https://www.rapidseedbox.com/blog/prowlarr-guide)
- [How to proper setup radarr, sonarr, prowlarr (Unraid forums)](https://forums.unraid.net/topic/130582-how-to-proper-setup-radarr-sonarr-prowlarr/)
- [Skeleton Screens vs Loading Spinners: When to Use Each (Onething Design)](https://www.onething.design/post/skeleton-screens-vs-loading-spinners)
- [☠️ Loading spinners and loading skeletons (Productboard Engineering)](https://medium.com/productboard-engineering/%EF%B8%8F-spinners-versus-skeletons-in-the-battle-of-hasting-b51b9c6574ef)
- [Preview Sync Changes with Dry Run Before Transferring (RcloneView)](https://rcloneview.com/support/blog/dry-run-preview-sync-before-transfer-rcloneview)
- [The "Dry Run" Button: UX That Saves Your Users Money (Medium)](https://medium.com/@Praxen/the-dry-run-button-ux-that-saves-your-users-money-a0a9be0b16fe)
- [UI patterns for async workflows, background jobs, and data pipelines (LogRocket)](https://blog.logrocket.com/ux-design/ui-patterns-for-async-workflows-background-jobs-and-data-pipelines/)
- [Wizard UI Pattern: When to Use It and How to Get It Right (Eleken)](https://www.eleken.co/blog-posts/wizard-ui-pattern-explained)
- [Onboarding UX: 10 patterns, best practices, and real examples (Appcues)](https://www.appcues.com/blog/user-onboarding-ui-ux-patterns)
- [Deploying Directus](https://directus.io/docs/self-hosting/deploying)
- [Configure self-hosted n8n for user management](https://docs.n8n.io/hosting/configuration/user-management-self-hosted/)
- [Understanding the 4 Key Variants of Progressive Disclosure in UX Design (Medium)](https://medium.com/@mahfuzbd86/understanding-the-4-key-variants-of-progressive-disclosure-in-ux-design-7513c5360cb4)
- [What Is Progressive Disclosure in UX? (UXPin)](https://www.uxpin.com/studio/blog/what-is-progressive-disclosure/)
- [Progressive disclosure in UX design: Types and use cases (LogRocket)](https://blog.logrocket.com/ux-design/progressive-disclosure-ux-types-use-cases/)
