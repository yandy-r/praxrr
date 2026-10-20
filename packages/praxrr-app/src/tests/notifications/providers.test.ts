import { assert, assertEquals, assertMatch, assertRejects, assertStringIncludes } from '@std/assert';
import { deliveryTiming, NotificationDeliveryError } from '$notifications/base/delivery.ts';
import type { ProviderDefinition, ProviderFormInput } from '$notifications/registry.ts';
import type { Notification } from '$notifications/types.ts';
import { appriseProvider } from '$notifications/notifiers/apprise/provider.ts';
import { gotifyProvider } from '$notifications/notifiers/gotify/provider.ts';
import { ntfyProvider } from '$notifications/notifiers/ntfy/provider.ts';
import { pushoverProvider } from '$notifications/notifiers/pushover/provider.ts';
import { slackProvider } from '$notifications/notifiers/slack/provider.ts';
import { telegramProvider } from '$notifications/notifiers/telegram/provider.ts';
import { webhookProvider } from '$notifications/notifiers/webhook/provider.ts';
import { notificationProviders } from '$shared/notifications/providers.ts';

interface CapturedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

const SAMPLE: Notification = {
  type: 'sync.failed',
  generic: { title: 'Sync failed', message: 'Radarr 4K: 2 sections failed' },
  context: { instanceId: 3, instanceName: 'Radarr 4K', arrType: 'radarr' },
  occurredAt: '2026-10-20T16:00:00.000Z',
};

const PUSHOVER_TOKEN = 'azGDORePK8gMaC0QOYAMyEEuzJnyUi';
const PUSHOVER_USER = 'uQiRzpo4DXghDmr9QzzfQu27cmVRsG';
const TELEGRAM_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

/**
 * Replace fetch with a recorder answering `responses` in order (last one repeats), run `fn`,
 * then restore fetch and the retry sleep.
 */
async function withFetch(
  fn: (requests: CapturedRequest[]) => Promise<void>,
  responses: Array<() => Response> = [() => new Response('{}', { status: 200 })]
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalSleep = deliveryTiming.sleep;
  const requests: CapturedRequest[] = [];
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : '',
    });
    const respond = responses[Math.min(requests.length - 1, responses.length - 1)];
    return Promise.resolve(respond());
  };
  deliveryTiming.sleep = () => Promise.resolve();
  try {
    await fn(requests);
  } finally {
    globalThis.fetch = originalFetch;
    deliveryTiming.sleep = originalSleep;
  }
}

function validConfig<C>(provider: ProviderDefinition<C>, input: ProviderFormInput): C {
  const result = provider.validate(input);
  if (!result.ok) throw new Error(`expected valid ${provider.type} config, got: ${result.error}`);
  return result.config;
}

function assertInvalid<C>(provider: ProviderDefinition<C>, input: ProviderFormInput, expected: string): string {
  const result = provider.validate(input);
  assert(!result.ok, `expected ${provider.type} validation to fail for ${expected}`);
  assertStringIncludes(result.error, expected);
  return result.error;
}

// ── Descriptors ──

Deno.test('descriptors: every provider is described in display order and secrets are masked inputs', () => {
  assertEquals(
    notificationProviders.map((provider) => provider.type),
    ['discord', 'webhook', 'ntfy', 'gotify', 'pushover', 'telegram', 'slack', 'apprise']
  );
  for (const provider of notificationProviders) {
    for (const field of provider.fields) {
      if (field.secret) {
        assert(
          field.kind === 'password' || field.kind === 'textarea',
          `${provider.type}.${field.key} is secret but rendered as ${field.kind}`
        );
      }
    }
  }
});

Deno.test('descriptors: field keys match the keys each provider validates', () => {
  const discord = notificationProviders.find((provider) => provider.type === 'discord');
  assertEquals(
    discord?.fields.map((field) => field.key),
    ['webhook_url', 'username', 'avatar_url', 'enable_mentions']
  );
  const telegram = notificationProviders.find((provider) => provider.type === 'telegram');
  assertEquals(
    telegram?.fields.map((field) => field.key),
    ['bot_token', 'chat_id', 'message_thread_id', 'silent']
  );
});

// ── Webhook ──

Deno.test('webhook: posts the v1 payload with event header, custom headers and HMAC signature', async () => {
  const config = validConfig(webhookProvider, {
    url: 'https://hooks.example.com/praxrr?token=abc',
    secret: 'whsec_test',
    headers: 'Authorization: Bearer header-secret\n\nX-Team: ops',
  });
  await withFetch(async (requests) => {
    const result = await webhookProvider.create(config).notify(SAMPLE);
    assertEquals(result.attempts, 1);
    assertEquals(requests.length, 1);
    const [request] = requests;
    assertEquals(request.url, 'https://hooks.example.com/praxrr?token=abc');
    assertEquals(request.method, 'POST');
    assertEquals(request.headers.get('content-type'), 'application/json');
    assertEquals(request.headers.get('x-praxrr-event'), 'sync.failed');
    assertEquals(request.headers.get('authorization'), 'Bearer header-secret');
    assertEquals(request.headers.get('x-team'), 'ops');
    assertMatch(request.headers.get('x-praxrr-timestamp') ?? '', /^\d+$/);
    assertMatch(request.headers.get('x-praxrr-signature') ?? '', /^sha256=[0-9a-f]{64}$/);

    const body = JSON.parse(request.body);
    assertEquals(
      { ...body, id: undefined },
      {
        version: 1,
        id: undefined,
        type: 'sync.failed',
        severity: 'error',
        title: 'Sync failed',
        message: 'Radarr 4K: 2 sections failed',
        instanceId: 3,
        instanceName: 'Radarr 4K',
        arrType: 'radarr',
        occurredAt: '2026-10-20T16:00:00.000Z',
      }
    );
  });
});

Deno.test('webhook: omits signature headers when no secret is configured', async () => {
  const config = validConfig(webhookProvider, { url: 'http://192.168.1.10:8080/hook' });
  await withFetch(async (requests) => {
    await webhookProvider.create(config).notify(SAMPLE);
    assertEquals(requests[0].headers.get('x-praxrr-signature'), null);
    assertEquals(requests[0].headers.get('x-praxrr-timestamp'), null);
  });
});

Deno.test('webhook: validation rejects bad URLs and unsafe headers without echoing values', () => {
  assertInvalid(webhookProvider, { url: '' }, 'Webhook URL is required');
  assertInvalid(webhookProvider, { url: 'ftp://example.com/hook' }, 'scheme');
  assertInvalid(webhookProvider, { url: 'http://169.254.169.254/latest/meta-data' }, 'metadata');
  assertInvalid(webhookProvider, { url: 'https://x.test', headers: 'Content-Type: text/plain' }, 'reserved');
  assertInvalid(webhookProvider, { url: 'https://x.test', headers: 'x-praxrr-signature: forged' }, 'reserved');
  assertInvalid(webhookProvider, { url: 'https://x.test', headers: 'HOST: evil' }, 'reserved');
  assertInvalid(webhookProvider, { url: 'https://x.test', headers: 'Bad Name: v' }, 'invalid header name');
  assertInvalid(webhookProvider, { url: 'https://x.test', headers: 'no-separator' }, 'Name: value');
  const tooMany = Array.from({ length: 21 }, (_, index) => `X-H${index}: v`).join('\n');
  assertInvalid(webhookProvider, { url: 'https://x.test', headers: tooMany }, 'At most 20');

  const error = assertInvalid(
    webhookProvider,
    { url: 'https://x.test', headers: 'Authorization: Bearer leaked-value\nContent-Length: 5' },
    'reserved'
  );
  assert(!error.includes('leaked-value'));
});

Deno.test('webhook: secretValues covers URL, signing secret and every custom header value', () => {
  const config = validConfig(webhookProvider, {
    url: 'https://hooks.example.com/t0ken',
    secret: 'sign-me',
    headers: 'Authorization: Bearer a\nX-Api-Key: b',
  });
  assertEquals(webhookProvider.secretValues(config).sort(), [
    'Bearer a',
    'b',
    'https://hooks.example.com/t0ken',
    'sign-me',
  ]);
});

// ── ntfy ──

Deno.test('ntfy: posts JSON publish body to the server root with bearer token', async () => {
  const config = validConfig(ntfyProvider, {
    server_url: 'https://ntfy.example.com/',
    topic: 'praxrr_alerts',
    access_token: 'tk_secret',
    username: '',
    password: '',
  });
  await withFetch(async (requests) => {
    await ntfyProvider.create(config).notify(SAMPLE);
    const [request] = requests;
    assertEquals(request.url, 'https://ntfy.example.com');
    assertEquals(request.method, 'POST');
    assertEquals(request.headers.get('authorization'), 'Bearer tk_secret');
    assertEquals(JSON.parse(request.body), {
      topic: 'praxrr_alerts',
      title: 'Sync failed',
      message: 'Radarr 4K: 2 sections failed',
      priority: 4,
      tags: ['rotating_light'],
    });
  });
});

Deno.test('ntfy: defaults to ntfy.sh, uses Basic auth from username/password, maps success tags', async () => {
  const config = validConfig(ntfyProvider, { server_url: '', topic: 'alerts', username: 'bob', password: 'pa:ss' });
  assertEquals(config.server_url, 'https://ntfy.sh');
  await withFetch(async (requests) => {
    await ntfyProvider.create(config).notify({ type: 'upgrade.success', generic: { title: 'Done', message: '' } });
    assertEquals(requests[0].headers.get('authorization'), `Basic ${btoa('bob:pa:ss')}`);
    const body = JSON.parse(requests[0].body);
    assertEquals(body.priority, 3);
    assertEquals(body.tags, ['white_check_mark']);
  });
  assert(ntfyProvider.secretValues(config).includes(btoa('bob:pa:ss')));
  assert(ntfyProvider.secretValues(config).includes('pa:ss'));
});

Deno.test('ntfy: validation rejects missing/bad topic, half credentials and metadata URL', () => {
  assertInvalid(ntfyProvider, { topic: '' }, 'topic is required');
  assertInvalid(ntfyProvider, { topic: 'bad topic!' }, 'topic must be');
  assertInvalid(ntfyProvider, { topic: 'a'.repeat(65) }, 'topic must be');
  assertInvalid(ntfyProvider, { topic: 'ok', username: 'bob' }, 'together');
  assertInvalid(ntfyProvider, { topic: 'ok', server_url: 'http://169.254.169.254' }, 'metadata');
});

// ── Gotify ──

Deno.test('gotify: posts to /message with X-Gotify-Key and severity priority', async () => {
  const config = validConfig(gotifyProvider, { server_url: 'http://gotify.lan:8080/', app_token: 'AbCdEf.123' });
  assertEquals(config.server_url, 'http://gotify.lan:8080');
  await withFetch(async (requests) => {
    await gotifyProvider.create(config).notify(SAMPLE);
    const [request] = requests;
    assertEquals(request.url, 'http://gotify.lan:8080/message');
    assertEquals(request.method, 'POST');
    assertEquals(request.headers.get('x-gotify-key'), 'AbCdEf.123');
    assertEquals(JSON.parse(request.body), {
      title: 'Sync failed',
      message: 'Radarr 4K: 2 sections failed',
      priority: 8,
    });
    await gotifyProvider.create(config).notify({ type: 'drift.detected', generic: { title: 't', message: 'm' } });
    assertEquals(JSON.parse(requests[1].body).priority, 5);
  });
  assertEquals(gotifyProvider.secretValues(config), ['AbCdEf.123']);
});

Deno.test('gotify: validation requires server URL and token, rejects metadata URL', () => {
  assertInvalid(gotifyProvider, { server_url: '', app_token: 't' }, 'Gotify server URL is required');
  assertInvalid(gotifyProvider, { server_url: 'https://g.test', app_token: '' }, 'token is required');
  assertInvalid(gotifyProvider, { server_url: 'http://169.254.169.254', app_token: 't' }, 'metadata');
});

// ── Pushover ──

Deno.test('pushover: posts token/user/title/message/priority/device to the messages API', async () => {
  const config = validConfig(pushoverProvider, {
    app_token: PUSHOVER_TOKEN,
    user_key: PUSHOVER_USER,
    device: 'phone, tablet',
  });
  await withFetch(async (requests) => {
    await pushoverProvider.create(config).notify(SAMPLE);
    const [request] = requests;
    assertEquals(request.url, 'https://api.pushover.net/1/messages.json');
    assertEquals(request.method, 'POST');
    assertEquals(JSON.parse(request.body), {
      token: PUSHOVER_TOKEN,
      user: PUSHOVER_USER,
      title: 'Sync failed',
      message: 'Radarr 4K: 2 sections failed',
      priority: 1,
      device: 'phone,tablet',
    });
  });
  assertEquals(pushoverProvider.secretValues(config), [PUSHOVER_TOKEN, PUSHOVER_USER]);
});

Deno.test('pushover: truncates title to 250 and message to 1024 characters', async () => {
  const config = validConfig(pushoverProvider, { app_token: PUSHOVER_TOKEN, user_key: PUSHOVER_USER });
  await withFetch(async (requests) => {
    await pushoverProvider
      .create(config)
      .notify({ type: 'rename.success', generic: { title: 't'.repeat(300), message: 'm'.repeat(2000) } });
    const body = JSON.parse(requests[0].body);
    assertEquals(body.title.length, 250);
    assertEquals(body.message.length, 1024);
    assertEquals(body.priority, 0);
    assertEquals('device' in body, false);
  });
});

Deno.test('pushover: validation rejects missing and malformed keys', () => {
  assertInvalid(pushoverProvider, { app_token: '', user_key: PUSHOVER_USER }, 'API token is required');
  assertInvalid(pushoverProvider, { app_token: 'short', user_key: PUSHOVER_USER }, '30 letters');
  assertInvalid(pushoverProvider, { app_token: PUSHOVER_TOKEN, user_key: '' }, 'user key is required');
  assertInvalid(pushoverProvider, { app_token: PUSHOVER_TOKEN, user_key: `${PUSHOVER_USER}!` }, '30 letters');
  assertInvalid(pushoverProvider, { app_token: PUSHOVER_TOKEN, user_key: PUSHOVER_USER, device: 'a/b' }, 'device');
});

// ── Telegram ──

Deno.test('telegram: posts plain text to sendMessage with numeric chat/thread ids and silent flag', async () => {
  const config = validConfig(telegramProvider, {
    bot_token: TELEGRAM_TOKEN,
    chat_id: '-1001234567890',
    message_thread_id: '42',
    silent: true,
  });
  await withFetch(
    async (requests) => {
      await telegramProvider.create(config).notify(SAMPLE);
      const [request] = requests;
      assertEquals(request.url, `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`);
      assertEquals(request.method, 'POST');
      assertEquals(JSON.parse(request.body), {
        chat_id: -1001234567890,
        text: 'Sync failed\n\nRadarr 4K: 2 sections failed',
        message_thread_id: 42,
        disable_notification: true,
      });
    },
    [() => new Response('{"ok":true,"result":{}}', { status: 200 })]
  );
});

Deno.test('telegram: @channelname chat ids stay strings and text is capped at 4096', async () => {
  const config = validConfig(telegramProvider, { bot_token: TELEGRAM_TOKEN, chat_id: '@praxrr_alerts', silent: false });
  await withFetch(async (requests) => {
    await telegramProvider.create(config).notify({ type: 'x', generic: { title: 'T', message: 'm'.repeat(5000) } });
    const body = JSON.parse(requests[0].body);
    assertEquals(body.chat_id, '@praxrr_alerts');
    assertEquals(body.text.length, 4096);
    assertEquals('message_thread_id' in body, false);
    assertEquals('disable_notification' in body, false);
  });
});

Deno.test('telegram: validation rejects malformed token, chat id and thread id', () => {
  assertInvalid(telegramProvider, { bot_token: '', chat_id: '1' }, 'bot token is required');
  const error = assertInvalid(telegramProvider, { bot_token: 'not-a-token', chat_id: '1' }, 'bot token must');
  assert(!error.includes('not-a-token'));
  assertInvalid(telegramProvider, { bot_token: TELEGRAM_TOKEN, chat_id: '' }, 'chat ID is required');
  assertInvalid(telegramProvider, { bot_token: TELEGRAM_TOKEN, chat_id: '12ab' }, 'chat ID must');
  assertInvalid(telegramProvider, { bot_token: TELEGRAM_TOKEN, chat_id: '1', message_thread_id: '-5' }, 'thread');
});

Deno.test('telegram: token embedded in the URL is a secret and masked from delivery errors', async () => {
  const config = validConfig(telegramProvider, { bot_token: TELEGRAM_TOKEN, chat_id: '1' });
  assertEquals(telegramProvider.secretValues(config), [TELEGRAM_TOKEN]);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request) =>
    Promise.reject(new TypeError(`error sending request for url (${String(input)})`));
  try {
    const error = await assertRejects(
      () => telegramProvider.create(config).notify(SAMPLE, { maxAttempts: 1 }),
      NotificationDeliveryError
    );
    assert(!error.message.includes(TELEGRAM_TOKEN), 'bot token leaked into delivery error');
    assertStringIncludes(error.message, '***');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Slack ──

Deno.test('slack: posts escaped mrkdwn text to the incoming webhook', async () => {
  const config = validConfig(slackProvider, { webhook_url: 'https://hooks.slack.com/services/T/B/XYZ' });
  await withFetch(async (requests) => {
    await slackProvider
      .create(config)
      .notify({ type: 'sync.failed', generic: { title: 'A & B', message: '<script> > done' } });
    const [request] = requests;
    assertEquals(request.url, 'https://hooks.slack.com/services/T/B/XYZ');
    assertEquals(request.method, 'POST');
    assertEquals(JSON.parse(request.body), { text: '*A &amp; B*\n&lt;script&gt; &gt; done' });
  });
  assertEquals(slackProvider.secretValues(config), ['https://hooks.slack.com/services/T/B/XYZ']);
});

Deno.test('slack: validation requires a safe http(s) webhook URL', () => {
  assertInvalid(slackProvider, { webhook_url: '' }, 'Slack webhook URL is required');
  assertInvalid(slackProvider, { webhook_url: 'not a url' }, 'Invalid');
  assertInvalid(slackProvider, { webhook_url: 'http://169.254.169.254/' }, 'metadata');
});

// ── Apprise ──

Deno.test('apprise: stateful mode posts to /notify/{key} with tag and failure type', async () => {
  const config = validConfig(appriseProvider, {
    server_url: 'http://apprise:8000/',
    config_key: 'praxrr',
    urls: '',
    tags: 'ops',
  });
  await withFetch(async (requests) => {
    await appriseProvider.create(config).notify(SAMPLE);
    const [request] = requests;
    assertEquals(request.url, 'http://apprise:8000/notify/praxrr');
    assertEquals(request.method, 'POST');
    assertEquals(JSON.parse(request.body), {
      title: 'Sync failed',
      body: 'Radarr 4K: 2 sections failed',
      type: 'failure',
      tag: 'ops',
    });
  });
});

Deno.test('apprise: stateless mode posts urls to /notify and treats them as secrets', async () => {
  const urls = 'tgram://bottoken/ChatID, pover://user@token';
  const config = validConfig(appriseProvider, { server_url: 'http://apprise:8000', config_key: '', urls });
  await withFetch(async (requests) => {
    await appriseProvider.create(config).notify({ type: 'drift.detected', generic: { title: 'Drift', message: 'x' } });
    assertEquals(requests[0].url, 'http://apprise:8000/notify');
    assertEquals(JSON.parse(requests[0].body), { title: 'Drift', body: 'x', type: 'warning', urls });
  });
  const secrets = appriseProvider.secretValues(config);
  assert(secrets.includes(urls));
  assert(secrets.includes('tgram://bottoken/ChatID'));
  assert(secrets.includes('pover://user@token'));
});

Deno.test('apprise: validation requires exactly one of config_key or urls', () => {
  assertInvalid(appriseProvider, { server_url: '', config_key: 'k' }, 'Apprise API URL is required');
  assertInvalid(appriseProvider, { server_url: 'http://a:8000' }, 'exactly one');
  assertInvalid(appriseProvider, { server_url: 'http://a:8000', config_key: 'k', urls: 'json://x' }, 'exactly one');
  assertInvalid(appriseProvider, { server_url: 'http://a:8000', config_key: '../etc' }, 'configuration key must');
  assertInvalid(appriseProvider, { server_url: 'http://169.254.169.254', config_key: 'k' }, 'metadata');
});

// ── Retry through providers ──

Deno.test('providers retry transient failures and report the attempt count', async () => {
  const config = validConfig(slackProvider, { webhook_url: 'https://hooks.slack.com/services/T/B/XYZ' });
  await withFetch(
    async (requests) => {
      const result = await slackProvider.create(config).notify(SAMPLE);
      assertEquals(result.attempts, 2);
      assertEquals(requests.length, 2);
    },
    [() => new Response('busy', { status: 503 }), () => new Response('ok', { status: 200 })]
  );
});
