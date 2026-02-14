import type { Actions, RequestEvent } from '@sveltejs/kit';
import { error, fail, redirect } from '@sveltejs/kit';
import { logger } from '$logger/logger.ts';
import { notificationServicesQueries } from '$db/queries/notificationServices.ts';
import { getAllNotificationTypeIds } from '$shared/notifications/types.ts';

export const load = ({ params }: { params: { id: string } }) => {
  const { id } = params;

  if (!id) {
    throw error(400, 'Service ID is required');
  }

  const service = notificationServicesQueries.getById(id);

  if (!service) {
    throw error(404, 'Notification service not found');
  }

  // Parse JSON fields for the component
  const config = JSON.parse(service.config);
  const enabledTypes = JSON.parse(service.enabled_types);

  // Remove webhook_url from config (security - don't expose secrets)
  const { webhook_url: _webhook_url, ...configWithoutWebhook } = config;

  return {
    service: {
      id: service.id,
      name: service.name,
      serviceType: service.service_type,
      enabled: service.enabled === 1,
      config: configWithoutWebhook,
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

    // Build config based on service type (service type cannot be changed)
    let config: Record<string, unknown> = {};
    let enabledTypes: string[] = [];

    if (service.service_type === 'discord') {
      const webhookUrl = formData.get('webhook_url') as string;
      const username = formData.get('username') as string;
      const avatarUrl = formData.get('avatar_url') as string;
      const enableMentions = formData.get('enable_mentions') === 'on';

      // Parse existing config to preserve webhook if not provided
      const existingConfig = JSON.parse(service.config);

      config = {
        // Keep existing webhook_url if new one not provided
        webhook_url: webhookUrl || existingConfig.webhook_url,
        ...(username && { username }),
        ...(avatarUrl && { avatar_url: avatarUrl }),
        enable_mentions: enableMentions,
      };

      // Get enabled notification types dynamically from all available types
      const allTypeIds = getAllNotificationTypeIds();
      enabledTypes = allTypeIds.filter((typeId) => formData.get(typeId) === 'on');
    }

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
