import { assert, assertEquals } from '@std/assert';
import { parseProviderForm, type ParseResult, toClientConfig } from '$notifications/registry.ts';

function formOf(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) form.set(key, value);
  return form;
}

function expectConfig(result: ParseResult<Record<string, unknown>>): Record<string, unknown> {
  if (!result.ok) throw new Error(`expected valid config, got: ${result.error}`);
  return result.config;
}

const WEBHOOK_STORED = {
  url: 'https://hooks.example.test/in/stored-token',
  secret: 'stored-signing-secret',
  headers: 'Authorization: Bearer stored-header',
};

Deno.test('toClientConfig strips secret fields and lists the ones that hold a value', () => {
  const ntfy = toClientConfig('ntfy', {
    server_url: 'https://ntfy.sh',
    topic: 'praxrr',
    username: 'alice',
    password: 'hunter2',
    access_token: '',
  });
  assertEquals(ntfy.config, { server_url: 'https://ntfy.sh', topic: 'praxrr', username: 'alice' });
  assertEquals(ntfy.secretsSet, ['password']);

  const webhook = toClientConfig('webhook', WEBHOOK_STORED);
  assertEquals(webhook.config, {});
  assertEquals(webhook.secretsSet, ['url', 'secret', 'headers']);
});

Deno.test('parseProviderForm: blank secret keeps the stored value', () => {
  const config = expectConfig(
    parseProviderForm('webhook', formOf({ url: '', secret: '', headers: '' }), WEBHOOK_STORED)
  );
  assertEquals(config.url, WEBHOOK_STORED.url);
  assertEquals(config.secret, WEBHOOK_STORED.secret);
  assertEquals(config.headers, WEBHOOK_STORED.headers);
});

Deno.test('parseProviderForm: a typed secret replaces the stored value', () => {
  const config = expectConfig(
    parseProviderForm('webhook', formOf({ url: '', secret: 'new-signing-secret', headers: '' }), WEBHOOK_STORED)
  );
  assertEquals(config.secret, 'new-signing-secret');
  assertEquals(config.url, WEBHOOK_STORED.url);
});

Deno.test('parseProviderForm: __clear empties an optional secret', () => {
  const config = expectConfig(
    parseProviderForm(
      'webhook',
      formOf({ url: '', secret: '', secret__clear: 'on', headers: '', headers__clear: '' }),
      WEBHOOK_STORED
    )
  );
  assertEquals(config.secret, undefined);
  assertEquals(config.headers, WEBHOOK_STORED.headers);
  assertEquals(config.url, WEBHOOK_STORED.url);
});

Deno.test('parseProviderForm: __clear with a typed value keeps the typed value', () => {
  const config = expectConfig(
    parseProviderForm('webhook', formOf({ url: '', secret: 'typed', secret__clear: 'on' }), WEBHOOK_STORED)
  );
  assertEquals(config.secret, 'typed');
});

Deno.test('parseProviderForm: a required secret cannot be cleared (blank keeps it)', () => {
  const config = expectConfig(
    parseProviderForm('webhook', formOf({ url: '', url__clear: 'on', secret: '' }), WEBHOOK_STORED)
  );
  assertEquals(config.url, WEBHOOK_STORED.url);
});

Deno.test('parseProviderForm: checkbox fields parse "on" as true and "" as false', () => {
  const stored = { webhook_url: 'https://discord.com/api/webhooks/1/stored' };
  const on = expectConfig(parseProviderForm('discord', formOf({ webhook_url: '', enable_mentions: 'on' }), stored));
  assertEquals(on.enable_mentions, true);
  const off = expectConfig(parseProviderForm('discord', formOf({ webhook_url: '', enable_mentions: '' }), stored));
  assertEquals(off.enable_mentions, false);
});

Deno.test('parseProviderForm: ntfy basic auth is removed by clearing the password and blanking the username', () => {
  const stored = { server_url: 'https://ntfy.sh', topic: 'praxrr', username: 'alice', password: 'hunter2' };
  const kept = parseProviderForm(
    'ntfy',
    formOf({ server_url: 'https://ntfy.sh', topic: 'praxrr', username: '' }),
    stored
  );
  assert(!kept.ok, 'blank username with a kept password must fail the pair check');

  const config = expectConfig(
    parseProviderForm(
      'ntfy',
      formOf({ server_url: 'https://ntfy.sh', topic: 'praxrr', username: '', password: '', password__clear: 'on' }),
      stored
    )
  );
  assertEquals(config, { server_url: 'https://ntfy.sh', topic: 'praxrr' });
});

Deno.test('parseProviderForm: Apprise switches from stateless to stateful by clearing urls', () => {
  const stored = { server_url: 'http://apprise.example.test:8000', urls: 'tgram://bot-token/chat' };

  const withoutClear = parseProviderForm(
    'apprise',
    formOf({ server_url: 'http://apprise.example.test:8000', config_key: 'praxrr', urls: '' }),
    stored
  );
  assert(!withoutClear.ok, 'kept urls plus a config key must fail the exactly-one check');

  const config = expectConfig(
    parseProviderForm(
      'apprise',
      formOf({ server_url: 'http://apprise.example.test:8000', config_key: 'praxrr', urls: '', urls__clear: 'on' }),
      stored
    )
  );
  assertEquals(config, { server_url: 'http://apprise.example.test:8000', config_key: 'praxrr' });
});
