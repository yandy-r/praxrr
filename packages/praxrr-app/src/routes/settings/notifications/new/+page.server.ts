import type { Actions, RequestEvent } from '@sveltejs/kit';
import { fail, redirect } from '@sveltejs/kit';
import { logger } from '$logger/logger.ts';
import { notificationServicesQueries } from '$db/queries/notificationServices.ts';
import { getAllNotificationTypeIds } from '$shared/notifications/types.ts';
import { isNotificationProviderType } from '$shared/notifications/providers.ts';
import { parseProviderForm } from '$notifications/registry.ts';

export const actions: Actions = {
  create: async ({ request }: RequestEvent) => {
    const formData = await request.formData();
    const serviceType = formData.get('type') as string;
    const name = formData.get('name') as string;

    if (!serviceType || !name) {
      return fail(400, { error: 'Service type and name are required' });
    }

    // Validate name uniqueness
    if (notificationServicesQueries.existsByName(name)) {
      return fail(400, { error: 'A service with this name already exists' });
    }

    if (!isNotificationProviderType(serviceType)) {
      return fail(400, { error: `Unknown service type: ${serviceType}` });
    }

    const parsed = parseProviderForm(serviceType, formData);
    if (!parsed.ok) {
      return fail(400, { error: parsed.error });
    }
    const config = parsed.config;
    const enabledTypes = getAllNotificationTypeIds().filter((typeId) => formData.get(typeId) === 'on');

    // Generate UUID for the service
    const id = crypto.randomUUID();

    // Create the service
    const success = notificationServicesQueries.create({
      id,
      name,
      serviceType,
      enabled: true,
      config,
      enabledTypes,
    });

    if (!success) {
      return fail(500, { error: 'Failed to create notification service' });
    }

    await logger.info('Notification service created', {
      source: 'settings/notifications/new',
      meta: { serviceId: id, serviceType, name },
    });

    throw redirect(303, '/settings/notifications');
  },
};
