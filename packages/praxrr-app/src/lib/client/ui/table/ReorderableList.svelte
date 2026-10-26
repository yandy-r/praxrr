<script lang="ts" generics="T">
  import { tick } from 'svelte';
  import { uniqueId } from '$lib/client/utils/uniqueId';
  import { moveItem } from './reorder';
  export let items: T[];
  export let onReorder: (items: T[]) => void;
  export let getKey: (item: T) => string | number;
  export let dragGap: string = 'space-y-6';
  export let normalGap: string = 'space-y-4';
  export let sensitivity: number = 0.3;

  let draggedItemIndex: number | null = null;
  let lastTargetIndex: number | null = null;
  let listEl: HTMLDivElement | undefined = undefined;
  let announcement = '';
  const instructionsId = uniqueId('reorder-help');

  function handleDragStart(index: number) {
    draggedItemIndex = index;
    lastTargetIndex = index;
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();

    // Handle dragging way above or below the list
    if (draggedItemIndex !== null) {
      const container = e.currentTarget as HTMLElement;
      const rect = container.getBoundingClientRect();

      // If way above, move to top
      if (e.clientY < rect.top + 50) {
        if (lastTargetIndex !== 0) {
          moveItemToPosition(0);
        }
        return;
      }

      // If way below, move to bottom
      if (e.clientY > rect.bottom - 50) {
        const lastIndex = items.length - 1;
        if (lastTargetIndex !== lastIndex) {
          moveItemToPosition(lastIndex);
        }
        return;
      }
    }
  }

  function handleItemDragOver(e: DragEvent, targetIndex: number) {
    e.preventDefault();

    if (draggedItemIndex !== null) {
      const target = e.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;
      const itemHeight = rect.height;

      // If we're over a different item than our last target, require being in the middle zone
      if (lastTargetIndex !== targetIndex) {
        // Require being at least sensitivity% into the item before swapping to a NEW position
        if (relativeY < itemHeight * sensitivity || relativeY > itemHeight * (1 - sensitivity)) {
          return;
        }
      }
      // If we're over the same item we last swapped to, we're already in the right position
      // Don't do anything - this prevents flickering in the dead zones

      // Only reorder if we've moved to a different item
      if (lastTargetIndex === targetIndex) return;

      moveItemToPosition(targetIndex);
    }
  }

  function moveItemToPosition(targetIndex: number) {
    if (draggedItemIndex === null) return;

    const from = draggedItemIndex;
    lastTargetIndex = targetIndex;
    draggedItemIndex = targetIndex;
    const next = moveItem(items, from, targetIndex);
    if (next === items) return;

    items = next;
    onReorder(next);
  }

  function handleItemDrop(e: DragEvent, targetIndex: number) {
    e.preventDefault();
    e.stopPropagation();

    draggedItemIndex = null;
  }

  function handleDragEnd() {
    draggedItemIndex = null;
    lastTargetIndex = null;
  }

  async function handleItemKeydown(event: KeyboardEvent, index: number) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    if (!event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return;

    event.preventDefault();
    const target = event.key === 'ArrowUp' ? index - 1 : index + 1;
    if (target < 0 || target >= items.length) return;

    const row = event.currentTarget as HTMLElement;
    const label = (row.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const next = moveItem(items, index, target);
    items = next;
    onReorder(next);
    // Clear first so an identical message in a row is still announced.
    announcement = '';
    await tick();
    announcement = `${label ? `${label}: ` : ''}Moved item to position ${target + 1} of ${next.length}`;
    await tick();
    const moved = listEl?.querySelector<HTMLElement>(`[data-index="${target}"]`);
    moved?.focus();
  }
</script>

<div bind:this={listEl}>
  <p id={instructionsId} class="sr-only">Press Alt+ArrowUp or Alt+ArrowDown to reorder.</p>
  <div class="sr-only" role="status" aria-live="polite">{announcement}</div>
  <div
    class="{draggedItemIndex !== null ? dragGap : normalGap} transition-all duration-100"
    on:dragover={handleDragOver}
    role="list"
  >
    {#each items as item, index (getKey(item))}
      <!-- Focusable listitem so keyboard users can reorder with Alt+Arrow keys. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        draggable={true}
        tabindex="0"
        data-index={index}
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        aria-describedby={instructionsId}
        on:dragstart={() => handleDragStart(index)}
        on:dragover={(e) => handleItemDragOver(e, index)}
        on:drop={(e) => handleItemDrop(e, index)}
        on:dragend={handleDragEnd}
        on:keydown={(event) => handleItemKeydown(event, index)}
        class="cursor-move rounded-lg border border-neutral-200 bg-neutral-50 p-3 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700 {draggedItemIndex ===
        index
          ? 'scale-95 opacity-50'
          : ''}"
        style="transition: opacity 100ms, transform 100ms;"
        role="listitem"
      >
        <slot {item} {index} />
      </div>
    {/each}
  </div>
</div>
