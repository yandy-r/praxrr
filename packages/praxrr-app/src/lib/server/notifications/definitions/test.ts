/**
 * Test notification definition
 */

import { notify, createEmbed, Colors } from '../builder.ts';

/**
 * Test notification for verifying service configuration.
 * The Discord embed author is filled from the service config by DiscordNotifier.
 */
export const test = () =>
  notify('test')
    .generic('Test Notification', 'This is a test notification from Praxrr.')
    .discord((d) =>
      d.embed(
        createEmbed()
          .description(
            'This is a test notification from Praxrr. If you received this, your notification service is working correctly!'
          )
          .color(Colors.INFO)
          .timestamp()
          .footer('Type: notifier.test')
      )
    );
