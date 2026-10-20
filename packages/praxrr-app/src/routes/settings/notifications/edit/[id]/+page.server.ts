import type { Actions, RequestEvent } from '@sveltejs/kit';
import { error, fail, redirect } from '@sveltejs/kit';
import { logger } from '$logger/logger.ts';
import { notificationServicesQueries } from '$db/queries/notificationServices.ts';
import { getAllNotificationTypeIds } from '$shared/notifications/types.ts';
import { parseProviderForm, toClientConfig } from '$notifications/registry.ts';

export const load = ({ params }: { params: { id: string } }) => {
  const { id } = params;

  if (!id) {
    throw error(400, 'Service ID is required');
  }

  const service = notificationServicesQueries.getById(id);

  if (!service) {
    throw error(404, 'Notification service not found');
  }

  // Secrets are stripped server-side; the form only learns which ones are set.
  const { config, secretsSet } = toClientConfig(service.service_type, JSON.parse(service.config));
  const enabledTypes = JSON.parse(service.enabled_types);

  return {
    service: {
      id: service.id,
      name: service.name,
      serviceType: service.service_type,
      enabled: service.enabled === 1,
      config,
      secretsSet,
      enabledTypes,
    },
  };
};

export const actions: Actions = {
  edit: async ({ request, params }: RequestEvent) => {
    const { id } = params;

    if (!id) {
      return fail(400, { error: 'Service ID is required' });
    }

    const service = notificationServicesQueries.getById(id);
    if (!service) {
      return fail(404, { error: 'Service not found' });
    }

    const formData = await request.formData();
    const name = formData.get('name') as string;

    if (!name) {
      return fail(400, { error: 'Service name is required' });
    }

    // Validate name uniqueness (excluding current service)
    const existingService = notificationServicesQueries.getAll().find((s) => s.name === name && s.id !== id);
    if (existingService) {
      return fail(400, { error: 'A service with this name already exists' });
    }

    // Service type cannot be changed; blank secret fields keep their stored values.
    const parsed = parseProviderForm(service.service_type, formData, JSON.parse(service.config));
    if (!parsed.ok) {
      return fail(400, { error: parsed.error });
    }
    const config = parsed.config;
    const enabledTypes = getAllNotificationTypeIds().filter((typeId) => formData.get(typeId) === 'on');

    // Update the service
    const success = notificationServicesQueries.update(id, {
      name,
      config,
      enabledTypes,
    });

    if (!success) {
      return fail(500, { error: 'Failed to update notification service' });
    }

    await logger.info('Notification service updated', {
      source: 'settings/notifications/edit',
      meta: { serviceId: id, serviceType: service.service_type, name },
    });

    throw redirect(303, '/settings/notifications');
  },
};
