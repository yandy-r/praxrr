<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { cubicIn, cubicOut } from 'svelte/easing';
  import { fade, scale } from 'svelte/transition';
  import { Loader2, Search } from 'lucide-svelte';
  import { afterNavigate, goto } from '$app/navigation';
  import { page } from '$app/stores';
  import Badge from '$ui/badge/Badge.svelte';
  import SourceBadge from '$ui/badge/SourceBadge.svelte';
  import { focusTrap, wrapIndex } from '$lib/client/utils/focusTrap';
  import { uniqueId } from '$lib/client/utils/uniqueId';
  import { commandPaletteOpen } from '$stores/commandPalette';
  import { navScope } from '$stores/navScope.ts';
  import { isSafeRelativeHref, type CommandPaletteRecent } from '$shared/search/recents.ts';
  import { SEARCH_LIMIT_DEFAULT, SEARCH_QUERY_MAX_LENGTH, type SearchResult } from '$shared/search/types.ts';
  import type { ArrType } from '$shared/pcd/types.ts';
  import type { NavShell } from '$shared/navigation/types.ts';
  import {
    recentKindLabel,
    buildPaletteGroups,
    createOptionIdMap,
    currentResults,
    flattenNavItems,
    isApplePlatform,
    isEditableTarget,
    isPaletteShortcut,
    parseSearchResults,
    type PaletteItem,
  } from './sources.ts';
  import { createRecentsSync, type RecentsBackend, type RecentsSync, type TimerHandle } from './recents.ts';

  export let navShell: NavShell;
  /** From root layout data: `api` for a signed-in user, `local` for auth-bypass sessions. */
  export let recentsBackend: RecentsBackend = 'local';

  const SEARCH_DEBOUNCE_MS = 150;
  // Only announce "Searching…" for slow searches; fast ones go straight to the result count.
  const SEARCHING_ANNOUNCE_DELAY_MS = 500;

  const titleId = uniqueId('command-palette-title');
  const inputId = uniqueId('command-palette-input');
  const listboxId = uniqueId('command-palette-listbox');
  const optionIdFor = createOptionIdMap(listboxId);

  let query = '';
  let results: SearchResult[] = [];
  // The trimmed query `results` were fetched for; results for any other query are stale.
  let resultsQuery: string | null = null;
  let loading = false;
  let announceSearching = false;
  let searchError: string | null = null;
  let activeKey: string | null = null;
  let listboxEl: HTMLDivElement | null = null;
  let applePlatform = false;

  let recents: CommandPaletteRecent[] = [];
  let recentsSync: RecentsSync | null = null;
  let recentsSyncBackend: RecentsBackend | null = null;

  let searchTimer: TimerHandle | null = null;
  let announceTimer: TimerHandle | null = null;
  let searchController: AbortController | null = null;
  // Only the response for the latest query may update results.
  let searchSeq = 0;

  $: open = $commandPaletteOpen;
  $: if (recentsBackend !== recentsSyncBackend) replaceRecentsSync(recentsBackend);
  $: navItems = flattenNavItems(navShell, $navScope);
  $: groups = buildPaletteGroups({
    query,
    recents,
    navItems,
    results: currentResults(results, resultsQuery, query),
    pathname: $page.url.pathname,
  });
  $: rows = indexGroups(groups);
  $: flatItems = rows.flatMap((group) => group.entries.map((entry) => entry.item));
  $: activeIndex = resolveActiveIndex(flatItems, activeKey);
  $: activeOptionId = flatItems.length > 0 ? optionIdFor(flatItems[activeIndex].key) : undefined;
  $: trimmedQuery = query.trim();
  $: statusText = resolveStatus(open, loading, announceSearching, searchError, trimmedQuery, flatItems.length);
  $: handleScopeChange($navScope);

  // Open/close side effects: reset the query on every open, (re)load recents until loaded.
  let wasOpen = false;
  $: if (open !== wasOpen) {
    wasOpen = open;
    if (open) handleOpened();
    else cancelSearch();
  }

  $: if (open && activeOptionId) scrollOptionIntoView(activeOptionId);

  function replaceRecentsSync(backend: RecentsBackend) {
    recentsSync?.flushOnDestroy();
    recentsSyncBackend = backend;
    recents = [];
    recentsSync = createRecentsSync({ backend, onChange: (next) => (recents = next) });
    if (open) void recentsSync.ensureLoaded();
  }

  // While a search is pending, keep the previous announcement unless it is slow.
  let lastStatus = '';
  function resolveStatus(
    isOpen: boolean,
    isLoading: boolean,
    slow: boolean,
    error: string | null,
    term: string,
    count: number
  ): string {
    if (!isOpen) lastStatus = '';
    else if (isLoading) lastStatus = slow ? 'Searching…' : lastStatus;
    else if (error) lastStatus = error;
    else if (term && count === 0) lastStatus = 'No results';
    else lastStatus = `${count} result${count === 1 ? '' : 's'} available`;
    return lastStatus;
  }

  function indexGroups(source: typeof groups) {
    let index = 0;
    return source.map((group) => ({
      ...group,
      entries: group.items.map((item) => ({ item, index: index++ })),
    }));
  }

  function resolveActiveIndex(items: PaletteItem[], key: string | null): number {
    if (items.length === 0 || key === null) return 0;
    const index = items.findIndex((item) => item.key === key);
    return index >= 0 ? index : 0;
  }

  async function scrollOptionIntoView(id: string) {
    await tick();
    const option = listboxEl?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    option?.scrollIntoView({ block: 'nearest' });
  }

  function handleOpened() {
    query = '';
    results = [];
    resultsQuery = null;
    searchError = null;
    activeKey = null;
    void recentsSync?.ensureLoaded();
  }

  let lastScope: ArrType | null = null;
  // Results are scope-filtered server-side; a scope change invalidates them.
  function handleScopeChange(scope: ArrType) {
    if (scope === lastScope) return;
    lastScope = scope;
    if (!open) return;
    resultsQuery = null;
    if (query.trim()) scheduleSearch(query);
  }

  function close() {
    commandPaletteOpen.close();
  }

  function stopSearchingAnnouncement() {
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = null;
    announceSearching = false;
  }

  function cancelSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = null;
    searchController?.abort();
    searchController = null;
    searchSeq += 1;
    loading = false;
    stopSearchingAnnouncement();
  }

  function scheduleSearch(value: string) {
    cancelSearch();
    const term = value.trim().slice(0, SEARCH_QUERY_MAX_LENGTH);
    if (!term) {
      results = [];
      resultsQuery = null;
      searchError = null;
      return;
    }
    loading = true;
    announceTimer = setTimeout(() => (announceSearching = true), SEARCHING_ANNOUNCE_DELAY_MS);
    const seq = searchSeq;
    searchTimer = setTimeout(() => runSearch(term, seq), SEARCH_DEBOUNCE_MS);
  }

  async function runSearch(term: string, seq: number) {
    const controller = new AbortController();
    searchController = controller;
    const params = new URLSearchParams({ q: term, limit: String(SEARCH_LIMIT_DEFAULT) });
    if ($navScope !== 'all') params.set('arrType', $navScope);
    try {
      const response = await fetch(`/api/v1/search?${params}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (seq !== searchSeq) return;
      if (!response.ok) {
        results = [];
        resultsQuery = term;
        searchError = response.status === 401 ? 'Sign in again to search.' : 'Search failed. Try again.';
        return;
      }
      const body: unknown = await response.json();
      if (seq !== searchSeq) return;
      results = parseSearchResults(body);
      resultsQuery = term;
      searchError = null;
    } catch (error) {
      if (seq !== searchSeq || (error instanceof DOMException && error.name === 'AbortError')) return;
      results = [];
      resultsQuery = term;
      searchError = 'Search is unavailable.';
    } finally {
      if (seq === searchSeq) {
        loading = false;
        searchController = null;
        stopSearchingAnnouncement();
      }
    }
  }

  function handleInput() {
    activeKey = null;
    scheduleSearch(query);
  }

  function activate(item: PaletteItem | undefined) {
    if (!item || !isSafeRelativeHref(item.href)) return;
    // Over-long hrefs still navigate; addRecent just does not store them.
    recentsSync?.record({ key: item.key, label: item.label, href: item.href, kind: item.kind });
    close();
    goto(item.href);
  }

  function moveActive(delta: number) {
    if (flatItems.length === 0) return;
    activeKey = flatItems[wrapIndex(activeIndex, delta, flatItems.length)].key;
  }

  function handlePanelKeydown(event: KeyboardEvent) {
    // IME composition owns these keys (e.g. Enter commits a candidate, Escape cancels it).
    if (event.isComposing || event.keyCode === 229) return;
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case 'ArrowDown':
        event.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveActive(-1);
        break;
      case 'Enter':
        if (flatItems.length === 0) return;
        event.preventDefault();
        activate(flatItems[activeIndex]);
        break;
    }
  }

  // Another modal dialog owns focus; do not stack the palette on top of it.
  function otherDialogOpen(): boolean {
    return Array.from(document.querySelectorAll('[aria-modal="true"]')).some(
      (dialog) => !dialog.hasAttribute('data-command-palette')
    );
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing) return;
    if (isPaletteShortcut(event, applePlatform)) {
      if (!open && otherDialogOpen()) return;
      event.preventDefault();
      commandPaletteOpen.toggle();
      return;
    }
    if (
      event.key === '/' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !open &&
      !isEditableTarget(event.target)
    ) {
      if (otherDialogOpen()) return;
      event.preventDefault();
      commandPaletteOpen.open();
    }
  }

  onMount(() => {
    applePlatform = isApplePlatform(navigator.platform);
  });

  afterNavigate(({ type }) => {
    if (type !== 'enter') close();
  });

  onDestroy(() => {
    cancelSearch();
    recentsSync?.flushOnDestroy();
  });
</script>

<svelte:window on:keydown={handleWindowKeydown} />

{#if open}
  <div
    class="fixed inset-0 z-[100] overflow-y-auto bg-black/50 backdrop-blur-sm"
    in:fade={{ duration: 120 }}
    out:fade={{ duration: 90 }}
  >
    <!-- svelte-ignore a11y-click-events-have-key-events -- backdrop click-to-close; Escape is handled on the dialog panel. -->
    <!-- svelte-ignore a11y-no-static-element-interactions -- see above -->
    <div
      class="flex min-h-full w-full items-start justify-center p-4 pt-[10vh] sm:p-6 sm:pt-[10vh]"
      on:click|self={close}
    >
      <!-- svelte-ignore a11y-no-noninteractive-element-interactions -- panel hosts the focus trap and combobox keys. -->
      <div
        class="relative flex max-h-[min(36rem,calc(100svh-4rem))] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabindex="-1"
        data-command-palette
        on:keydown={handlePanelKeydown}
        use:focusTrap={{ enabled: open, initialFocus: `#${inputId}` }}
        in:scale={{ duration: 140, start: 0.98, opacity: 0.5, easing: cubicOut }}
        out:scale={{ duration: 90, start: 0.98, opacity: 0.5, easing: cubicIn }}
      >
        <h2 id={titleId} class="sr-only">Command palette</h2>
        <div class="flex flex-shrink-0 items-center gap-3 border-b border-neutral-200 px-4 dark:border-neutral-800">
          {#if loading}
            <Loader2 size={18} class="shrink-0 animate-spin text-neutral-400" aria-hidden="true" />
          {:else}
            <Search size={18} class="shrink-0 text-neutral-400" aria-hidden="true" />
          {/if}
          <input
            id={inputId}
            type="text"
            class="h-12 w-full bg-transparent text-base text-neutral-900 placeholder:text-neutral-400 focus:outline-none sm:text-sm dark:text-neutral-100"
            placeholder="Search pages, actions and entities…"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            maxlength={SEARCH_QUERY_MAX_LENGTH}
            role="combobox"
            aria-label="Search pages, actions and entities"
            aria-expanded={flatItems.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeOptionId}
            bind:value={query}
            on:input={handleInput}
          />
          <kbd
            class="hidden shrink-0 rounded border border-neutral-200 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500 sm:inline dark:border-neutral-700 dark:text-neutral-400"
            >Esc</kbd
          >
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-2" bind:this={listboxEl}>
          <div id={listboxId} role="listbox" aria-label="Results">
            {#each rows as group (group.id)}
              {@const headingId = `${listboxId}-group-${group.id}`}
              <div role="presentation" class="mb-1 last:mb-0">
                <div
                  id={headingId}
                  aria-hidden="true"
                  class="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400"
                >
                  {group.label}
                </div>
                <div role="group" aria-labelledby={headingId}>
                  {#each group.entries as { item, index } (item.key)}
                    {@const isActive = index === activeIndex}
                    <!-- svelte-ignore a11y-click-events-have-key-events -- keyboard activation is handled by the combobox input. -->
                    <div
                      id={optionIdFor(item.key)}
                      role="option"
                      tabindex="-1"
                      aria-selected={isActive}
                      data-href={item.href}
                      class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm {isActive
                        ? 'bg-accent-50 dark:bg-accent-900/30 text-neutral-900 dark:text-neutral-50'
                        : 'text-neutral-700 dark:text-neutral-300'}"
                      on:mousemove={() => (activeKey = item.key)}
                      on:mousedown|preventDefault
                      on:click={() => activate(item)}
                    >
                      <span class="min-w-0 flex-1 truncate">{item.label}</span>
                      {#if item.description}
                        <span class="shrink-0 truncate text-xs text-neutral-500 dark:text-neutral-400"
                          >{item.description}</span
                        >
                      {:else if item.group === 'recent' && recentKindLabel(item.kind)}
                        <span class="shrink-0 text-xs text-neutral-500 dark:text-neutral-400"
                          >{recentKindLabel(item.kind)}</span
                        >
                      {/if}
                      {#if item.source}
                        <SourceBadge
                          sourceType={item.source.type}
                          sourceName={item.source.name}
                          arrType={item.source.arrType ?? null}
                        />
                      {:else if item.arrType}
                        <Badge variant={item.arrType}>{item.arrType}</Badge>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>

          {#if searchError}
            <p class="px-2 py-3 text-sm text-red-600 dark:text-red-400">{searchError}</p>
          {:else if trimmedQuery && flatItems.length === 0 && !loading}
            <p class="px-2 py-3 text-sm text-neutral-500 dark:text-neutral-400">No results</p>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Always mounted so screen readers register the live region before its text changes. -->
<p class="sr-only" role="status" aria-live="polite">{statusText}</p>
