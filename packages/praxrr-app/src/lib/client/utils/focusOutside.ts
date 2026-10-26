/** Closes a popup when focus moves outside its wrapper, without moving focus. */
export function focusOutside(node: HTMLElement, callback: () => void) {
  const handleFocusOut = (event: FocusEvent) => {
    if (event.relatedTarget instanceof Node && !node.contains(event.relatedTarget)) {
      callback();
    }
  };

  node.addEventListener('focusout', handleFocusOut);

  return {
    update(newCallback: () => void) {
      callback = newCallback;
    },
    destroy() {
      node.removeEventListener('focusout', handleFocusOut);
    },
  };
}
