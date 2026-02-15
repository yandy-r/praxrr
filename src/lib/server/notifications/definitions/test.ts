/**
 * Test notification definition
 */

import { notify, createEmbed, Colors } from '../builder.ts';

interface TestNotificationParams {
  config: { username?: string; avatar_url?: string };
}

/**
 * Test notification for verifying service configuration
 */
export const test = ({ config }: TestNotificationParams) =>
  notify('test')
    .generic('Test Notification', 'This is a test notification from Profilarr.')
    .discord((d) =>
      d.embed(
        createEmbed()
          .author(config.username || 'Profilarr', config.avatar_url)
          .description(
            'This is a test notification from Profilarr. If you received this, your notification service is working correctly!'
          )
          .color(Colors.INFO)
          .timestamp()
          .footer('Type: notifier.test')
      )
    );
