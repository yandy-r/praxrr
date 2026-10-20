/**
 * Pre-defined notifications
 * Import and call these instead of building notifications inline
 *
 * @example
 * import { notifications } from '$notifications/definitions/index.ts';
 *
 * // Via notification manager (normal flow: enabled + subscribed services, history recorded)
 * await notifications.rename({ log }).send();
 *
 * // To one specific service (e.g. the settings "Test" action)
 * await notificationManager.sendToService(service, notifications.test().build(), { maxAttempts: 1, record: false });
 */

import { test } from './test.ts';
import { rename } from './rename.ts';
import { upgrade } from './upgrade.ts';

export const notifications = {
  test,
  rename,
  upgrade,
};
