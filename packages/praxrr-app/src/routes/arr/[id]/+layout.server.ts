import { error, type ServerLoad } from '@sveltejs/kit';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import type { ArrInstance } from '$db/queries/arrInstances.ts';

export const load: ServerLoad = ({ params }) => {
  const id = parseInt(params.id || '', 10);

  if (isNaN(id)) {
    error(404, `Invalid instance ID: ${params.id}`);
  }

  const instance = arrInstancesQueries.getById(id);

  if (!instance) {
    error(404, `Instance not found: ${id}`);
  }

  const typedInstance: ArrInstance = {
    ...instance,
    external_url: instance.external_url ?? null,
  };

  return {
    instance: typedInstance,
  };
};
