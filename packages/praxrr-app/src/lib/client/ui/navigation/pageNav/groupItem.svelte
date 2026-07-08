<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { userInterfacePreferencesStore } from '$stores/userInterfacePreferences.ts';

  export let label: string;
  export let href: string;

  /** Optional pattern to match against pathname for active state (supports string includes or regex) */
  export let activePattern: string | RegExp | undefined = undefined;

  $: isActive = (() => {
    const pathname = $page.url.pathname;

    // Use custom pattern if provided
    if (activePattern) {
      if (typeof activePattern === 'string') {
        return pathname.includes(activePattern);
      }

      return activePattern.test(pathname);
    }

    // Default behavior
    return pathname === href || pathname.startsWith(href + '/');
  })();

  function handleClick(e: MouseEvent) {
    if (href === '/auth/logout') {
      e.preventDefault();
      userInterfacePreferencesStore.clearOnAuthChange();
      goto(href);
    }
  }
</script>

<a
  {href}
  on:click={handleClick}
  class="block rounded-lg py-1.5 pr-2 pl-3 font-sans text-sm font-semibold text-neutral-600 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 {isActive
    ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
    : ''}"
>
  {label}
</a>
