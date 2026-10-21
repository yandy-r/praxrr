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

{#if !isAuthPage}
  <Navbar />
  <PageNav version={data.version} navShell={data.navShell} />
  <BottomNav navShell={data.navShell} />
{/if}
<AlertContainer />
<AlertLiveRegion />

<main class={isAuthPage ? '' : 'pt-16 pb-16 md:pt-0 md:pb-0 md:pl-80'}>
  {#if data.setupChecklist}
    <SetupChecklist checklist={data.setupChecklist} />
  {/if}
  <slot />
</main>
