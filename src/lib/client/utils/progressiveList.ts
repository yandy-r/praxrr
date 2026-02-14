/**
 * Progressive list utility for loading items in batches as the user scrolls.
 *
 * Uses IntersectionObserver on a sentinel element to detect when the user
 * approaches the end of the rendered list, then increases the visible count.
 * Items are only added, never removed, so there's no scroll jumping.
 *
 * Usage:
 *   const { visibleCount, sentinel, reset, hasMore, setTotalCount } =
 *     createProgressiveList({ pageSize: 50 });
 *
 *   $: setTotalCount(items.length);
 *   $: items, reset();
 *   $: displayItems = items.slice(0, $visibleCount);
 *
 *   {#each displayItems as item}...{/each}
 *   <div use:sentinel />
 */

import { writable, derived, type Writable, type Readable } from 'svelte/store';

export interface ProgressiveListOptions {
  /** Number of items to render per batch */
  pageSize: number;
  /** IntersectionObserver rootMargin — triggers loading before sentinel is visible */
  rootMargin?: string;
}

export interface ProgressiveList {
  visibleCount: Writable<number>;
  sentinel: (node: HTMLElement) => { destroy: () => void };
  reset: () => void;
  hasMore: Readable<boolean>;
  setTotalCount: (n: number) => void;
}

export function createProgressiveList(options: ProgressiveListOptions): ProgressiveList {
  const { pageSize, rootMargin = '200px' } = options;

  const visibleCount = writable(pageSize);
  const totalCount = writable(0);

  const hasMore = derived([visibleCount, totalCount], ([$visible, $total]) => $visible < $total);

  let observer: IntersectionObserver | null = null;

  function loadMore() {
    let current = 0;
    let total = 0;
    visibleCount.subscribe((v) => (current = v))();
    totalCount.subscribe((v) => (total = v))();

    if (current < total) {
      visibleCount.set(Math.min(current + pageSize, total));
    }
  }

  function sentinel(node: HTMLElement) {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      { rootMargin }
    );
    observer.observe(node);

    return {
      destroy() {
        observer?.disconnect();
        observer = null;
      },
    };
  }

  function reset() {
    visibleCount.set(pageSize);
  }

  function setTotalCount(n: number) {
    totalCount.set(n);
  }

  return { visibleCount, sentinel, reset, hasMore, setTotalCount };
}
