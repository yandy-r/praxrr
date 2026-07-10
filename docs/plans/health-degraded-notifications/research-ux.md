# UX Research: Config Health Degradation Notifications

## Executive Summary

Issue [#223](https://github.com/yandy-r/praxrr/issues/223) should extend the existing notification-service workflow, not add a dashboard or a separate alert-management surface. A user opts each service into one new event under a `Config Health` category; existing and newly created services remain opted out until the user selects it. The notification should answer four questions in one scan: which instance changed, what changed, what evidence contributed, and where to review it.

Use the user-facing label **Config Health Decreased** and title **Config health decreased on {instanceName}**. “Decreased” describes the observed comparison without implying fault, urgency, or a required fix. Preserve Praxrr's existing health-band labels (`Healthy`, `Attention`, `Needs review`) and show both words and scores; color may reinforce status but must not carry meaning alone.

Discord should receive one compact warning embed. Lead with the transition, include at most three criterion changes with short factual context, then link to the existing `/config-health/{instanceId}` detail view. The full report, trends, and non-judgmental suggestions already live there. Delivery remains best-effort: a failed webhook must not change snapshot-job success, and the settings history should remain the place to inspect attempted delivery.

## User Workflows

### Opt in

1. The operator opens **Settings → Notifications**, creates or edits a service, and expands **Event Types**.
2. Under **Config Health**, they select **Config Health Decreased**.
3. Supporting copy, if rendered, says: “Notify when an instance's measurable config health decreases.” It should also make clear that unchanged, improving, unknown, and unmeasurable results do not notify.
4. Saving confirms that the notification service was updated. No historical notification is sent when the option is enabled.

The repository already derives this picker from `notificationTypes` in `lib/shared/notifications/types.ts`. Adding the catalog item therefore preserves the current per-service mental model and avoids health-specific settings UI. The form initializes unknown event IDs to `false`, which supports explicit opt-in.

### Receive and assess

1. A measurable regression produces one notification for each enabled service that selected `health.degraded`.
2. The operator first sees instance/app and the previous-to-current transition.
3. They scan a small set of criterion changes to understand likely contributors.
4. They follow **Review config health** to the existing instance detail page for the complete breakdown, trend, profiles, and suggestions.

Recommended compact content:

```text
Config health decreased on Living Room Sonarr

Previous   88 · Healthy
Current    76 · Attention
Change     −12 points · band changed

Contributors
Completeness: 92 → 74 (−18)
Coherence: 86 → 79 (−7)

Review config health
```

Use “Contributors” rather than “Causes”: the persisted criteria explain the score change but do not necessarily prove root cause. If no individual criterion decreased, say “The overall result decreased; no single criterion change was identified” rather than omitting context or inventing a cause.

### Verify delivery

The existing **Send test notification** action remains the preflight check. After real events, **Recent Notifications** provides service, event type, status, and time. A failed health notification should appear as **Failed** without interrupting the health snapshot workflow. No retry, acknowledgement, silence, or remediation workflow is required by this issue.

## UI/UX Best Practices

- Keep the option in the current grouped event picker: category **Config Health**, label **Config Health Decreased**. Do not expose the internal ID `health.degraded` as primary user copy.
- Ensure the label stands alone because `NotificationType.description` is currently not rendered. Rendering the description beneath the label would be helpful, but is not required to introduce this event.
- Preserve explicit opt-in. Do not preselect the event, backfill existing `enabled_types`, or emit historical regressions after save.
- Make the entire visible option one checkbox interaction, with the visible label as its accessible name and any explanatory text as its description. The current `IconCheckbox` has `role="checkbox"` but can be unnamed, while a separate adjacent button toggles the same state. WAI's checkbox pattern requires an accessible label, Space-key operation, and an accessible group label; native checkbox/label semantics are preferable when practical ([WAI Checkbox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/), [WAI Names and Descriptions](https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/)).
- Use a target of at least 24 by 24 CSS pixels, or sufficient spacing/equivalent target, and keep the label clickable. The current icon target is 20 by 20 pixels; the surrounding row should provide the effective target rather than requiring precision ([WCAG 2.2 Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)).
- Do not rely on amber/red/green alone. Always pair color with the band label, numeric score, signed delta, and transition wording ([WCAG 2.2 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color)).
- Keep save/test feedback available to assistive technology through the existing alert system. Success, failure, and progress messages added without moving focus need appropriate status or alert semantics ([WCAG 2.2 Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages)).

### Discord readability

- Use one embed with warning color, not one embed or message per criterion. Discord permits 25 fields and 6,000 combined embed characters, but those limits are ceilings rather than readability targets ([Discord Message Resource](https://docs.discord.com/developers/resources/message#embed-limits)).
- Put the event in the title, identity in author/title, and evidence in short named fields. Use inline fields only for the symmetric **Previous** and **Current** values; keep **Contributors** and the details link full width.
- Show a maximum of three changed criteria, ordered by largest score/contribution decrease. Add “+N more in config health” when truncated.
- Truncate user-controlled names and criterion context safely. Avoid raw JSON, IDs, engine internals, webhook URLs, stack traces, and full suggestion prose.
- Use the snapshot generation time, not an ambiguous send-time-only value. Include the explicit Arr type because similarly named instances may exist across apps.
- Prefer a fully qualified details URL when Praxrr has a canonical public base URL. A relative path is still useful as text but is not actionable as a Discord link.
- Do not place instance or criterion names in webhook `content`; keeping them in embed fields reduces accidental mention parsing. Mention behavior is shared notifier behavior and should not be changed only for this event.

## Error Handling

- Snapshot persistence is the primary user outcome. Notification construction, lookup, delivery, or history-recording failure must not mark the snapshot job failed or hide the new report.
- Record each attempted service delivery in existing history with `health.degraded`, the generic title, and **Success** or **Failed**. Treat **Success** as “the webhook request completed without an observed error,” not guaranteed human receipt.
- Do not show a snapshot-page error when Discord delivery fails; that would conflate health measurement with an optional outbound channel. Log the failure and surface it through notification history.
- Keep test-notification errors immediate and actionable: identify the service and advise checking the webhook configuration/history, without exposing the webhook URL or Discord response secrets.
- If a criterion value is absent, use “Not evaluated.” If the prior/current snapshots are unknown or incomparable, send no event; do not present uncertainty as degradation.
- If the details destination is unavailable, the notification evidence must remain understandable on its own. The link is the next step, not the only explanation.

## Performance UX

- One logical degradation should produce one compact webhook request per opted-in service. This avoids visible multi-message fragmentation and the notifier's one-second pause between embed chunks.
- Bound criterion selection before formatting so long names or suggestions cannot create payload rejection. Discord rejects messages that exceed embed constraints; a conservative single-embed budget prevents an invisible delivery failure.
- Deduplicate at the persisted health-event level. Repeated unchanged snapshots should stay quiet, reducing alert fatigue and preserving trust that a new notification represents new evidence.
- Dispatch after the report is durable and outside the snapshot success path. The user can open the linked detail view immediately even if delivery is slow or another service fails.

## Competitive/Pattern Analysis

Grafana separates a short summary, a more detailed description, and a `runbook_url` or dashboard link so an alert says what happened and gives a path to investigation ([Grafana alert annotations](https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rules/annotation-label/)). Praxrr can apply the same hierarchy without a new runbook system: title as summary, score/band and criteria as evidence, and the existing Config Health detail route as the investigation link.

Prometheus Alertmanager treats deduplication, grouping, and routing as notification concerns designed to prevent floods ([Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/)). Issue #223 needs only the smallest analogous pattern: persisted event deduplication and per-service routing through the existing manager. Grouping multiple instances, silences, acknowledgements, and escalation policies would expand the product beyond the stated scope.

Praxrr's current upgrade and rename embeds establish useful visual conventions—author identity, concise title, structured fields, timestamp, and footer—but their multi-embed detail pattern is unnecessary here. The compact canary/drift style is the closer model because health notifications are prompts to inspect an existing detail surface, not complete reports delivered in chat.

## Recommendations

### Must

- Add `health.degraded` as an unselected **Config Health → Config Health Decreased** event in the existing per-service picker.
- Use factual, non-judgmental copy with instance, explicit Arr type, previous/current score and band, signed change, and bounded criterion context.
- Send one warning embed and always include generic title/message content for history and future transports.
- Provide an actionable link to `/config-health/{instanceId}`; use an absolute URL when safely available.
- Preserve text labels and numeric evidence in addition to color.
- Ensure the event option has an accessible name, state, keyboard operation, group context, and practical pointer target.
- Keep notification failure independent from snapshot success and record attempted delivery through existing history.

### Should

- Limit the embed to the top three criterion decreases and summarize any remainder.
- Make “Previous” and “Current” visually parallel, with **Change** stated explicitly rather than relying on an arrow.
- Use snapshot time and a stable `Praxrr Config Health` footer.
- Render catalog descriptions in the event picker or otherwise explain what will and will not trigger this event.
- Improve history formatting so `health.degraded` displays as **Config Health Decreased**, and expose a safe failure summary on demand if the existing history design supports it.

### Nice

- Preview the health notification from the service editor using fixture data.
- Add a direct **Review notification settings** link from Config Health documentation, not a new dashboard control.
- In a separate notification-infrastructure change, clarify delivery-confirmation semantics and shared mention behavior across every event type.

## Open Questions

1. What same-band score drop is meaningful enough to notify, and should that threshold be fixed or configurable?
2. Does continued worsening during one degraded episode notify for every meaningful new edge, or only after recovery resets the episode?
3. Which criterion measure determines ranking—raw criterion score drop, weighted contribution drop, or a stable combination?
4. Which persisted criterion detail is safe and concise enough for Discord, and what fallback copy is used when no criterion decreased?
5. Is a canonical external Praxrr base URL always available for a clickable Discord details link?
6. Should notification history expose sanitized delivery errors, or remain status-only for this issue?
7. Is the reusable event-picker checkbox accessibility improvement included in #223, or tracked as a focused follow-up while the new catalog item uses the best available accessible naming?
