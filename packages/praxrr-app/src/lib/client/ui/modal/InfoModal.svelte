<script lang="ts">
  import { cubicIn, cubicOut } from 'svelte/easing';
  import { fade, scale } from 'svelte/transition';
  import { X } from 'lucide-svelte';
  import { focusTrap } from '$lib/client/utils/focusTrap';
  import { uniqueId } from '$lib/client/utils/uniqueId';

  export let open = false;
  export let header = 'Information';
  export let maxWidth = 'min(42rem, 90vw)';
  export let maxHeight = 'calc(100svh - 2rem)';

  const titleId = uniqueId('info-modal-title');

  function handleClose() {
    open = false;
  }

  // Handled on the dialog panel (not window) so only the innermost modal closes on Escape.
  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !open) return;
    e.preventDefault();
    e.stopPropagation();
    handleClose();
  }
</script>

{#if open}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-[100] overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:p-6"
    in:fade={{ duration: 140 }}
    out:fade={{ duration: 110 }}
  >
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="flex min-h-full w-full items-start justify-center sm:items-center" on:click|self={handleClose}>
      <!-- Modal -->
      <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
      <div
        class="relative my-4 flex w-full flex-col rounded-lg border border-neutral-200 bg-white shadow-xl sm:my-0 dark:border-neutral-700 dark:bg-neutral-900"
        style={`max-width: ${maxWidth}; max-height: ${maxHeight};`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabindex="-1"
        on:keydown={handleKeydown}
        use:focusTrap={{ enabled: open }}
        in:scale={{ duration: 170, start: 0.97, opacity: 0.5, easing: cubicOut }}
        out:scale={{ duration: 120, start: 0.97, opacity: 0.5, easing: cubicIn }}
      >
        <!-- Header -->
        <div
          class="flex flex-shrink-0 items-center justify-between border-b border-neutral-200 px-6 py-4 dark:border-neutral-800"
        >
          <h2 id={titleId} class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
            {header}
          </h2>
          <button
            type="button"
            on:click={handleClose}
            aria-label="Close"
            class="rounded-lg p-1 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <X size={20} />
          </button>
        </div>

        <!-- Body -->
        <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
        <div
          class="flex-1 overflow-auto px-6 py-4"
          role="region"
          tabindex="0"
          aria-labelledby={titleId}
          data-focus-trap-region
        >
          <slot />
        </div>
      </div>
    </div>
  </div>
{/if}
