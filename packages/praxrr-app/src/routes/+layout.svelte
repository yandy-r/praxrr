<script lang="ts">
  import '../app.css';
  import logo from '$assets/logo.svg';
  import Navbar from '$ui/navigation/navbar/navbar.svelte';
  import PageNav from '$ui/navigation/pageNav/pageNav.svelte';
  import BottomNav from '$ui/navigation/bottomNav/BottomNav.svelte';
  import AlertContainer from '$alerts/AlertContainer.svelte';
  import { page } from '$app/stores';

  export let data;

  // Hide navigation on auth pages and the first-run setup wizard.
  $: isAuthPage = $page.url.pathname.startsWith('/auth/') || $page.url.pathname.startsWith('/setup');
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

<main class={isAuthPage ? '' : 'pt-16 pb-16 md:pt-0 md:pb-0 md:pl-80'}>
  <slot />
</main>
