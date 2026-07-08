<script lang="ts">
  import type { ActionData, PageData } from './$types';
  import { enhance } from '$app/forms';
  import { ArrowLeft, ArrowRight } from 'lucide-svelte';
  import Button from '$ui/button/Button.svelte';
  import { alertStore } from '$alerts/store';

  export let data: PageData;
  export let form: ActionData;

  let submitting = false;
  let selected = new Set(data.selectedProfileNames);

  $: if (form?.error) {
    alertStore.add('error', form.error);
  }

  function toggle(name: string, checked: boolean) {
    if (checked) {
      selected.add(name);
    } else {
      selected.delete(name);
    }
    selected = selected;
  }
</script>

<svelte:head>
  <title>Select Profiles - Setup - Praxrr</title>
</svelte:head>

<div class="space-y-6">
  <p class="text-neutral-600 dark:text-neutral-400">
    Choose which <span class="font-medium">{data.arrTypeLabel}</span>-compatible quality profiles from
    <span class="font-medium">{data.databaseName}</span> should sync to this instance. Custom formats are already scored on
    each profile — you can fine-tune them later.
  </p>

  {#if data.profiles.length === 0}
    <div
      class="rounded-lg border border-neutral-200/60 bg-white/50 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700/60 dark:bg-neutral-800/50 dark:text-neutral-400"
    >
      This database has no {data.arrTypeLabel}-compatible profiles yet. You can continue and select profiles later from
      the instance's sync page.
    </div>
  {:else}
    <ul class="space-y-2">
      {#each data.profiles as profile (profile.name)}
        <li>
          <label
            class="flex items-start gap-3 rounded-lg border border-neutral-200/60 bg-white/50 p-3 text-sm shadow-sm backdrop-blur-sm dark:border-neutral-700/60 dark:bg-neutral-800/50"
          >
            <input
              type="checkbox"
              class="mt-0.5"
              checked={selected.has(profile.name)}
              onchange={(event) => toggle(profile.name, (event.currentTarget as HTMLInputElement).checked)}
            />
            <span class="min-w-0 flex-1">
              <span class="block font-medium text-neutral-900 dark:text-neutral-50">{profile.name}</span>
              {#if profile.description}
                <span class="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400">{profile.description}</span>
              {/if}
            </span>
            <span class="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
              {profile.customFormatCount} custom format{profile.customFormatCount === 1 ? '' : 's'}
            </span>
          </label>
        </li>
      {/each}
    </ul>
  {/if}

  <form
    method="POST"
    use:enhance={() => {
      submitting = true;
      return async ({ update }) => {
        await update();
        submitting = false;
      };
    }}
  >
    <input type="hidden" name="selectedProfileNames" value={JSON.stringify([...selected])} />

    <div class="flex items-center justify-between">
      <Button variant="ghost" size="md" icon={ArrowLeft} text="Back" href="/setup/link-database" />
      <Button
        type="submit"
        variant="primary"
        size="md"
        icon={ArrowRight}
        iconPosition="right"
        text={submitting ? 'Saving…' : 'Next'}
        disabled={submitting}
      />
    </div>
  </form>
</div>
