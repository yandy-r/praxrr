/**
 * Pre-defined notifications
 * Import and call these instead of building notifications inline
 *
 * @example
 * import { notifications } from '$notifications/definitions/index.ts';
 *
 * // Via notification manager (normal flow)
 * await notifications.test(service).send();
 *
 * // Direct to notifier (bypass manager)
 * await notifier.notify(notifications.test(service).build());
 */

import { test } from './test.ts';
import { rename } from './rename.ts';
import { upgrade } from './upgrade.ts';

export const notifications = {
  test,
  rename,
  upgrade,
};
