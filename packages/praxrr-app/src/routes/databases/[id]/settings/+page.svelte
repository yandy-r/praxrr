<script lang="ts">
  import { applyAction, enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { AlertTriangle, Power } from 'lucide-svelte';
  import { alertStore } from '$alerts/store';
  import Button from '$ui/button/Button.svelte';
  import InstanceForm from '../../components/InstanceForm.svelte';
  import type { ActionData, PageData } from './$types';

  export let form: ActionData;
  export let data: PageData;

  let enabling = false;

  // `enabled` is stored as 0/1 but tolerate booleans too
  $: isDisabled = !data.database.enabled;
</script>

<svelte:head>
  <title>Settings - {data.database.name} - Praxrr</title>
</svelte:head>

{#if isDisabled}
  <div
    role="alert"
    class="mt-6 flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200"
  >
    <div class="flex items-start gap-3">
      <AlertTriangle size={18} class="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <div class="space-y-1">
        <p class="font-semibold">This database is disabled</p>
        <p class="text-amber-800 dark:text-amber-300">
          It was disabled automatically, usually after a failed cache build or a rolled-back import. While disabled, it
          isn't being served and its configuration isn't synced to your Arr instances. Re-enable it to rebuild the cache
          and resume normal operation.
        </p>
      </div>
    </div>
    <form
      method="POST"
      action="?/enable"
      class="shrink-0"
      use:enhance={() => {
        enabling = true;
        return async ({ result }) => {
          enabling = false;
          if (result.type === 'success') {
            const status = (result.data as { enableStatus?: string } | undefined)?.enableStatus;
            alertStore.add(
              'success',
              status === 'already_enabled' ? 'Database was already enabled' : 'Database re-enabled successfully'
            );
            await invalidateAll();
          } else if (result.type === 'failure') {
            const message = (result.data as { error?: string } | undefined)?.error?.trim();
            alertStore.add(
              'error',
              message || 'Failed to re-enable database. It remains disabled; check the server logs for details.'
            );
          } else {
            await applyAction(result);
          }
        };
      }}
    >
      <Button
        type="submit"
        variant="primary"
        icon={Power}
        text={enabling ? 'Re-enabling...' : 'Re-enable'}
        disabled={enabling}
      />
    </form>
  </div>
{/if}

<InstanceForm
  mode="edit"
  {form}
  instance={data.database}
  hasStoredPersonalAccessToken={data.hasPersonalAccessToken}
  personalAccessTokenMasked={data.personalAccessTokenMasked}
/>
