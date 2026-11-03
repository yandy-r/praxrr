<script lang="ts">
  import { onMount } from 'svelte';
  import AccentPicker from './accentPicker.svelte';
  import ThemeToggle from './themeToggle.svelte';
  import { Menu, Search } from 'lucide-svelte';
  import { mobileNavOpen } from '$stores/mobileNav';
  import { commandPaletteOpen } from '$stores/commandPalette';
  import logo from '$assets/logo.svg';
  import { alertStore } from '$alerts/store';
  import MobileNavAlert from '$alerts/MobileNavAlert.svelte';
  import { isApplePlatform } from '$ui/command-palette/sources.ts';

  /** Show the command palette trigger; the palette is only mounted for authenticated or bypass sessions. */
  export let showSearch = false;

  $: latestAlert = $alertStore.length > 0 ? $alertStore[$alertStore.length - 1] : null;

  // SSR cannot know the platform; default to Ctrl and switch to Cmd on Apple platforms after mount.
  // Must match the palette's shortcut matcher (Cmd+K on Apple, Ctrl+K elsewhere).
  let shortcutHint = 'Ctrl K';
  let shortcutKeys = 'Control+K';
  onMount(() => {
    if (isApplePlatform(navigator.platform)) {
      shortcutHint = '⌘K';
      shortcutKeys = 'Meta+K';
    }
  });
</script>

<nav
  class="fixed top-0 left-0 z-50 w-full border-r-0 border-b border-neutral-200 bg-neutral-50 md:z-[80] md:w-80 md:border-r dark:border-neutral-800 dark:bg-neutral-900"
>
  <div class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-4">
    <!-- Left: Hamburger (mobile) + Brand name with logo (desktop) -->
    <div class="flex items-center gap-2">
      <button
        type="button"
        on:click={() => mobileNavOpen.open()}
        class="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-700 md:hidden dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
        aria-label="Open menu"
        aria-expanded={$mobileNavOpen}
        aria-controls="page-nav"
      >
        <Menu size={20} />
      </button>
      <img src={logo} alt="Praxrr logo" class="hidden h-5 w-5 translate-y-[2px] md:ml-4 md:block" />
      <div class="hidden text-xl font-bold text-neutral-900 md:block dark:text-neutral-100">praxrr</div>
    </div>

    <!-- Center: Mobile alerts -->
    <div class="flex min-w-0 justify-center md:hidden">
      {#if latestAlert}
        {#key latestAlert.id}
          <MobileNavAlert
            id={latestAlert.id}
            type={latestAlert.type}
            message={latestAlert.message}
            action={latestAlert.action}
          />
        {/key}
      {/if}
    </div>

    <!-- Right: Command palette trigger, accent picker and theme toggle -->
    <div class="flex items-center justify-end gap-1">
      {#if showSearch}
        <button
          type="button"
          on:click={() => commandPaletteOpen.open()}
          class="flex h-9 items-center gap-1.5 rounded-md px-2 text-neutral-600 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          aria-label="Open command palette"
          aria-keyshortcuts={shortcutKeys}
          aria-haspopup="dialog"
          aria-expanded={$commandPaletteOpen}
        >
          <Search size={18} aria-hidden="true" />
          <kbd
            class="hidden rounded border border-neutral-300 px-1 font-mono text-[10px] leading-4 text-neutral-500 md:inline dark:border-neutral-700 dark:text-neutral-400"
            aria-hidden="true">{shortcutHint}</kbd
          >
        </button>
      {/if}
      <AccentPicker />
      <ThemeToggle />
    </div>
  </div>
</nav>
