<script lang="ts">
  import { Database, Plus, Info, Sparkles } from 'lucide-svelte';
  import { goto } from '$app/navigation';
  import { enhance } from '$app/forms';
  import Modal from '$ui/modal/Modal.svelte';
  import InfoModal from '$ui/modal/InfoModal.svelte';
  import ActionsBar from '$ui/actions/ActionsBar.svelte';
  import ActionButton from '$ui/actions/ActionButton.svelte';
  import SearchAction from '$ui/actions/SearchAction.svelte';
  import ViewToggle from '$ui/actions/ViewToggle.svelte';
  import Button from '$ui/button/Button.svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import TableView from './views/TableView.svelte';
  import CardView from './views/CardView.svelte';
  import { createDataPageStore } from '$lib/client/stores/dataPage';
  import { alertStore } from '$alerts/store';
  import { pcdToUnifiedItem, trashToUnifiedItem } from './types';
  import type { UnifiedDatabaseItem } from './types';
  import type { PageData } from './$types';

  export let data: PageData;

  // Build unified items
  function buildUnifiedItems(): UnifiedDatabaseItem[] {
    const pcdItems = (data.databases || []).map(pcdToUnifiedItem);
    const trashItems = (data.trashSources || []).map(trashToUnifiedItem);
    return [...pcdItems, ...trashItems];
  }

  const { search, view, filtered, setItems } = createDataPageStore(buildUnifiedItems(), {
    storageKey: 'databasesView',
    searchKeys: ['name', 'repositoryUrl'],
  });

  $: setItems(buildUnifiedItems());

  // Modal state
  let showUnlinkModal = false;
  let showInfoModal = false;
  let selectedItem: UnifiedDatabaseItem | null = null;
  let unlinkPcdFormElement: HTMLFormElement;
  let unlinkTrashFormElement: HTMLFormElement;
  let unlinkLoading = false;

  function handleUnlink(event: CustomEvent<UnifiedDatabaseItem>) {
    selectedItem = event.detail;
    showUnlinkModal = true;
  }

  function submitUnlink() {
    if (!selectedItem) return;
    unlinkLoading = true;
    if (selectedItem.type === 'trash') {
      unlinkTrashFormElement?.requestSubmit();
    } else {
      unlinkPcdFormElement?.requestSubmit();
    }
  }

  $: isEmpty = (data.databases?.length ?? 0) === 0 && (data.trashSources?.length ?? 0) === 0;
</script>

<svelte:head>
  <title>Databases - Praxrr</title>
</svelte:head>

{#if isEmpty}
  <!-- Enhanced empty state -->
  <div class="flex min-h-[60vh] items-center justify-center p-4 sm:p-8">
    <div class="max-w-lg text-center">
      <div
        class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-neutral-100 dark:bg-neutral-800"
      >
        <Database size={32} class="text-neutral-400 dark:text-neutral-500" />
      </div>
      <h2 class="text-xl font-semibold text-neutral-900 dark:text-neutral-50">No Data Sources</h2>
      <p class="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        Get started by adding a source for quality profiles and custom formats.
      </p>
      <div class="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <Button text="Add TRaSH Guides" icon={Sparkles} variant="primary" href="/databases/new/trash-guide" />
        <Button text="Link Custom Database" icon={Database} variant="secondary" href="/databases/new/custom" />
      </div>
      <div class="mt-4">
        <a
          href="/databases/new"
          class="text-xs text-neutral-500 underline transition-colors hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
        >
          Browse all sources
        </a>
      </div>
    </div>
  </div>
{:else}
  <div class="space-y-6 p-4 sm:p-8">
    <!-- Actions Bar -->
    <ActionsBar>
      <SearchAction searchStore={search} placeholder="Search sources..." />
      <ActionButton icon={Plus} title="Add Source" on:click={() => goto('/databases/new')} />
      <ActionButton icon={Info} title="Info" on:click={() => (showInfoModal = true)} />
      <ViewToggle bind:value={$view} />
    </ActionsBar>

    <!-- Content -->
    <div class="mt-6">
      {#if $filtered.length === 0}
        <div
          class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
        >
          <p class="text-neutral-600 dark:text-neutral-400">No sources match your search</p>
        </div>
      {:else if $view === 'table'}
        <TableView items={$filtered} on:unlink={handleUnlink} />
      {:else}
        <CardView items={$filtered} on:unlink={handleUnlink} />
      {/if}
    </div>
  </div>
{/if}

<!-- Unlink Confirmation Modal -->
<Modal
  open={showUnlinkModal}
  header="Unlink {selectedItem?.type === 'trash' ? 'TRaSH Source' : 'Database'}"
  bodyMessage={`Are you sure you want to unlink "${selectedItem?.name}"? This action cannot be undone and all local data will be permanently removed.`}
  confirmText="Unlink"
  cancelText="Cancel"
  confirmDanger={true}
  loading={unlinkLoading}
  on:confirm={submitUnlink}
  on:cancel={() => {
    showUnlinkModal = false;
    selectedItem = null;
  }}
/>

<!-- Hidden PCD unlink form -->
<form
  bind:this={unlinkPcdFormElement}
  method="POST"
  action="?/delete"
  class="hidden"
  use:enhance={() => {
    return async ({ result, update }) => {
      unlinkLoading = false;
      showUnlinkModal = false;
      if (result.type === 'failure' && result.data) {
        alertStore.add('error', (result.data as { error?: string }).error || 'Failed to unlink database');
      } else if (result.type === 'redirect') {
        alertStore.add('success', 'Database unlinked successfully');
      }
      await update();
      selectedItem = null;
    };
  }}
>
  <input type="hidden" name="id" value={selectedItem?.type === 'pcd' ? selectedItem?.id : ''} />
</form>

<!-- Hidden TRaSH unlink form -->
<form
  bind:this={unlinkTrashFormElement}
  method="POST"
  action="?/deleteTrash"
  class="hidden"
  use:enhance={() => {
    return async ({ result, update }) => {
      unlinkLoading = false;
      showUnlinkModal = false;
      if (result.type === 'failure' && result.data) {
        alertStore.add('error', (result.data as { error?: string }).error || 'Failed to unlink TRaSH source');
      } else if (result.type === 'redirect') {
        alertStore.add('success', 'TRaSH source unlinked successfully');
      }
      await update();
      selectedItem = null;
    };
  }}
>
  <input type="hidden" name="id" value={selectedItem?.type === 'trash' ? selectedItem?.id : ''} />
</form>

<!-- Info Modal -->
<InfoModal bind:open={showInfoModal} header="Data Sources">
  <div class="space-y-4 text-sm text-neutral-600 dark:text-neutral-400">
    <div>
      <div class="font-medium text-neutral-900 dark:text-neutral-100">What are Data Sources?</div>
      <div class="mt-1">
        Data sources provide quality profiles, custom formats, and other configurations. You can link multiple sources
        and sync them to your Arr instances.
      </div>
    </div>

    <div>
      <div class="font-medium text-neutral-900 dark:text-neutral-100">TRaSH Guides</div>
      <div class="mt-1">
        TRaSH Guides provide curated quality profiles and custom formats for Radarr and Sonarr. They are
        community-maintained and regularly updated with best practices.
      </div>
    </div>

    <div>
      <div class="font-medium text-neutral-900 dark:text-neutral-100">PCD Databases</div>
      <div class="mt-1">
        Praxrr Compliant Database (PCD) repositories contain quality profiles, custom formats, and other configurations.
        Link a database to import and sync configurations to your Arr instances.
      </div>
    </div>

    <div>
      <div class="font-medium text-neutral-900 dark:text-neutral-100">Private & Dev Badges</div>
      <div class="mt-1">
        <strong>Private</strong> indicates the repository requires authentication.
        <strong>Dev</strong> means you have a personal access token configured, allowing you to push changes back to the repository.
      </div>
    </div>

    <div>
      <div class="font-medium text-neutral-900 dark:text-neutral-100">Sync Strategy</div>
      <div class="mt-1">
        Controls how often Praxrr checks for updates from the remote repository. Set to "Manual" to only sync when you
        explicitly trigger it, or choose an interval for automatic updates.
      </div>
    </div>

    <div>
      <div class="font-medium text-neutral-900 dark:text-neutral-100">Unlinking</div>
      <div class="mt-1">
        Unlinking a source removes all local data associated with it. Your Arr instances will keep any configurations
        that were already synced, but you won't be able to sync updates until you re-link.
      </div>
    </div>
  </div>
</InfoModal>
