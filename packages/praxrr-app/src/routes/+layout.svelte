<script lang="ts">
  import '../app.css';
  import logo from '$assets/logo.svg';
  import Navbar from '$ui/navigation/navbar/navbar.svelte';
  import PageNav from '$ui/navigation/pageNav/pageNav.svelte';
  import BottomNav from '$ui/navigation/bottomNav/BottomNav.svelte';
  import AlertContainer from '$alerts/AlertContainer.svelte';
  import AlertLiveRegion from '$alerts/AlertLiveRegion.svelte';
  import SetupChecklist from '$ui/setup/SetupChecklist.svelte';
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { eventsStore } from '$stores/events';
  import { startJobToasts } from '$lib/client/events/jobToasts';

  export let data;

  // Hide navigation on auth pages and the first-run setup wizard.
  $: isAuthPage = $page.url.pathname.startsWith('/auth/') || $page.url.pathname.startsWith('/setup');

  // `navShell` exists only for an authenticated user or a bypass session.
  $: liveEnabled = !isAuthPage && Boolean(data.navShell);

  let stopToasts: (() => void) | null = null;
  $: if (browser) {
    if (liveEnabled && !stopToasts) {
      eventsStore.start();
      stopToasts = startJobToasts();
    } else if (!liveEnabled && stopToasts) {
      stopToasts();
      stopToasts = null;
      eventsStore.stop();
    }
  }

  // <main> is not focusable by default; make it a temporary focus target so the skip link moves
  // keyboard focus (and the next Tab) into the content instead of only scrolling.
  function focusMain(event: MouseEvent) {
    const main = document.getElementById('main');
    if (!main) return;
    event.preventDefault();
    main.tabIndex = -1;
    main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true });
    main.focus();
  }

  onMount(() => () => {
    stopToasts?.();
    stopToasts = null;
    eventsStore.stop();
  });
</script>

<svelte:head>
  <link rel="icon" href={logo} />
  <title>Praxrr</title>
</svelte:head>
<a
  href="#main"
  on:click={focusMain}
  class="bg-accent-600 sr-only rounded-lg px-4 py-2 text-sm font-medium text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200]"
>
  Skip to main content
</a>

{#if !isAuthPage}
  <Navbar />
  <PageNav version={data.version} navShell={data.navShell} />
  <BottomNav navShell={data.navShell} />
{/if}
<AlertContainer />
<AlertLiveRegion />

<main id="main" class={isAuthPage ? 'focus:outline-none' : 'pt-16 pb-16 focus:outline-none md:pt-0 md:pb-0 md:pl-80'}>
  {#if data.setupChecklist}
    <SetupChecklist checklist={data.setupChecklist} />
  {/if}
  <slot />
</main>
