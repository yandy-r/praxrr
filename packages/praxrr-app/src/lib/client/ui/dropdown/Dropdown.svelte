<script lang="ts">
  import { onMount, afterUpdate } from 'svelte';

  export let position: 'left' | 'right' | 'middle' = 'left';
  export let mobilePosition: 'left' | 'right' | 'middle' | null = null;
  export let minWidth: string = '12rem';
  export let compact: boolean = false;
  // Fixed positioning to escape overflow containers
  export let fixed: boolean = false;
  export let triggerEl: HTMLElement | null = null;
  export let role: 'menu' | 'listbox' | 'dialog' | 'group' = 'menu';
  export let label: string | undefined = undefined;
  export let id: string | undefined = undefined;
  export let onClose: (() => void) | null = null;
  export let describedby: string | undefined = undefined;

  let dropdownEl: HTMLElement;
  let fixedStyle = '';

  const positionClasses = {
    left: 'left-0',
    right: 'right-0',
    middle: 'left-1/2 -translate-x-1/2',
  };

  const responsivePositionClasses: Record<string, string> = {
    'middle-to-right': 'left-1/2 -translate-x-1/2 md:left-auto md:right-0 md:translate-x-0',
    'middle-to-left': 'left-1/2 -translate-x-1/2 md:left-0 md:translate-x-0',
    'left-to-right': 'left-0 md:left-auto md:right-0',
    'right-to-left': 'right-0 md:right-auto md:left-0',
  };

  const menuItemSelector = '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="option"]';

  $: positionClass = fixed
    ? ''
    : mobilePosition && mobilePosition !== position
      ? responsivePositionClasses[`${mobilePosition}-to-${position}`] || positionClasses[position]
      : positionClasses[position];

  $: marginClass = compact ? 'mt-1' : 'mt-3';
  $: gap = compact ? 4 : 12; // pixels gap below trigger
  $: roundedClass = compact ? 'rounded-lg' : 'rounded-xl';

  function updateFixedPosition() {
    if (!fixed || !triggerEl) return;

    const rect = triggerEl.getBoundingClientRect();
    let left = rect.left;

    if (position === 'right') {
      left = rect.right;
      // Adjust to align right edge
      if (dropdownEl) {
        left = rect.right - dropdownEl.offsetWidth;
      }
    } else if (position === 'middle') {
      left = rect.left + rect.width / 2;
      if (dropdownEl) {
        left -= dropdownEl.offsetWidth / 2;
      }
    }

    fixedStyle = `top: ${rect.bottom + gap}px; left: ${left}px;`;
  }

  function enabledMenuItems(): HTMLElement[] {
    if (!dropdownEl) return [];
    return Array.from(dropdownEl.querySelectorAll<HTMLElement>(menuItemSelector)).filter((item) => {
      return !item.hasAttribute('disabled') && item.getAttribute('aria-disabled') !== 'true';
    });
  }

  function applyRovingTabIndex() {
    if (role !== 'menu' && role !== 'listbox') return;
    for (const item of enabledMenuItems()) {
      item.tabIndex = -1;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (!onClose) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (role !== 'menu' && role !== 'listbox') return;

    if (event.key === 'Tab') {
      if (onClose) onClose();
      return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
      return;
    }

    const items = enabledMenuItems();
    if (items.length === 0) return;

    const active = document.activeElement;
    const index = items.findIndex((item) => item === active || (active instanceof Node && item.contains(active)));

    let next = 0;
    if (event.key === 'ArrowDown') {
      next = index < 0 ? 0 : (index + 1) % items.length;
    } else if (event.key === 'ArrowUp') {
      next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
    } else if (event.key === 'End') {
      next = items.length - 1;
    }

    event.preventDefault();
    event.stopPropagation();
    items[next]?.focus();
    applyRovingTabIndex();
  }

  onMount(() => {
    applyRovingTabIndex();
    if (fixed && triggerEl) {
      updateFixedPosition();
      // Update position on scroll/resize
      window.addEventListener('scroll', updateFixedPosition, true);
      window.addEventListener('resize', updateFixedPosition);
      return () => {
        window.removeEventListener('scroll', updateFixedPosition, true);
        window.removeEventListener('resize', updateFixedPosition);
      };
    }
  });

  afterUpdate(() => {
    applyRovingTabIndex();
  });

  $: if (fixed && triggerEl && dropdownEl) {
    updateFixedPosition();
  }
</script>

<!-- Invisible hover bridge to keep dropdown open when moving mouse down -->
{#if !fixed}
  <div class="absolute top-full z-40 h-3 w-full" aria-hidden="true"></div>
{/if}

<div
  bind:this={dropdownEl}
  {id}
  {role}
  aria-label={label}
  aria-describedby={describedby}
  class="z-50 border border-neutral-300 bg-white shadow-lg dark:border-neutral-700/60 dark:bg-neutral-800 {roundedClass} {fixed
    ? 'fixed'
    : 'absolute top-full ' + marginClass} {positionClass}"
  style="min-width: {minWidth}; {fixed ? fixedStyle : ''}"
  onkeydown={handleKeydown}
>
  <slot />
</div>
