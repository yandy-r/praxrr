<script lang="ts">
  import type { LayoutData } from './$types';
  import { page } from '$app/stores';
  import { goto, afterNavigate } from '$app/navigation';
  import { alertStore } from '$alerts/store';
  import Button from '$ui/button/Button.svelte';
  import { X } from 'lucide-svelte';
  import logo from '$assets/logo.svg';
  import type { WizardStep } from '$db/queries/setupState.ts';

  export let data: LayoutData;

  const STEPS: { step: WizardStep; label: string }[] = [
    { step: 'welcome', label: 'Welcome' },
    { step: 'connect-arr', label: 'Connect' },
    { step: 'link-database', label: 'Database' },
    { step: 'select-profiles', label: 'Profiles' },
    { step: 'preview-sync', label: 'Preview' },
    { step: 'done', label: 'Done' },
  ];

  let skipping = false;
  let headingEl: HTMLHeadingElement;

  // Highlight progress off the URL (so back/forward navigation reflects
  // immediately) and fall back to the persisted step only when the segment
  // isn't a wizard step (e.g. `/setup` itself, before it redirects).
  $: urlStepIndex = STEPS.findIndex((s) => s.step === $page.url.pathname.split('/').pop());
  $: activeIndex =
    urlStepIndex >= 0
      ? urlStepIndex
      : Math.max(
          STEPS.findIndex((s) => s.step === data.wizard.currentStep),
          0
        );
  $: activeStep = STEPS[activeIndex] ?? STEPS[0];

  // Move focus to the step heading on every navigation so screen reader users
  // get an announcement instead of silently landing mid-page.
  afterNavigate(() => {
    headingEl?.focus();
  });

  async function handleSkip() {
    skipping = true;
    try {
      const res = await fetch('/api/v1/setup/skip', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to skip setup');
      await goto('/');
    } catch {
      alertStore.add('error', 'Could not skip setup — please try again.');
    } finally {
      skipping = false;
    }
  }
</script>

<svelte:head>
  <title>Setup - Praxrr</title>
</svelte:head>

<div class="flex min-h-screen flex-col bg-neutral-100 dark:bg-neutral-900">
  <header
    class="border-b border-neutral-200/60 bg-white/50 px-4 py-4 backdrop-blur-sm dark:border-neutral-700/60 dark:bg-neutral-800/50"
  >
    <div class="mx-auto flex max-w-3xl items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <img src={logo} alt="Praxrr logo" class="h-8 w-8" />
        <span class="text-sm font-medium text-neutral-500 dark:text-neutral-400">
          Step {activeIndex + 1} of {STEPS.length}
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        icon={X}
        text="Skip wizard"
        disabled={skipping}
        on:click={handleSkip}
      />
    </div>

    <ol class="mx-auto mt-4 flex max-w-3xl items-center gap-2" aria-label="Setup steps">
      {#each STEPS as step, index (step.step)}
        <li class="flex flex-1 items-center gap-2">
          <span
            class="h-1.5 flex-1 rounded-full {index <= activeIndex
              ? 'bg-accent-600 dark:bg-accent-500'
              : 'bg-neutral-200 dark:bg-neutral-700'}"
            aria-hidden="true"
          ></span>
        </li>
      {/each}
    </ol>
  </header>

  <main class="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
    <h1
      bind:this={headingEl}
      tabindex="-1"
      class="mb-6 text-xl font-bold text-neutral-900 outline-none dark:text-neutral-50"
    >
      {activeStep.label}
    </h1>
    <div aria-live="polite" class="sr-only">{activeStep.label} step</div>
    <slot />
  </main>
</div>
