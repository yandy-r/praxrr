import { error, type ServerLoad } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';
import { resolveInstanceCompatibility } from '$arr/instanceCompatibility.ts';

export const load: ServerLoad = ({ params }) => {
  const id = parseInt(params.id || '', 10);

  if (isNaN(id)) {
    error(404, `Invalid instance ID: ${params.id}`);
  }

  const instance = arrInstancesQueries.getById(id);

  if (!instance) {
    error(404, `Instance not found: ${id}`);
  }

  const { api_key: _api_key, ...instanceWithoutSecret } = instance;
  const typedInstance: Omit<ArrInstance, 'api_key'> = {
    ...instanceWithoutSecret,
    external_url: instance.external_url ?? null,
  };

  return {
    instance: typedInstance,
    versionCompatibility: resolveInstanceCompatibility(instance),
  };
};
