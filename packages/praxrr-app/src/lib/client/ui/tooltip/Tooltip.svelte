<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { uniqueId } from '$lib/client/utils/uniqueId';

  export let text: string = '';
  export let position: 'top' | 'bottom' = 'bottom';

  const PADDING = 8;
  const descriptionId = uniqueId('tooltip');

  let visible = false;
  let style = '';
  let wrapperEl: HTMLDivElement;
  let tooltipEl: HTMLDivElement;
  const described: { el: HTMLElement | null; prior: string | null } = { el: null, prior: null };

  async function show() {
    if (!text || !wrapperEl) return;
    const rect = wrapperEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;

    // Initial position centered on trigger
    if (position === 'top') {
      style = `left:${centerX}px;top:${rect.top}px;transform:translate(-50%,-100%) translateY(-8px)`;
    } else {
      style = `left:${centerX}px;top:${rect.bottom}px;transform:translate(-50%,0) translateY(8px)`;
    }
    visible = true;

    // Wait for render, then clamp to viewport
    await tick();
    if (!tooltipEl) return;
    const tip = tooltipEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = centerX - tip.width / 2;
    left = Math.max(PADDING, Math.min(left, vw - tip.width - PADDING));

    let top: number;
    if (position === 'top') {
      top = rect.top - tip.height - 8;
      if (top < PADDING) top = rect.bottom + 8;
    } else {
      top = rect.bottom + 8;
      if (top + tip.height > vh - PADDING) top = rect.top - tip.height - 8;
    }

    style = `left:${left}px;top:${top}px`;
  }

  function hide() {
    visible = false;
  }

  function restoreDescribedBy() {
    const el = described.el;
    if (!el) return;
    if (described.prior) el.setAttribute('aria-describedby', described.prior);
    else el.removeAttribute('aria-describedby');
    described.el = null;
    described.prior = null;
  }

  const TARGET_SELECTOR = 'button, a[href], input, select, textarea, [tabindex]';

  function syncDescribedBy(currentText: string, root: HTMLDivElement | undefined) {
    if (!root) return;
    const target = currentText ? root.querySelector<HTMLElement>(TARGET_SELECTOR) : null;
    // Skip when the tooltip only repeats the target's accessible name (it would be read twice).
    const trimmed = currentText.trim();
    const duplicatesName =
      !!target && (target.getAttribute('aria-label')?.trim() === trimmed || target.textContent?.trim() === trimmed);
    if (!target || duplicatesName) {
      restoreDescribedBy();
      return;
    }
    if (described.el !== target) {
      restoreDescribedBy();
      described.prior = target.getAttribute('aria-describedby');
      described.el = target;
    }
    const ids = (described.prior ?? '').split(/\s+/).filter((id) => id && id !== descriptionId);
    ids.push(descriptionId);
    target.setAttribute('aria-describedby', ids.join(' '));
  }

  function hideFromFocus(event: FocusEvent) {
    const next = event.relatedTarget;
    if (next instanceof Node && wrapperEl?.contains(next)) return;
    hide();
  }

  function hideFromEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !visible) return;
    hide();
  }

  $: syncDescribedBy(text, wrapperEl);

  onMount(() => {
    syncDescribedBy(text, wrapperEl);
  });

  onDestroy(() => {
    restoreDescribedBy();
  });
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -- hover/focus delegation for the slotted trigger; the trigger keeps its own interactive semantics. -->
<div
  class="inline-flex"
  bind:this={wrapperEl}
  on:mouseenter={show}
  on:mouseleave={hide}
  on:focusin={show}
  on:focusout={hideFromFocus}
  on:keydown={hideFromEscape}
>
  <span id={descriptionId} class="sr-only">{text}</span>
  <slot />
  {#if text && visible}
    <div
      bind:this={tooltipEl}
      class="pointer-events-none fixed z-50"
      style="{style};border-radius:0.75rem !important"
      role="tooltip"
      aria-hidden="true"
    >
      <div
        class="border border-neutral-300 bg-white px-2 py-1 text-xs font-medium whitespace-nowrap text-neutral-900 shadow-lg dark:border-neutral-700/60 dark:bg-neutral-800 dark:text-neutral-50"
        style="border-radius:0.75rem !important"
      >
        {text}
      </div>
    </div>
  {/if}
</div>
