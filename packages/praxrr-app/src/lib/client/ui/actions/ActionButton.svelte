<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import type { ComponentType } from 'svelte';
  import { uniqueId } from '$lib/client/utils/uniqueId';
  import { getTabbable } from '$lib/client/utils/focusTrap';

  export let icon: ComponentType | undefined = undefined;
  export let iconClass: string = '';
  export let square: boolean = true; // Fixed size square button
  export let hasDropdown: boolean = false;
  export let dropdownPosition: 'left' | 'right' | 'middle' = 'left';
  export let disabled: boolean = false;
  export let title: string = '';
  export let type: 'button' | 'submit' = 'button';
  export let variant: 'neutral' | 'danger' = 'neutral';
  export let popupRole: 'menu' | 'listbox' | 'dialog' = 'menu';

  let hoverOpen = false;
  let pinned = false;
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;
  let wrapperEl: HTMLDivElement;
  let triggerEl: HTMLButtonElement;

  const dropdownId = uniqueId('action-menu');
  const menuItemSelector = '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="option"]';

  $: open = hasDropdown && (hoverOpen || pinned);

  const variantClasses = {
    neutral: 'hover:bg-neutral-50 dark:hover:bg-neutral-800',
    danger: 'hover:bg-neutral-50 dark:hover:bg-neutral-800',
  };

  const iconVariantClasses = {
    neutral: '',
    danger: 'group-hover:text-red-600 dark:group-hover:text-red-400',
  };

  function clearLeaveTimer() {
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  }

  function close() {
    clearLeaveTimer();
    hoverOpen = false;
    pinned = false;
  }

  function handleMouseEnter() {
    clearLeaveTimer();
    hoverOpen = true;
  }

  function handleMouseLeave() {
    clearLeaveTimer();
    // Small delay before closing to allow mouse to move to dropdown
    leaveTimer = setTimeout(() => {
      hoverOpen = false;
      leaveTimer = null;
    }, 100);
  }

  function enabledMenuItems(root: ParentNode): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(menuItemSelector)).filter((item) => {
      return !item.hasAttribute('disabled') && item.getAttribute('aria-disabled') !== 'true';
    });
  }

  async function focusFirstItem() {
    await tick();
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    const target =
      popupRole === 'dialog' ? getTabbable(dropdown)[0] : (enabledMenuItems(dropdown)[0] ?? getTabbable(dropdown)[0]);
    target?.focus();
  }

  function handleClick(event: MouseEvent) {
    if (!hasDropdown || disabled) return;
    // Hover only previews. A click pins; a second click (already pinned) closes.
    if (pinned) {
      close();
      return;
    }
    pinned = true;
    if (event.detail === 0) {
      void focusFirstItem();
    }
  }

  const autoCloseSelector = '[role="menuitem"],[role="menuitemradio"],[role="option"]';

  // Choosing a menu item closes the popup. Runs in the bubble phase, after the item's own handlers.
  function handleWrapperClick(event: MouseEvent) {
    if (!open || popupRole === 'dialog') return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown || !dropdown.contains(target)) return;
    const item = target.closest(autoCloseSelector);
    if (!item || !dropdown.contains(item)) return;
    const keyboardInitiated = event.detail === 0;
    queueMicrotask(() => {
      close();
      if (keyboardInitiated) triggerEl?.focus();
    });
  }

  function handleTriggerKeydown(event: KeyboardEvent) {
    if (!hasDropdown || disabled || event.key !== 'ArrowDown') return;
    event.preventDefault();
    event.stopPropagation();
    clearLeaveTimer();
    pinned = true;
    void focusFirstItem();
  }

  function handleWrapperKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || (!hoverOpen && !pinned)) return;
    event.preventDefault();
    event.stopPropagation();
    close();
    triggerEl?.focus();
  }

  function handleWindowPointerDown(event: PointerEvent) {
    if (!open || !wrapperEl) return;
    const target = event.target;
    if (target instanceof Node && wrapperEl.contains(target)) return;
    close();
  }

  // Close only when focus moves to a node outside the wrapper. A null relatedTarget (e.g. a mouse
  // press on a non-focusable area or Safari buttons) is ignored; click-away is handled by the
  // window pointerdown handler.
  function handleFocusOut(event: FocusEvent) {
    if (!open || !wrapperEl) return;
    const next = event.relatedTarget;
    if (next instanceof Node && !wrapperEl.contains(next)) close();
  }

  onDestroy(() => {
    clearLeaveTimer();
  });
</script>

<svelte:window on:pointerdown|capture={handleWindowPointerDown} />

<!-- Keyboard/focus handlers delegate for the trigger and its dropdown; the wrapper itself is not interactive. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
<div
  bind:this={wrapperEl}
  class="group relative flex"
  on:mouseenter={handleMouseEnter}
  on:mouseleave={handleMouseLeave}
  on:focusout={handleFocusOut}
  on:click={handleWrapperClick}
  on:keydown|capture={handleWrapperKeydown}
  role="group"
>
  <button
    bind:this={triggerEl}
    {type}
    {title}
    class="flex items-center justify-center border border-neutral-300 bg-white transition-colors dark:border-neutral-700/60 dark:bg-neutral-800/50 {square
      ? 'h-10 w-10'
      : 'h-10 px-4'} {disabled ? 'cursor-not-allowed opacity-50' : variantClasses[variant]}"
    {disabled}
    aria-haspopup={hasDropdown ? popupRole : undefined}
    aria-expanded={hasDropdown ? open : undefined}
    aria-controls={hasDropdown ? dropdownId : undefined}
    aria-label={title ? title : undefined}
    on:click
    on:click={handleClick}
    on:keydown={handleTriggerKeydown}
  >
    {#if icon}
      <svelte:component
        this={icon}
        size={20}
        class="text-neutral-700 dark:text-neutral-200 {variant === 'danger'
          ? iconVariantClasses.danger
          : ''} {iconClass}"
      />
    {/if}
    <slot />
  </button>

  {#if open}
    <div id={dropdownId} class="z-50" transition:fade={{ duration: 150 }}>
      <slot name="dropdown" {dropdownPosition} {open} {close} />
    </div>
  {/if}
</div>
