/**
 * Client-safe notification provider descriptors.
 *
 * Drives the generic provider configuration form and server-side form parsing. Contains no
 * server imports so it can be bundled into the browser.
 */

export type NotificationProviderType =
  'discord' | 'webhook' | 'ntfy' | 'gotify' | 'pushover' | 'telegram' | 'slack' | 'apprise';

export interface ProviderField {
  key: string;
  label: string;
  kind: 'text' | 'url' | 'password' | 'textarea' | 'checkbox' | 'number';
  required?: boolean;
  /** Secret values are never sent to the browser; blank on edit keeps the stored value. */
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

export const notificationProviders: readonly ProviderDescriptor[] = [
  {
    type: 'discord',
    label: 'Discord',
    description: 'Rich embeds posted to a Discord channel through an incoming webhook.',
    fields: [
      {
        key: 'webhook_url',
        label: 'Webhook URL',
        kind: 'password',
        required: true,
        secret: true,
        placeholder: 'https://discord.com/api/webhooks/...',
        help: 'Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.',
      },
      {
        key: 'username',
        label: 'Username',
        kind: 'text',
        placeholder: 'Praxrr',
        help: 'Display name for the webhook messages. Defaults to "Praxrr".',
      },
      {
        key: 'avatar_url',
        label: 'Avatar URL',
        kind: 'url',
        placeholder: 'https://example.com/avatar.png',
        help: 'Optional image URL used as the webhook avatar.',
      },
      {
        key: 'enable_mentions',
        label: 'Mention @here',
        kind: 'checkbox',
        defaultValue: false,
        help: 'Prefix the first message with @here.',
      },
    ],
  },
  {
    type: 'webhook',
    label: 'Webhook',
    description: 'Versioned JSON payload POSTed to any HTTP endpoint, optionally HMAC-signed.',
    fields: [
      {
        key: 'url',
        label: 'URL',
        kind: 'password',
        required: true,
        secret: true,
        placeholder: 'https://example.com/hooks/praxrr',
        help: 'http(s) endpoint that receives the JSON payload. Treated as a secret because URLs often embed tokens.',
      },
      {
        key: 'secret',
        label: 'Signing secret',
        kind: 'password',
        secret: true,
        help: 'Optional. When set, requests carry X-Praxrr-Timestamp and X-Praxrr-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>.',
      },
      {
        key: 'headers',
        label: 'Custom headers',
        kind: 'textarea',
        secret: true,
        placeholder: 'Authorization: Bearer abc123',
        help: 'Optional. One "Name: value" per line (max 20). Content-Type, Content-Length, Host and X-Praxrr-* are reserved.',
      },
    ],
  },
  {
    type: 'ntfy',
    label: 'ntfy',
    description: 'Push notifications through ntfy.sh or a self-hosted ntfy server.',
    fields: [
      {
        key: 'server_url',
        label: 'Server URL',
        kind: 'url',
        placeholder: 'https://ntfy.sh',
        defaultValue: 'https://ntfy.sh',
        help: 'Base URL of the ntfy server. Defaults to https://ntfy.sh.',
      },
      {
        key: 'topic',
        label: 'Topic',
        kind: 'text',
        required: true,
        placeholder: 'praxrr-alerts',
        help: 'Topic to publish to: 1-64 letters, digits, "-" or "_". Subscribe to the same topic in the ntfy app.',
      },
      {
        key: 'access_token',
        label: 'Access token',
        kind: 'password',
        secret: true,
        help: 'Optional. Create one with "ntfy token add" or in the web app under Account → Access tokens. Takes precedence over username/password.',
      },
      {
        key: 'username',
        label: 'Username',
        kind: 'text',
        help: 'Optional. Used with the password for Basic auth on protected topics.',
      },
      {
        key: 'password',
        label: 'Password',
        kind: 'password',
        secret: true,
        help: 'Optional. Password for the username above.',
      },
    ],
  },
  {
    type: 'gotify',
    label: 'Gotify',
    description: 'Messages delivered to a self-hosted Gotify server.',
    fields: [
      {
        key: 'server_url',
        label: 'Server URL',
        kind: 'url',
        required: true,
        placeholder: 'https://gotify.example.com',
        help: 'Base URL of your Gotify server.',
      },
      {
        key: 'app_token',
        label: 'Application token',
        kind: 'password',
        required: true,
        secret: true,
        help: 'In Gotify, open Apps → Create Application and copy its token.',
      },
    ],
  },
  {
    type: 'pushover',
    label: 'Pushover',
    description: 'Push notifications to Pushover devices.',
    fields: [
      {
        key: 'app_token',
        label: 'API token',
        kind: 'password',
        required: true,
        secret: true,
        help: 'Register an application at https://pushover.net/apps/build and copy its 30-character API token.',
      },
      {
        key: 'user_key',
        label: 'User key',
        kind: 'password',
        required: true,
        secret: true,
        help: 'Your 30-character user (or group) key from the Pushover dashboard.',
      },
      {
        key: 'device',
        label: 'Device',
        kind: 'text',
        help: 'Optional. Device name(s) to target, comma-separated. Leave blank for all devices.',
      },
    ],
  },
  {
    type: 'telegram',
    label: 'Telegram',
    description: 'Messages sent by a Telegram bot to a chat, group, or channel.',
    fields: [
      {
        key: 'bot_token',
        label: 'Bot token',
        kind: 'password',
        required: true,
        secret: true,
        placeholder: '123456789:AA...',
        help: 'Create a bot with @BotFather (/newbot) and copy the token it returns.',
      },
      {
        key: 'chat_id',
        label: 'Chat ID',
        kind: 'text',
        required: true,
        placeholder: '-1001234567890 or @channelname',
        help: 'Numeric chat ID (groups and channels are negative) or @channelname for public channels. Add the bot to the chat first.',
      },
      {
        key: 'message_thread_id',
        label: 'Topic (thread) ID',
        kind: 'number',
        help: 'Optional. Forum topic ID to post into for groups with topics enabled.',
      },
      {
        key: 'silent',
        label: 'Send silently',
        kind: 'checkbox',
        defaultValue: false,
        help: 'Deliver without a notification sound.',
      },
    ],
  },
  {
    type: 'slack',
    label: 'Slack',
    description: 'Messages posted through a Slack (or Mattermost) incoming webhook.',
    fields: [
      {
        key: 'webhook_url',
        label: 'Webhook URL',
        kind: 'password',
        required: true,
        secret: true,
        placeholder: 'https://hooks.slack.com/services/...',
        help: 'Create a Slack app with Incoming Webhooks enabled and copy the webhook URL. Mattermost incoming webhooks also work.',
      },
    ],
  },
  {
    type: 'apprise',
    label: 'Apprise',
    description: 'Fan out to any service supported by an Apprise API server.',
    fields: [
      {
        key: 'server_url',
        label: 'Apprise API URL',
        kind: 'url',
        required: true,
        placeholder: 'http://apprise:8000',
        help: 'Base URL of your Apprise API server.',
      },
      {
        key: 'config_key',
        label: 'Configuration key',
        kind: 'text',
        help: 'Key of a configuration stored on the Apprise server (stateful). Set either this or URLs, not both.',
      },
      {
        key: 'urls',
        label: 'Apprise URLs',
        kind: 'textarea',
        secret: true,
        placeholder: 'tgram://bottoken/ChatID',
        help: 'Apprise notification URLs (stateless), one per line or comma-separated. Set either this or a configuration key.',
      },
      {
        key: 'tags',
        label: 'Tags',
        kind: 'text',
        help: 'Optional. Only notify stored URLs carrying these tags (stateful mode).',
      },
    ],
  },
];

export function getProviderDescriptor(type: string): ProviderDescriptor | undefined {
  return notificationProviders.find((provider) => provider.type === type);
}

export function isNotificationProviderType(type: string): type is NotificationProviderType {
  return notificationProviders.some((provider) => provider.type === type);
}
