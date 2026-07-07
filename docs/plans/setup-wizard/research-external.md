# Setup Wizard — External Research

Research for the first-run guided onboarding flow (`/setup/`): Welcome → Connect Arr instance →
Link PCD database → Select profiles/formats → Preview & Sync → Done.

## Executive Summary

This feature is almost entirely internal — there is no third-party onboarding SaaS to integrate.
The external surface is narrow:

1. **Servarr connectivity checks** — Radarr/Sonarr/Lidarr all expose a `GET /api/{version}/system/status`
   endpoint gated by an `X-Api-Key` header (or `?apikey=` query string). This is exactly the pattern
   already implemented in `BaseArrClient.testConnection()`
   (`packages/praxrr-app/src/lib/server/utils/arr/base.ts:68-91`) — the wizard's step 2 should reuse
   that method rather than hand-rolling a new fetch.
2. **Wizard/stepper UX** — no dependency is justified. SvelteKit's own routing + `+layout.svelte` +
   form actions with `use:enhance` is the idiomatic way to build a route-based wizard, and matches
   the progressive-enhancement pattern already used in `packages/praxrr-app/src/routes/auth/setup/+page.svelte`.
   No runes are needed; a plain writable store (or server-persisted session/cookie state) covers
   cross-step data.
3. **Onboarding best practice** — Home Assistant's onboarding flow (linear, few steps, deep-linkable,
   "Finish" lands on the real dashboard) and Nielsen Norman Group's smart-device onboarding guidelines
   (visual step wizard, transparent error messages) are the closest analogues to "connect a self-hosted
   app instance and land in the real UI."
4. **Accessibility** — there is no dedicated ARIA "wizard" pattern. The applicable guidance is the
   APG's button/context-change focus rule (move focus to the start of the new step on Next/Back) plus
   `progressbar` (not `meter`) for a step-completion indicator if one is rendered as a percentage.

## Primary APIs

### Servarr Connectivity-Test API

All three targets (Radarr, Sonarr, Lidarr) share the same .NET "Servarr" backend and the same
auth/status contract, but the **API version differs by app** — this is a real gotcha, not a
theoretical one, and the codebase already encodes it correctly.

| App     | API root   | Status endpoint         | Docs |
|---------|-----------|--------------------------|------|
| Radarr  | `/api/v3` | `/api/v3/system/status`  | https://radarr.video/docs/api/ |
| Sonarr  | `/api/v3` | `/api/v3/system/status`  | https://sonarr.tv/docs/api/ |
| Lidarr  | `/api/v1` | `/api/v1/system/status`  | https://lidarr.audio/docs/api/ |

Community/mirror docs (useful when official sites don't render full schemas in a fetch):
- Sonarr wiki API page: https://github.com/Sonarr/Sonarr/wiki/API
- Lidarr wiki API page: https://github.com/lidarr/Lidarr/wiki/API
- Servarr Wiki (shared conventions, API key requirements): https://wiki.servarr.com/
- Servarr Wiki — Radarr system/API key notes: https://wiki.servarr.com/radarr/system
- Servarr Wiki — Lidarr system/API key notes: https://wiki.servarr.com/lidarr/system

**Auth mechanism (identical across all three apps):**
- Header: `X-Api-Key: <key>` — the header name and casing praxrr already uses in
  `BaseArrClient` (`base.ts:38`).
- Alternative: `?apikey=<key>` query string (not used in this codebase; header is preferred and
  should stay the only supported mechanism for consistency).
- API key is found in each app's **Settings → General** page, and per the Servarr Wiki must be at
  least 20 characters (Radarr/Lidarr system pages both document this minimum-length validation —
  worth surfacing as an inline hint in the wizard's connect-instance step, since a too-short key is
  a plausible first-run mistake).

**Existing praxrr implementation to reuse, not duplicate:**
- `BaseArrClient.testConnection()` (`packages/praxrr-app/src/lib/server/utils/arr/base.ts:68-91`)
  calls `GET /api/{apiVersion}/system/status`, logs, and returns a boolean. It has built-in retry
  logic (3 attempts) inherited from `BaseHttpClient`.
- `apiVersion` is `'v3'` by default on `BaseArrClient` (`base.ts:33`) and is overridden to `'v1'` in
  the Lidarr subclass (`packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts:23`,
  comment: `// Lidarr uses v1 API`). The wizard's "test connection" action must instantiate the
  correct per-`arr_type` client subclass (Radarr/Sonarr/Lidarr client) rather than a generic client,
  so the version resolves correctly — this is also required by this repo's Cross-Arr Semantic
  Validation Policy (no implicit sibling fallback on `arr_type`).
- For inline URL+API-key validation, the wizard step should call testConnection() (or a thin
  wrapper returning the parsed `ArrSystemStatus` — `appName`/`version`/`osName`, already typed in
  `arr/types.ts:953`) synchronously from a SvelteKit form action so the same request both validates
  and displays "Connected to Radarr v5.x" feedback in one round trip, avoiding a second call before
  the instance record is persisted.

**Failure-mode gotchas to surface in the UI (not just log):**
- Wrong port/URL → connection refused / timeout (BaseHttpClient retries 3x before failing — the
  wizard should show a spinner covering that retry window, not just an instant error).
- Wrong or too-short API key → typically a 401; some Servarr versions return 200 with an
  auth-redirect HTML page instead of JSON if hit at the wrong base path — worth defensive JSON
  parsing/try-catch around the existing client rather than assuming every non-2xx is the only
  failure shape.
- Reverse-proxy/base-URL-path instances (e.g. `https://host/radarr`) — the URL field should accept
  a path suffix; `BaseHttpClient`'s base URL handling should already cover this since normal arr
  CRUD elsewhere in the app does.

## Integration Patterns

### Wizard / Stepper Patterns for SvelteKit (no runes)

No third-party stepper library is warranted — this is a 6-step linear flow with server-side
validation at nearly every step (Arr connectivity, PCD link, profile/format selection), which maps
naturally onto SvelteKit's existing form-action model rather than a client-side component wizard.
Client-only stepper libraries surveyed for reference (not recommended as dependencies):
- https://github.com/uduma-sonia/svelte-wizard
- https://madewithsvelte.com/svelte-steps
- Svelte's own "multisteps forms" playground example: https://svelte.dev/playground/7b05d57dcdc04f49be72844e4b2825b3

These are pure client-state wizards (no persistence across reload, no progressive enhancement) and
don't fit a flow where each step has a real server-side side effect (saving an Arr instance,
linking a database). The closer architectural reference is progressive-enhancement-based:
https://github.com/stephane-vanraes/sveltekit-multistep-form (route-per-step + form actions;
returned 404 on direct fetch during this research pass — verify it still exists before treating it
as a canonical source, but the pattern it demonstrates is the standard documented SvelteKit
approach below regardless).

### Recommended shape (route-based, matches existing `auth/setup` precedent)

```
routes/setup/
  +layout.svelte       # shared shell: step header, progress indicator, back/next chrome
  +layout.server.ts    # load(): read wizard progress from session/cookie or DB flag; redirect
                        # to the correct step if a user deep-links past an incomplete one
  welcome/+page.svelte
  connect-arr/+page.svelte
  connect-arr/+page.server.ts   # action: testConnection() via the per-arr_type client, save instance
  link-database/+page.svelte
  link-database/+page.server.ts
  select-profiles/+page.svelte
  select-profiles/+page.server.ts
  preview-sync/+page.svelte     # reuses issue #7 sync-preview component/endpoint
  preview-sync/+page.server.ts
  done/+page.svelte
```

Cross-step state: persist to the **app DB** (a `setup_state` row/flag or reuse of the entities
being created — the Arr instance and linked database rows themselves double as "progress") rather
than only a client store, so a browser refresh or crash mid-wizard doesn't lose progress. A
lightweight writable store (`$stores/`) can still hold ephemeral UI-only state (which step is
"active" for the progress bar) — this does not require runes and is consistent with
`packages/praxrr-app/src/lib/client/stores/` conventions already in the repo.

Example step action pattern (no runes, mirrors `routes/auth/setup/+page.svelte:77-86`):

```svelte
<!-- routes/setup/connect-arr/+page.svelte -->
<script lang="ts">
  import type { ActionData } from './$types';
  import { enhance } from '$app/forms';
  import { alertStore } from '$alerts/store';

  export let form: ActionData;
  let testing = false;

  $: if (form?.error) alertStore.add('error', form.error);
</script>

<form
  method="POST"
  action="?/testAndSave"
  use:enhance={() => {
    testing = true;
    return async ({ update }) => {
      await update();
      testing = false;
    };
  }}
>
  <!-- url, apiKey, arr_type inputs -->
</form>
```

```ts
// routes/setup/connect-arr/+page.server.ts
export const actions = {
  testAndSave: async ({ request }) => {
    const data = await request.formData();
    const client = createArrClient(data.get('arr_type'), data.get('url'), data.get('apiKey'));
    const ok = await client.testConnection();
    if (!ok) return fail(400, { error: 'Could not connect. Check URL and API key.' });
    // persist instance, redirect to next step
    throw redirect(303, '/setup/link-database');
  },
};
```

This keeps validation server-side (consistent with "contract-first API" / fail-fast conventions),
avoids CORS/browser-side API-key exposure entirely (the browser never talks to the Arr instance
directly — the SvelteKit server does, same as the rest of the app), and reuses `BaseArrClient`
verbatim.

### Progress indicator

Render step progress as a simple ordered list of labelled steps with the current step marked
`aria-current="step"` (see Accessibility section) rather than a numeric `progressbar`/`meter` —
matches the linear, named-step nature of onboarding better than a percentage bar.

## Onboarding Best-Practice References

- **Home Assistant onboarding** — https://www.home-assistant.io/getting-started/onboarding/
  Linear 5-step flow (Preparing → Welcome/create-or-restore → account → integrations → Finish),
  entirely browser-based, ends by landing on the real working dashboard rather than a static
  "success" screen. Directly analogous to ending praxrr's wizard on a working dashboard/database
  view instead of a dead-end confirmation page.
  Related roadmap discussion arguing onboarding shouldn't be strictly one-and-done (users may need
  to revisit steps, e.g. add a second Arr instance later):
  https://github.com/home-assistant/roadmap/issues/25
- **Getting-started framing** (installation → onboarding → first real action) —
  https://www.home-assistant.io/getting-started/
- **Nielsen Norman Group — Smart-device onboarding guidelines** —
  https://www.nngroup.com/articles/smart-device-onboarding/
  Key takeaways applicable here: present the flow as a visual step wizard with clear, actionable
  steps; make failure messages specific and actionable (map directly onto the Servarr connectivity
  failure modes above — "wrong API key" vs "host unreachable" should be distinguishable messages,
  not a generic "connection failed").
- **General onboarding-wizard pattern reference** —
  https://userguiding.com/blog/what-is-an-onboarding-wizard-with-examples

## Accessibility (WAI-ARIA)

There is no dedicated ARIA "wizard" role/pattern in the APG — the applicable guidance is composed
from adjacent patterns:

- **Focus on step change** — W3C APG button guidance: "If the button action indicates a context
  change, such as move to next step in a wizard... it is often appropriate to move focus to the
  starting point for that action." On Next/Back, move focus to the new step's heading (use
  `tabindex="-1"` on an `<h2>` and `.focus()` it) rather than leaving focus on the button or losing
  it to `<body>`. Source: https://www.w3.org/TR/2021/NOTE-wai-aria-practices-1.2-20211129/ and the
  live APG: https://wai-aria-practices.netlify.app/aria-practices/
- **Progress indicator semantics** — do NOT use the `meter` role for step progress; APG explicitly
  states meter "should not be used to indicate progress, such as loading or percent completion of a
  task." Use `progressbar` only if rendering a percentage; for a named-step list, use a plain list
  with `aria-current="step"` on the active item instead. Meter pattern reference:
  https://www.w3.org/WAI/ARIA/apg/patterns/meter/
- **If any step is rendered as a modal/dialog** (not recommended here — full-page steps are
  simpler and match the existing `auth/setup` precedent), the Dialog (Modal) Pattern's focus-trap
  and initial-focus rules apply: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- **General focus/keyboard-nav guidance** for the connect/select steps (form fields, checkboxes for
  profile/format selection): logical tab order, visible focus indicators meeting WCAG contrast,
  no keyboard traps — https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Accessibility/WAI-ARIA_basics
- Cross-screen-reader testing caveat: dialog/alertdialog ARIA roles behave inconsistently between
  NVDA and VoiceOver even when APG is followed exactly — another reason to prefer full-page steps
  over modal steps for this flow: https://www.deque.com/blog/aria-modal-alert-dialogs-a11y-support-series-part-2/

## Constraints / Gotchas Specific to This Codebase

- **arr_type dispatch is mandatory, not optional.** Per this repo's Cross-Arr Semantic Validation
  Policy, the connect-instance step must resolve the Arr client and `apiVersion` explicitly from
  the user-selected `arr_type` — never assume Radarr's `v3` applies to Lidarr's `v1`. The existing
  subclasses already encode this; the wizard must not reimplement `system/status` calls inline.
- **Default PCD DB**: `PRAXRR_DEFAULT_DB_URL` (defaults to `https://github.com/yandy-r/praxrr-db`,
  empty string explicitly disables auto-link) should pre-fill the "Link PCD database" step's
  default option, with a "use a different database" escape hatch to a custom URL/local path —
  this env var and its `main`-branch/`Praxrr-DB`-name defaults are documented in this repo's
  CLAUDE.md and should not be reintroduced as a hardcoded fallback in the wizard.
  Local-path sources are valid but not necessarily git repos (Local-Path Source Guardrails) — the
  wizard's link-database step must not assume `.git` exists for a local path.
  Never send a bare `PRAXRR_DEFAULT_DB_URL=""` back into a fallback URL — this repo's convention
  treats an explicit empty value as an intentional opt-out, not a broken config.
- **Preview & Sync step** should call into whatever sync-preview surface issue #7 already
  established rather than building a new preview code path — this research pass did not locate
  that implementation directly; confirm its route/component location before wiring step 5.
- No new npm/deno dependency is justified anywhere in this feature; every external interaction
  (Arr connectivity, PCD git clone/local path) already has a first-party client in this codebase.

## Open Questions

1. Should the wizard be resumable/re-enterable (Home Assistant's roadmap debate) — e.g. can a user
   who already completed setup revisit `/setup/` to add a second Arr instance, or is it strictly
   first-run-only and gated behind a "setup complete" flag thereafter?
2. Where does "setup complete" get persisted — a dedicated app-settings flag, or inferred from
   "at least one Arr instance + one linked database exist" (matching how `auth/login` infers
   "no local users exist → redirect to `/auth/setup`")?
3. Does step 5 (Preview & Sync) reuse an existing route/component from issue #7 verbatim, or does
   the wizard need a simplified read-only variant? Needs confirmation against that issue's actual
   implementation, which was out of scope for this external-research pass.
4. Multi-instance-at-once support: is step 2 strictly "one Arr instance to unblock setup" with
   additional instances added later via the existing `/arr/new` flow, or should the wizard loop to
   add more before proceeding?
