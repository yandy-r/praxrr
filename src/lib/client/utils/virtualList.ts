/**
 * Virtual list utility for rendering only visible items.
 *
 * Returns a Svelte action to attach to the scroll-observed container
 * and a readable store with the current visible range + spacer heights.
 *
 * Usage:
 *   const { state, action } = createVirtualList({ itemHeight: 57, buffer: 2 });
 *   $: ({ start, end, topHeight, bottomHeight } = $state);
 *   $: visibleItems = items.slice(start, end);
 *
 *   <div use:action>
 *     <spacer style="height: {topHeight}px" />
 *     {#each visibleItems as item}...{/each}
 *     <spacer style="height: {bottomHeight}px" />
 *   </div>
 */

import { writable, derived, type Readable } from 'svelte/store';

export interface VirtualListOptions {
  /** Fixed height per item in px */
  itemHeight: number;
  /** Extra items to render above/below viewport */
  buffer?: number;
  /** Fixed offset from the top of the container (e.g. thead height) */
  headerOffset?: number;
}

export interface VirtualListState {
  start: number;
  end: number;
  topHeight: number;
  bottomHeight: number;
}

export interface VirtualList {
  state: Readable<VirtualListState>;
  action: (node: HTMLElement) => { destroy: () => void };
  setItemCount: (count: number) => void;
}

export function createVirtualList(options: VirtualListOptions): VirtualList {
  const { itemHeight, buffer = 2, headerOffset = 0 } = options;

  const itemCount = writable(0);
  const startIndex = writable(0);
  const endIndex = writable(0);

  let containerEl: HTMLElement | null = null;
  let viewportHeight = 0;

  function updateVisibleRange() {
    let count = 0;
    itemCount.subscribe((v) => (count = v))();

    if (!containerEl || count === 0) {
      startIndex.set(0);
      endIndex.set(0);
      return;
    }

    const rect = containerEl.getBoundingClientRect();
    const offsetTop = -rect.top - headerOffset;

    const first = Math.floor(offsetTop / itemHeight) - buffer;
    const visible = Math.ceil(viewportHeight / itemHeight);
    const last = first + visible + buffer * 2;

    startIndex.set(Math.max(0, first));
    endIndex.set(Math.min(count, last));
  }

  function handleScroll() {
    updateVisibleRange();
  }

  function handleResize() {
    viewportHeight = window.innerHeight;
    updateVisibleRange();
  }

  const state = derived([startIndex, endIndex, itemCount], ([$start, $end, $count]) => ({
    start: $start,
    end: $end,
    topHeight: $start * itemHeight,
    bottomHeight: ($count - $end) * itemHeight,
  }));

  function action(node: HTMLElement) {
    containerEl = node;
    viewportHeight = window.innerHeight;
    updateVisibleRange();

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize, { passive: true });

    return {
      destroy() {
        containerEl = null;
        window.removeEventListener('scroll', handleScroll);
        window.removeEventListener('resize', handleResize);
      },
    };
  }

  function setItemCount(count: number) {
    itemCount.set(count);
    updateVisibleRange();
  }

  return { state, action, setItemCount };
}
