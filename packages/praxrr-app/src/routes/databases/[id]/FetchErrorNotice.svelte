<script lang="ts">
  import { AlertTriangle } from 'lucide-svelte';
  import type { GitFetchFailure } from '$utils/git/errors';

  /** Fetch failure reported by the changes/commits API, or null when the fetch succeeded. */
  export let fetchError: GitFetchFailure | null;
  export let databaseId: number;
</script>

{#if fetchError}
  <div
    class="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200"
    role="alert"
    data-testid="database-fetch-error"
  >
    <AlertTriangle size={16} class="mt-0.5 shrink-0" aria-hidden="true" />
    <div class="space-y-1">
      <p class="font-medium">Couldn't check the remote repository for updates.</p>
      <p>{fetchError.message} The information below may be out of date.</p>
      {#if fetchError.kind === 'auth'}
        <p>
          <a href="/databases/{databaseId}/settings" class="font-medium underline hover:no-underline">
            Open database settings
          </a>
        </p>
      {/if}
    </div>
  </div>
{/if}
