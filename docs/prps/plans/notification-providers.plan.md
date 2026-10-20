# Plan: Notification providers, registry, and retry (YAN-530 / GH #331)

Target release: **v0.8.0** (next minor on `main`).

## Summary

Discord is the only notifier and the provider is chosen by hard-coded `switch` statements in five
places (manager, settings test action, new/edit form actions, upgrade + rename processors). Add a
notifier **registry**, a generic JSON **webhook** (versioned payload, optional HMAC, custom headers,
schema in OpenAPI `webhooks`), native **ntfy, Gotify, Pushover, Telegram, Slack** notifiers, an
**Apprise API** notifier, bounded **retry** of transient failures with attempt counts in history, a
**Resend** action, and **secret masking** in UI, logs and history.

## Acceptance criteria (spec)

1. New-service form offers webhook + ntfy, Gotify, Pushover, Telegram, Slack, Apprise (+ Discord).
   Each has a working "Test" action and per-event-type filtering.
2. Every emitted notification event is delivered through the generic path (registry → manager →
   notifier); upgrade/rename no longer bypass the manager. Webhook payload has a contract test
   against the OpenAPI schema.
3. Transient failures (network error/status 0, 408, 429, 5xx) are retried up to `MAX_ATTEMPTS = 3`
   total attempts with bounded exponential backoff; 429/503 honor `Retry-After` (capped); history
   records the attempt count.
4. Provider secrets are never sent to the browser, never logged, and never written to history
   (error text is masked with the provider's secret values).

## Decisions

| Decision                                                                                                                                                 | Why                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Retry inside a shared `postJson` delivery helper, per HTTP request, not around `notifier.notify`                                                         | Discord sends one message per embed; retrying the whole notify would duplicate already-delivered chunks           |
| `attempts` = highest attempt number reached by any request in a delivery                                                                                 | One number per history row; 1 means first-try success                                                             |
| `Retry-After` > 60 s → stop retrying, fail now                                                                                                           | Never park a delivery for minutes; bounded latency                                                                |
| Test action uses `maxAttempts: 1` and does not write history                                                                                             | Fast feedback; tests are not events                                                                               |
| Remove `BaseHttpNotifier`'s silent 1 s "rate limit skip" and its error swallowing                                                                        | Instances are created per send so the limiter never worked; swallowing errors made failed sends record as success |
| Form rendered from shared field descriptors (one generic component)                                                                                      | Eight providers without eight near-identical Svelte files; server validation uses the same descriptor             |
| Secret fields: required on create, blank on edit keeps existing value; edit `load` strips them and returns `secretsSet`                                  | Existing Discord behavior, generalized                                                                            |
| SSRF: user URLs pass `assertSafeOutboundUrl` (metadata + link-local blocked, LAN allowed) at save and send time; `redirect: 'manual'` already enforced   | ntfy/Gotify/Apprise are commonly self-hosted on the LAN                                                           |
| HMAC: `X-Praxrr-Timestamp: <unix s>` + `X-Praxrr-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>`                                      | Common replay-resistant scheme (Stripe/Slack style)                                                               |
| Custom headers can't override `content-type`, `content-length`, `host`, `x-praxrr-*`; names must be RFC 7230 tokens; values no CR/LF; values are secrets | Header-injection and spoofing safety                                                                              |
| Encrypting notification configs at rest is out of scope                                                                                                  | Tracked by YAN-546                                                                                                |
| Discord embed author comes from service config inside `DiscordNotifier` (fill missing `author`) instead of passing config into definitions               | Lets upgrade/rename/test build one notification for all services                                                  |

## Contract (all slices code against this)

### `packages/praxrr-app/src/lib/server/notifications/types.ts` (slice A)

```ts
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';
export interface NotificationContext {
  instanceId?: number;
  instanceName?: string;
  arrType?: string;
}
export interface Notification {
  type: string;
  generic?: GenericNotification;
  discord?: DiscordNotification;
  severity?: NotificationSeverity; // override; else resolveSeverity(type)
  context?: NotificationContext;
  occurredAt?: string; // ISO; set by builder at build()
}
export interface DeliveryResult {
  attempts: number;
}
export interface DeliveryOptions {
  maxAttempts?: number;
}
```

`NotificationServiceType` and `NotificationServiceConfig` become the union of provider types/configs
(type union lives in `$shared/notifications/providers.ts` as `NotificationProviderType`).

### Notifier (`notifications/base/Notifier.ts`, slice A)

```ts
export interface Notifier {
  notify(
    notification: Notification,
    options?: DeliveryOptions
  ): Promise<DeliveryResult>; // throws NotificationDeliveryError
  getName(): string;
}
```

### Delivery helper (`notifications/base/delivery.ts`, slice A)

```ts
export const MAX_ATTEMPTS = 3; export const BASE_DELAY_MS = 1000; export const MAX_RETRY_AFTER_MS = 60_000;
export class NotificationDeliveryError extends Error { constructor(message: string, readonly attempts: number, readonly status?: number) }
export const deliveryTiming: { sleep(ms: number): Promise<void> };   // overridable in tests
export function isTransientStatus(status: number): boolean;           // 0, 408, 429, >=500
export async function postJson(url: string, body: unknown, options: {
  headers?: Record<string, string>; maxAttempts?: number; secrets: readonly string[];
  bodyText?: string;  // pre-serialized body (webhook HMAC signs exact bytes)
}): Promise<DeliveryResult>;   // throws NotificationDeliveryError with masked message
export function maskSecrets(text: string, secrets: readonly string[]): string; // replaces each non-empty secret (and its URL-encoded form) with '***'
```

`HttpError` (`$utils/http/types.ts`) gains optional `retryAfterMs?: number`, parsed by
`BaseHttpClient` from `Retry-After` (delta-seconds or HTTP-date). `postJson` also falls back to
Telegram's `response.parameters.retry_after` (seconds). Webhook client `sendWebhook(url, payload,
headers?)` gains a headers arg and accepts a raw string body.

### Content helpers (`notifications/content.ts`, slice A)

```ts
export function resolveSeverity(n: Notification): NotificationSeverity; // override, else type suffix: failed|error→error; partial|degraded|detected|warn→warning; success|promoted→success; else info
export function renderText(n: Notification): { title: string; message: string }; // generic or 'Notification'/''
export function truncate(text: string, max: number): string; // appends '…' when cut
```

### Registry (`notifications/registry.ts`, slice A; provider modules from slice B)

```ts
export type ProviderFormInput = Record<string, string | boolean>;
export type ParseResult<C> =
  { ok: true; config: C } | { ok: false; error: string };
export interface ProviderDefinition<C = Record<string, unknown>> {
  type: NotificationProviderType;
  validate(input: ProviderFormInput): ParseResult<C>; // input already merged with kept secrets
  create(config: C): Notifier;
  secretValues(config: C): string[]; // every secret string (incl. custom header values, URLs embedding tokens)
}
export function getProvider(type: string): ProviderDefinition | undefined;
export function parseProviderForm(
  type: string,
  form: FormData,
  existingConfig?: Record<string, unknown>
): ParseResult<Record<string, unknown>>;
export function toClientConfig(
  type: string,
  config: Record<string, unknown>
): { config: Record<string, unknown>; secretsSet: string[] };
export function createNotifier(
  type: string,
  configJson: string
): Notifier | null;
```

`parseProviderForm` reads each descriptor field from `FormData` (`checkbox` → `=== 'on'`; others →
trimmed string), substitutes the existing value for blank secret fields when `existingConfig` is
given, then calls `validate`. Provider modules (slice B) export a `const <name>Provider:
ProviderDefinition<...>` from `notifiers/<name>/provider.ts`: `discordProvider` (slice A),
`webhookProvider`, `ntfyProvider`, `gotifyProvider`, `pushoverProvider`, `telegramProvider`,
`slackProvider`, `appriseProvider` (slice B).

### Shared descriptors (`packages/praxrr-app/src/lib/shared/notifications/providers.ts`, slice B; client-safe)

```ts
export type NotificationProviderType =
  | 'discord'
  | 'webhook'
  | 'ntfy'
  | 'gotify'
  | 'pushover'
  | 'telegram'
  | 'slack'
  | 'apprise';
export interface ProviderField {
  key: string;
  label: string;
  kind: 'text' | 'url' | 'password' | 'textarea' | 'checkbox' | 'number';
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
  help?: string;
  defaultValue?: string | boolean;
}
export interface ProviderDescriptor {
  type: NotificationProviderType;
  label: string;
  description: string;
  fields: ProviderField[];
}
export const notificationProviders: readonly ProviderDescriptor[]; // display order: discord, webhook, ntfy, gotify, pushover, telegram, slack, apprise
export function getProviderDescriptor(
  type: string
): ProviderDescriptor | undefined;
export function isNotificationProviderType(
  type: string
): type is NotificationProviderType;
```

Discord fields keep existing keys: `webhook_url` (url, secret, required), `username`, `avatar_url`,
`enable_mentions` (checkbox).

### Manager (`notifications/NotificationManager.ts`, slice A)

```ts
export interface ServiceDeliveryOutcome { success: boolean; attempts: number; error?: string } // error already masked
notify(notification: Notification): Promise<void>; // unchanged semantics: enabled + subscribed services, never throws
sendToService(service: NotificationService, notification: Notification, options?: { maxAttempts?: number; record?: boolean }): Promise<ServiceDeliveryOutcome>;
```

Records history (default `record: true`) with `attempts` and `metadata: { severity, context }`.

### History (slice A)

Migration `20261022_add_notification_history_attempts.ts` (version `20261022`):
`ALTER TABLE notification_history ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1;` registered in
`db/migrations.ts`; mirrored in `db/schema.sql`. `NotificationHistoryRecord.attempts: number`,
`CreateNotificationHistoryInput.attempts?: number`, new `getById(id: number)`.

### Webhook payload v1 (slice B)

```json
{
  "version": 1,
  "id": "<uuid>",
  "type": "sync.failed",
  "severity": "error",
  "title": "...",
  "message": "...",
  "instanceId": 3,
  "instanceName": "Radarr 4K",
  "arrType": "radarr",
  "occurredAt": "2026-10-20T16:00:00.000Z"
}
```

`instanceId|instanceName|arrType` are `null` when absent. Schema `NotificationWebhookPayload`
(`additionalProperties: false`) in `docs/api/v1/schemas/notifications.yaml`, referenced from a new
OpenAPI 3.1 top-level `webhooks: { notification: { post: ... } }` in `docs/api/v1/openapi.yaml`;
`scripts/bundle-api.ts` copies `webhooks` (with `convertRefs`). Regenerate
`packages/praxrr-app/src/lib/api/v1.d.ts` via `deno task generate:api-types`.

## Provider wire formats (slice B)

| Provider | Request                                                                                                                              | Config keys (secret*)                                                                                                           | Notes                                                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| webhook  | `POST url` exact JSON payload v1; HMAC headers when `secret` set; custom headers                                                     | `url`_, `secret`_, `headers`* (textarea, `Name: value` per line)                                                                | URL passes `assertSafeOutboundUrl`; https or http                                                                                                                                                |
| ntfy     | `POST {server}` JSON `{ topic, title, message, priority, tags }`                                                                     | `server_url` (default `https://ntfy.sh`), `topic` (required, `^[-_A-Za-z0-9]{1,64}$`), `access_token`_, `username`, `password`_ | Bearer token if set, else Basic if username+password; priority error 4, warning 3, else 3; tags error `rotating_light`, warning `warning`, success `white_check_mark`, info `information_source` |
| gotify   | `POST {server}/message` header `X-Gotify-Key`, JSON `{ title, message, priority }`                                                   | `server_url` (required), `app_token`*                                                                                           | priority error 8, warning 5, else 2                                                                                                                                                              |
| pushover | `POST https://api.pushover.net/1/messages.json` JSON `{ token, user, title, message, priority, device? }`                            | `app_token`_, `user_key`_, `device`                                                                                             | title ≤ 250, message ≤ 1024; priority error 1 else 0; keys `^[A-Za-z0-9]{30}$`                                                                                                                   |
| telegram | `POST https://api.telegram.org/bot{token}/sendMessage` JSON `{ chat_id, text, message_thread_id?, disable_notification? }`           | `bot_token`*, `chat_id`, `message_thread_id`, `silent` (checkbox)                                                               | plain text `title\n\nmessage`, ≤ 4096; token `^\d+:[A-Za-z0-9_-]{30,}$`; token is in URL → must be in `secretValues`                                                                             |
| slack    | `POST webhook_url` JSON `{ text }` with `*title*\nmessage`, `&<>` escaped                                                            | `webhook_url`*                                                                                                                  | Works for Slack-compatible (Mattermost) incoming webhooks                                                                                                                                        |
| apprise  | `POST {server}/notify/{config_key}` (stateful) or `POST {server}/notify` with `urls` (stateless); JSON `{ title, body, type, tag? }` | `server_url` (required), `config_key`, `urls`*, `tags`                                                                          | require exactly one of `config_key`/`urls`; type map info/success/warning/`failure`                                                                                                              |

## Slices

### A — core (server)

Files: `notifications/types.ts`, `notifications/content.ts` (new), `notifications/base/delivery.ts`
(new), `notifications/base/Notifier.ts`, `notifications/base/webhookClient.ts`, delete
`notifications/base/BaseHttpNotifier.ts`, `notifications/registry.ts` (new),
`notifications/NotificationManager.ts`, `notifications/builder.ts` (`.context()`, `.severity()`,
`occurredAt`), `notifications/notifiers/discord/{DiscordNotifier.ts,provider.ts}`,
`notifications/notifiers/index.ts`, `notifications/definitions/{test,upgrade,rename}.ts` (drop
`config` param), `rename/processor.ts` + `upgrades/processor.ts` (send via manager, drop the
Discord bypass), emitters pass context (`sync/drift/persist.ts`, `sync/syncHistory/record.ts`,
`sync/canary/notify.ts`, `jobs/handlers/configHealthSnapshot.ts`), `utils/http/{types.ts,client.ts}`
(`retryAfterMs`), `utils/arr/urlSafety.ts` (extract `assertSafeOutboundUrl(url, label)`;
`assertSafeArrUrl` delegates with label `Arr`), `db/queries/notificationHistory.ts`, migration +
registration + `schema.sql`. Tests: `tests/notifications/delivery.test.ts` (retry/transient/
Retry-After cap/masking), extend `tests/notifications/manager.test.ts` (attempts recorded, failure
recorded masked, upgrade/rename route through manager).

### B — providers + contract

Files: `shared/notifications/providers.ts` (new), `notifiers/{webhook,ntfy,gotify,pushover,telegram,slack,apprise}/{<Name>Notifier.ts,provider.ts}` (+ `webhook/payload.ts`, `webhook/signature.ts`),
`docs/api/v1/schemas/notifications.yaml`, `docs/api/v1/openapi.yaml`, `scripts/bundle-api.ts`,
regenerated `lib/api/v1.d.ts`. Tests: `tests/notifications/providers.test.ts` (each provider's
request URL/headers/body via stubbed `fetch`; validation rejects bad input; secretValues coverage)
and `tests/notifications/webhookContract.test.ts` (payload keys/types/enum match the OpenAPI schema
parsed from YAML; HMAC verifies).

### C — UI, routes, docs

Files: `routes/settings/notifications/components/NotificationServiceForm.svelte`,
`components/ProviderConfiguration.svelte` (new, renders descriptor fields), delete
`DiscordConfiguration.svelte`, `components/NotificationHistory.svelte` (Attempts column, Resend for
failed rows), `+page.svelte` (icons/names from descriptors), `+page.server.ts` (test via
`notificationManager.sendToService(..., { maxAttempts: 1, record: false })` returning the masked
error; new `resend` action), `new/+page.server.ts`, `edit/[id]/+page.server.ts` (registry
`parseProviderForm`/`toClientConfig`), `docs/site/src/content/docs/app/notifications.md`.

## Validation

```bash
deno task test notifications   # or: deno test -A packages/praxrr-app/src/tests/notifications
deno task check
deno task lint
deno task build
```

## NOT building

Email/SMTP, per-provider rate limits, delivery queue persistence across restarts, config encryption
(YAN-546), emitters for catalog-only `job.*`/`pcd.*` types (no code emits them today).
