import type { ServerLoad } from '@sveltejs/kit';

export const load: ServerLoad = ({ url }) => {
  const urlParam = url.searchParams.get('url') || '';
  const type = url.searchParams.get('type') || 'unknown';
  const name = url.searchParams.get('name') || '';
  const branch = url.searchParams.get('branch') || '';
  const syncStrategy = url.searchParams.get('sync_strategy') || '';
  const autoPull = url.searchParams.get('auto_pull') || '';
  const localOpsEnabled = url.searchParams.get('local_ops_enabled') || '';

  return {
    url: urlParam,
    type,
    formData: {
      name,
      branch,
      syncStrategy,
      autoPull,
      localOpsEnabled,
    },
  };
};
