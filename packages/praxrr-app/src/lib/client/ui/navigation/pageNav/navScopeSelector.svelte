<script lang="ts">
  import { ARR_CONDITION_TARGET_OPTIONS } from '$shared/arr/capabilities.ts';
  import type { ArrType } from '$shared/pcd/types.ts';
  import type { NavShell } from '$shared/navigation/types.ts';
  import { navScope } from '$stores/navScope.ts';

  export let navShell: NavShell | undefined = undefined;

  $: availableScopes = navShell?.arrScopeOptions ?? [];

  $: scopeOptions = ARR_CONDITION_TARGET_OPTIONS.filter((option) => availableScopes.includes(option.value));

  $: navScope.syncAvailableScopes(availableScopes);

  function onScopeChange(event: Event) {
    const target = event.currentTarget as HTMLSelectElement;
    navScope.setScope(target.value as ArrType);
  }
</script>

<div class="mb-4 space-y-1.5">
  <label for="nav-scope-select" class="block text-xs font-medium tracking-wide text-neutral-500 dark:text-neutral-400"
    >Apps Scope</label
  >
  <select
    id="nav-scope-select"
    value={$navScope}
    on:change={onScopeChange}
    class="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 transition-colors outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:focus:border-neutral-400 dark:focus:ring-1 dark:focus:ring-neutral-400"
  >
    {#each scopeOptions as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
</div>
