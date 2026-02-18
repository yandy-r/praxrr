/**
 * Svelte action that calls a callback when clicking outside the element
 *
 * Usage:
 * <div use:clickOutside={() => (open = false)}>
 *   ...
 * </div>
 */
export function clickOutside(node: HTMLElement, callback: () => void) {
  const handleClick = (event: MouseEvent) => {
    if (!node.contains(event.target as Node)) {
      callback();
    }
  };

  document.addEventListener('click', handleClick, true);

  return {
    update(newCallback: () => void) {
      callback = newCallback;
    },
    destroy() {
      document.removeEventListener('click', handleClick, true);
    },
  };
}
