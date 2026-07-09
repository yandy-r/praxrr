# Business Research: Transparent Automation Engine Completion

## Executive Summary

Issue #21 is not asking Praxrr to add decorative help text. It establishes a product promise:
whenever Praxrr automates a change or makes a material choice, users can see the relevant inputs,
the decision, the resulting output, and a useful failure reason. Foundation PR #213 supplied the
pure, versioned narration vocabulary and proved it on drift detail. The remaining work is to apply
that promise to the product's highest-trust surfaces without inventing evidence that the underlying
systems do not record.

The current codebase is well positioned for four of the six remaining checklist items:

- Sync preview already has authoritative summary counts, per-section outcomes, entity changes, and
  field changes. Narration can explain those records without recomputing a diff.
- Quality Goals already emits a machine-readable rationale for every scored custom format and a
  reason for every excluded format. The missing business capability is a canonical server-side
  rationale suitable for logs/audit consumers, rather than a second interpretation authored only
  by the UI.
- Resolved Config already exposes base, user-override, and fully resolved views. It can explain
  proven base-vs-user attribution, but it does not retain field-level evidence for a distinct
  database-default source.
- The job registry, job history, sync history, drift, canary, and config-health features provide a
  finite inventory for a formal automation-transparency audit.

One checklist item has a real prerequisite. The sync apply path reports success and item counts by
section, while sync history stores the _pre-sync intended diff_. Neither proves which individual
entity writes actually succeeded. Post-apply narration may truthfully describe section outcomes,
but it must not present planned entity changes as confirmed entity outcomes. If this work does not
add a per-entity outcome contract, issue #21 should move that item to a linked follow-up with explicit
acceptance criteria before closing, exactly as the issue's closure rule allows.

The recommended business outcome is therefore a coherent completion slice:

1. narrate sync preview from existing decision records;
2. canonically narrate/log Quality Goals rationale on the server;
3. expose only provenance the resolved-config model can prove;
4. add contextual explanations where the audit identifies user-facing automation controls/results;
5. publish a complete automation-transparency audit with a disposition for every gap; and
6. create explicit follow-ups for per-entity post-apply outcomes and any provenance source that the
   current model cannot prove.

## User Stories

### Primary users

1. **Safety-conscious operator**
   - As an operator reviewing a sync, I want a concise explanation of what Praxrr plans to do and
     why, so I can confirm the right change without decoding raw field names.
   - As an operator after apply, I want Praxrr to distinguish what was planned from what was actually
     confirmed, so I do not mistake optimistic intent for a successful write.

2. **Casual user learning the domain**
   - As a user who does not know Arr scoring internals, I want Quality Goals to explain how my preset
     and sliders produced each score, so automation teaches me rather than hiding complexity.
   - As a user viewing settings, I want explanations in the context where a scheduled or automatic
     behavior is configured, so I understand scope, timing, side effects, and recovery before
     enabling it.

3. **Power user validating policy**
   - As a power user, I want the exact decision inputs and machine-readable rationale preserved
     alongside friendly narration, so I can verify the math and still edit the generated config.
   - As a power user inspecting resolved config, I want to know whether a value came from the base
     configuration or a user override, and I want ambiguity called out rather than guessed.

4. **Administrator and auditor**
   - As an administrator, I want scheduled, event-triggered, and manual automation to use the same
     explanation standard, so switching trigger modes does not reduce accountability.
   - As an auditor or support responder, I want a finite inventory of automated workflows and their
     transparency coverage, so missing inputs, decisions, outputs, or failure reasons become tracked
     product work rather than tribal knowledge.

### Secondary users

- Maintainers need versioned, deterministic narration so wording changes are reviewable and old
  records remain interpretable.
- Cross-Arr users need explanations derived from the explicit target application; a Radarr term or
  rule must never be silently borrowed for Sonarr or Lidarr.
- Users troubleshooting failures need a safe next step and retry expectation, not merely a raw code
  or a false diagnosis inferred from free-form upstream text.

## Business Rules

### Core rules

#### BR-1: Narration renders evidence; it does not create evidence

The underlying decision or outcome record remains the source of truth. Narration may rename, group,
and explain that record, but it must not rerun a diff, retally counts that already exist, infer an
unrecorded outcome, or silently substitute a different data source.

For sync preview, the authoritative evidence is `SyncPreviewResult`: its `summary`, selected
`sections`, `sectionOutcomes`, and `EntityChange`/`FieldChange` records. A narration count must match
the supplied summary even if a locally filtered view renders fewer entities.

#### BR-2: Planned, attempted, and confirmed are distinct states

- **Planned** means preview data says Praxrr intends to create, update, delete, or leave an entity
  unchanged.
- **Attempted** means an apply or job ran for a section.
- **Confirmed** means the result contract records that the specific action succeeded.

The UI and logs must use those terms consistently. A pre-sync diff retained by sync history remains
planned evidence after the run; section success does not automatically convert each planned entity
into a confirmed per-entity success.

#### BR-3: Summary by default, detail on demand

Every supported surface should provide a terse headline first and an optional verbose explanation.
Verbose mode adds material reasoning or field/category detail; it must not repeat the same sentence,
dump raw objects without context, or over-explain unchanged/trivial operations.

The raw diff/configuration remains available beside narration. Friendly explanation is an additive
layer, not a replacement for inspectable evidence.

#### BR-4: Partial and skipped results stay visible

A preview may succeed for some sections while another section is skipped or fails. Narration must:

- identify the affected section;
- state whether it was skipped or could not be evaluated;
- avoid saying the whole instance is ready or unchanged when coverage is incomplete; and
- keep successful section results visible rather than blanking the entire preview.

Likewise, a post-apply run with both successful and failed sections is partial, not successful.

#### BR-5: Error explanations are safe and actionable

Known structured reason codes may map to specific user-facing explanations. Free-form Arr or server
error strings must not be substring-matched into a stronger diagnosis, because wording can vary by
application and version. Until structured per-Arr error codes exist, preserve the original message in
a neutral frame, add only recovery guidance that is always true, and avoid exposing secrets.

#### BR-6: Cross-Arr semantics are explicit

Every entity/field label, rule explanation, and unsupported-state message must resolve using explicit
`arrType`. An unknown mapping falls back to literal, structurally correct language. It must never use
a sibling Arr application's label or imply parity that has not been proven.

#### BR-7: Quality Goals rationale must reproduce the exact decision

For every scored custom format, the canonical rationale must preserve:

- target Arr type;
- category and classifier rule identifier;
- base score;
- each axis contribution, including its sign and zero-value treatment;
- resolution-ceiling relationship when applicable; and
- final score.

The explanation's arithmetic must equal the emitted score. Unwanted formats must be described as a
hard policy decision, and uncategorized formats must state that they were deliberately left untouched
rather than scored by guesswork. Preview, apply, UI narration, and server-side logging must consume the
same `GoalReason` data; no independent server formula or UI-only business rule may drift from it.

An apply guarded by a stale engine version remains a rejected apply. Its explanation must not imply
that generated scores were persisted.

#### BR-8: Resolved-config provenance is evidence-based

The current business model can prove:

- **base**: the field/value is present in schema + base + tweaks replay before user ops;
- **user override**: the resolved value differs from base according to the existing layer diff; and
- **ambiguous**: a pending value-guard conflict means the displayed result must not be described as
  unqualified final state.

The current model does not prove a distinct **database default** at field level after SQL replay. A
missing user override is evidence of "base-side" provenance, not necessarily evidence that a value was
an explicit base op versus a schema/default. The product must not manufacture a database-default badge
from absence alone. Either add a source-tracking contract or create a linked follow-up with acceptance
criteria for that provenance class.

Nested/list changes require the same caution: a top-level `FieldChange` proves that the field differs,
but not necessarily which individual child value came from which op.

#### BR-9: Config identifiers remain exact

Narration and provenance may reject empty identifiers, but they must preserve the exact persisted config
name used for sync lookup. Friendly display formatting must not trim or normalize the identifier and
then use the display string as a lookup key.

#### BR-10: Contextual explanation has a minimum content standard

Every user-facing control that enables or materially changes automation should explain, in context:

1. what behavior it controls;
2. what targets or entities it can affect;
3. when it runs or what triggers it;
4. whether it writes, observes, retains, or deletes data;
5. what disabling it does; and
6. where the user can inspect the latest result or failure.

Result surfaces should explain trigger/source, scope, outcome, skipped/partial meaning, and recovery.
Generic labels such as "Enabled," "Output," or "Failed" do not satisfy this rule by themselves.

#### BR-11: Template versions are part of the explanation contract

Every narration line keeps the shared template version. A material phrasing/meaning change requires a
version bump. The version identifies the explanation vocabulary, not the underlying engine version;
Quality Goals must continue to expose its own engine version separately.

#### BR-12: The audit is a closure gate, not a best-effort note

The transparency audit must enumerate all registered job types plus material automated decision flows
that do not run as jobs (for example Quality Goals preview/apply and resolved-state computation). Each
entry must receive one of these dispositions:

- **covered**: inputs, decisions, outputs, and user-facing failure reasons are verified;
- **partially covered**: existing evidence is identified and the precise gap is stated;
- **not applicable**: one dimension genuinely does not apply, with rationale; or
- **follow-up**: a linked issue owns the gap with explicit acceptance criteria.

Issue #21 should not close with unowned "future work" rows. The issue itself permits closure when all
remaining items are complete _or_ each is moved to a linked, acceptance-criteria-bearing follow-up.

### Edge cases

- A preview with zero planned changes but one failed section is not "everything is up to date."
- A preview filtered to one section must not narrate its local entity count as the whole-preview total.
- A stale preview may still be readable; narration must preserve the existing warning/block rules and
  must not imply that the snapshot is current.
- Delete narration must retain destructive-action warnings and the stronger confirmation workflow.
- An empty or absent sync error yields a generic safe failure explanation, not a fabricated cause.
- An unsupported Arr section is a deliberate skip with a reason, not an error and not success.
- A Quality Goals category with zero axis contribution should not imply that the slider affected the
  score; verbose output may omit zero terms while the underlying reason object remains inspectable.
- An uncategorized Quality Goals format remains unchanged through apply and is counted in coverage.
- A resolved entity created entirely by user ops has user provenance at the entity level; it must not
  be described as an override of a base entity that never existed.
- A pending value-guard conflict makes provenance conditional even when a value can be rendered.
- Cleanup/retention jobs may legitimately have no domain "decision" beyond configured policy, but the
  audit still needs to show the policy input, number of records/files removed, and failure reason.
- Scheduled, manual, startup, and event-triggered executions of the same operation should converge on
  the same outcome vocabulary; the trigger is context, not a different truth model.

## Workflows

### Workflow 1: Review a narrated sync preview

1. User generates a preview for an Arr instance and selected sections.
2. Praxrr displays the existing instance, target Arr type, generation time, staleness, destructive
   warning, and raw action summary.
3. A narration headline summarizes the authoritative create/update/delete/unchanged counts.
4. Each selected section states whether it completed, was skipped, or failed. Partial coverage is
   called out before any "ready" message.
5. Each entity receives a decision sentence derived from its existing `EntityChange`; verbose mode adds
   meaningful field-level rationale while the current/desired table remains available.
6. User may expand details, regenerate a stale preview, or proceed through existing confirmation.

Decision points:

- no changes + complete coverage -> explain that resolved state already matches;
- changes + complete coverage -> explain the exact planned scope;
- any failed/skipped section -> explain partial coverage and avoid whole-preview certainty;
- deletes -> retain destructive warning and instance-name confirmation;
- stale threshold reached -> warn or block according to current policy.

### Workflow 2: Apply and inspect outcome narration

1. User confirms a valid preview.
2. Praxrr runs the selected sections from that preview.
3. Immediate response may narrate only what its result contract proves (currently overall apply status,
   warning/error, and the reloaded preview state).
4. Sync History provides durable trigger, timing, section outcomes, item counts, failure count, and the
   captured pre-sync intended changes.
5. If per-entity outcome evidence exists, Praxrr may compare planned versus confirmed outcomes and
   narrate each. If not, the UI explicitly labels entity detail as planned changes and links to the
   follow-up that will add confirmed outcomes.

The hard recovery rule is that a failure to capture the pre-sync diff must not break the sync. The
history/detail surface then explains that entity-level intent was unavailable while retaining section
outcomes.

### Workflow 3: Preview and apply a Quality Goal

1. User chooses a target database/profile, Arr type, preset, and optional slider adjustments.
2. Server materializes the current custom-format facts and computes one deterministic `GoalPlan`.
3. User sees coverage, thresholds, scored decisions, uncategorized formats, and a human-readable
   rationale whose math matches each `GoalReason`.
4. Server records/emits the same canonical rationale for preview/apply auditing; the UI does not invent
   a divergent interpretation.
5. Apply verifies the engine version and persists standard guarded PCD ops plus binding metadata.
6. Success states what was persisted; rejection/failure states that no successful apply occurred and
   gives the safe recovery action.

### Workflow 4: Explain resolved configuration provenance

1. User selects a database, entity type, Arr type where required, and entity.
2. Resolved view shows the final payload and a concise explanation of the layer composition.
3. Base view explains that user ops are omitted.
4. User Overrides view identifies changed fields and their base-to-resolved values; an entity absent
   from base is explained as user-created.
5. Resolved fields receive only provenance that can be proven from the layer comparison.
6. Pending conflicts add an ambiguity warning and route the user to conflict resolution.
7. Any unprovable database-default attribution is withheld or explicitly marked unavailable until a
   dedicated source-tracking contract exists.

### Workflow 5: Run the automation-transparency audit

1. Build the inventory from `JobType` and non-job automated decision surfaces.
2. For each workflow, locate authoritative inputs, decision records, output records, user-visible
   surface, and structured failure reasons.
3. Verify—not infer—whether each dimension is exposed to users.
4. Record status and evidence in a durable audit document.
5. Fix small contextual-explanation gaps within this issue where the evidence already exists.
6. Create linked follow-up issues for prerequisite or substantial gaps, each with acceptance criteria
   covering the missing dimensions.
7. Re-run the audit and ensure every row is covered, not applicable with rationale, or linked.

The initial inventory must include at least these workflow groups:

- Arr sync (manual, scheduled, on-pull/on-change, section-specific), preview/apply, and sync history;
- startup Arr pull;
- Arr upgrades and rename;
- PCD repository sync and TRaSH Guide sync;
- drift checks and notifications;
- canary rollout;
- config-health snapshot/scoring and retention;
- backups and cleanup/retention jobs (backup, logs, sync history, config health);
- Quality Goals decisions/apply; and
- resolved-config layer/provenance computation.

## Error Recovery

| Condition                               | Required user-facing behavior                                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Preview generation fails entirely       | Explain that no trustworthy plan was produced; preserve a safe raw reason and invite retry.                     |
| One preview section fails or is skipped | Keep successful sections, name the incomplete section, and block whole-preview certainty.                       |
| Preview is stale                        | Preserve age, warn at the existing threshold, and block apply at the existing hard threshold.                   |
| Apply is partial                        | Identify successful and failed sections; never collapse to success.                                             |
| Per-entity outcome is unavailable       | Label entity changes as planned, show available section outcomes, and do not infer success.                     |
| Quality Goals engine version is stale   | Reject apply, retain the proposed plan for inspection where safe, and require regeneration.                     |
| Quality Goals format is uncategorized   | Leave its score untouched and explain why it was excluded.                                                      |
| Resolved cache/entity is unavailable    | Explain database readiness or not-found state; do not present an empty payload as resolved state.               |
| Pending value-guard conflict            | Mark provenance/resolution ambiguous and link to conflict handling.                                             |
| Arr/network/auth error                  | Use a structured reason when available; otherwise neutral framing without cross-Arr string inference.           |
| Background job is skipped/cancelled     | Explain the governing policy or state (disabled, unsupported, no work, superseded), not merely the status word. |

## Domain Model

### Core entities and relationships

- **Decision Evidence**: a structured record produced by a domain engine, such as
  `EntityChange`, `FieldChange`, `SyncPreviewSummary`, `SyncPreviewSectionOutcome`, `GoalReason`,
  config-health criterion contributions, or a canary state transition.
- **Outcome Evidence**: a record of what execution completed, such as a section `SyncResult`,
  `SyncSectionResult`, `JobHandlerResult`, or persisted sync-history status. Outcome evidence must state
  its granularity.
- **Narration Line**: versioned user-facing rendering of evidence with headline, optional detail, tone,
  and template version. It does not own or mutate the evidence.
- **Automation Workflow**: a material operation or decision flow with trigger, inputs, decisions,
  outputs, failures, and one or more inspection surfaces.
- **Transparency Audit Entry**: workflow-to-evidence mapping and disposition for each transparency
  dimension.
- **Goal Plan**: versioned deterministic translation of intent into CF decisions, thresholds, coverage,
  and standard scoring input.
- **Goal Reason**: machine-readable proof for a single score decision.
- **Resolved Layer State**: base, user-diff, or full resolved entity state, plus pending-conflict status.
- **Provenance Attribution**: a claim about which proven layer produced or changed a value. It is valid
  only when supported by replay/diff evidence.
- **Follow-up Contract**: linked issue used when evidence does not yet exist; must name the missing
  contract, user-visible behavior, edge cases, and tests.

### State transitions

#### Sync preview and apply

`generating -> ready -> applying -> applied`

Failure/expiry branches remain explicit: `generating|applying -> failed`, and a ready preview can become
too stale/expired to apply. Narration follows the state; it must never move the state itself.

#### Explanation confidence

`unavailable -> evidenced -> narrated`

There is no valid transition from `unavailable` directly to `narrated`. Adding a follow-up issue is not
the same as manufacturing a runtime explanation; it is the closure mechanism for the missing evidence.

#### Resolved provenance

- base entity + no user field diff -> proven base-side value;
- base entity + user field diff -> proven user override for that diff scope;
- no base entity + resolved entity -> user-created entity;
- pending conflict -> ambiguous until resolved;
- no source-tracking evidence -> provenance unavailable, not database-default by assumption.

## Existing Codebase Integration

### Foundation and direct reuse

- PR #213 added `$shared/narration`, a single `narrateEntityChange` core,
  `narrateDriftEntity`, `narrateDriftReason`, `narrateDriftCounts`, and the reusable
  `NarrationBlock`. Drift detail demonstrates summary/verbose behavior and user-facing structured
  failure reasons.
- `SyncPreviewPanel` already fetches the full `SyncPreviewResult` and renders raw summary, section,
  staleness, destructive-change, and entity-diff information. `SyncPreviewEntityDiff` already owns raw
  field values. The narration surface should be additive and consume those records.
- The foundation design explicitly deferred `narrateEntityChanges`, preview summary/error narration,
  and the two sync-preview component edits. Its accepted error rule forbids brittle substring matching
  of free-form sync errors.

### Post-apply evidence gap

- `SyncResult` is section-grained: `success`, `itemsSynced`, optional `error`, and optional
  `failedProfiles`.
- The preview apply route returns overall success/error/staleness information and then the client reloads
  the preview; it does not return per-entity write outcomes.
- Sync History (#17 / PR #214) captures the pre-sync planned entity changes and persists section results,
  aggregate status, counts, timing, and errors. Its own contract describes changes as the intended
  before/after diff. This is valuable narration input but not proof that each entity succeeded.

### Quality Goals rationale

- Quality Goals (#20 / PR #215) already defines `GoalReason` with stable code, category, rule id, base,
  axis contributions, and ceiling relationship. `GoalCfDecision` carries that reason and the final score.
- The API exposes decisions and reasons, while `GeneratedConfig.svelte` currently authors the friendly
  `reasonLine` client-side. Moving/canonicalizing that interpretation on the server avoids two business
  vocabularies and makes reasoning available to logs/audit consumers.
- Existing uncategorized coverage is fail-safe: no matching rule means the CF is excluded from scoring
  input and remains untouched. Narration must preserve that property.

### Resolved-config provenance

- Resolved Config Viewer (#25 / PR #207) exposes base, user, and resolved layers. User overrides are
  computed as a field diff between base-only and resolved cache replay, and pending conflict is carried as
  an explicit flag.
- The current response is layer-scoped and does not attach a provenance value to every resolved field.
  The narration foundation's `NarrationProvenance` union is only a forward seam; it is not runtime
  evidence.
- Base replay includes schema, base, and tweaks. Therefore the current system can explain base-side versus
  user override but cannot honestly split all base-side values into explicit base ops versus database
  defaults without more tracking.

### Audit surfaces

- `JobType` currently enumerates the scheduled/background operation inventory, while `JobRunHistory`
  stores status, duration, raw output, and error.
- Background Jobs displays schedule, trigger timing, status, output, and failures, but generic output
  strings do not consistently expose inputs or domain decisions.
- Drift, Sync History, Canary, Timeline, Config Health, Goals, and Resolved Config already provide richer
  domain records and should be treated as patterns/evidence sources rather than replaced by a universal
  generic job explanation.

## Success Criteria

### User-visible behavior

- Sync preview displays a summary/verbose decision log derived solely from the loaded preview record.
- Every selected preview section communicates success, skip, or failure; incomplete coverage cannot be
  narrated as fully up to date or fully ready.
- Each preview entity has a concise rationale while raw current/desired values remain inspectable.
- Quality Goals provides the same canonical human-readable rationale to UI and server/audit consumers,
  and every rationale reconciles exactly to its score decision.
- Resolved Config clearly explains base, user override, resolved composition, user-created entities, and
  pending ambiguity without inventing database-default provenance.
- Material automation settings/results identified by the audit meet the contextual minimum standard or
  are owned by linked follow-ups.

### Integrity and trust

- No narration recomputes authoritative counts/diffs or changes runtime behavior.
- Planned changes are never represented as confirmed per-entity results without outcome evidence.
- Partial, skipped, stale, unsupported, and ambiguous states are represented explicitly.
- Arr-specific terminology and validation use explicit target application semantics.
- Existing destructive confirmations, value guards, engine-version guards, and no-write preview behavior
  remain intact.

### Closure evidence

- A durable audit lists every registered job type and material non-job automated decision flow.
- Each audit row proves coverage, documents why a dimension is not applicable, or links to a follow-up
  issue with explicit acceptance criteria.
- If per-entity post-apply outcomes are not added, a linked follow-up requires: outcome capture for each
  attempted entity, planned-vs-actual correlation, partial/failure representation, persistence/API/UI
  exposure, and tests preventing planned changes from being reported as successes.
- If database-default provenance is not added, a linked follow-up requires: an authoritative source model,
  nested-field semantics, conflict interaction, contract/UI exposure, and tests proving attribution is not
  inferred from absence of overrides.
- ROADMAP and issue #21 reflect the implemented coverage and linked remaining work without claiming a
  prerequisite-dependent item is complete.

## Open Questions

1. **Post-apply contract scope:** Should this issue extend each section syncer to emit per-entity outcomes,
   or should it create the explicit follow-up allowed by #21's closure rule? The latter is safer unless
   all section handlers can provide equivalent outcome semantics in one reviewable change.
2. **What does "server-side rationale" mean operationally for Quality Goals?** The strongest business
   interpretation is a canonical server rendering plus structured `GoalReason` in logging/audit metadata,
   used by both preview and apply. Confirm whether persistence is required or structured logs are the
   intended record.
3. **Database-default provenance:** Is "database default" meant to identify schema/SQLite defaults,
   Praxrr-generated fallback values, or all non-user base-side values? These are different claims and need
   an explicit domain definition before runtime attribution.
4. **Audit granularity:** Should the durable audit use one row per `JobType` (including four Arr sync
   section types and each cleanup) or one row per user-facing workflow with job-type subrows? One row per
   job type is the stronger completeness check; grouped presentation can remain user friendly.
5. **Contextual explanations scope:** Does completion require fixing every audit gap in this PR, or only
   the sync/goals/resolved surfaces plus linked follow-ups for the rest? Issue #21 permits the latter only
   when every remaining gap has explicit acceptance criteria and links.
6. **Narration history:** Template versions are stamped on runtime lines, but sync history currently stores
   evidence rather than rendered narration. Is re-rendering old evidence with the current template desired,
   or should any future persisted narration retain the version used at event time? This is not required for
   the immediate completion slice but should be settled before narration itself is persisted.
