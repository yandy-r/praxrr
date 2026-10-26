export type FocusTrapParams = {
  enabled?: boolean;
  initialFocus?: HTMLElement | string | null;
  restoreFocus?: boolean;
};

const TABBABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'audio[controls]',
  'video[controls]',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function isTabbable(el: HTMLElement, root: HTMLElement): boolean {
  if (el.tabIndex < 0) return false;
  if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false;

  let current: HTMLElement | null = el;
  while (current) {
    if (current.hasAttribute('hidden')) return false;
    // Content of a closed <details> is not rendered; only its direct summary stays reachable.
    if (
      current !== el &&
      current instanceof HTMLDetailsElement &&
      !current.open &&
      !(el.tagName === 'SUMMARY' && el.parentElement === current)
    ) {
      return false;
    }
    const style = getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (current === root) break;
    current = current.parentElement;
  }

  return true;
}

export function getTabbable(node: HTMLElement): HTMLElement[] {
  const found = node.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR);
  const seen = new Set<HTMLElement>();
  const tabbable: HTMLElement[] = [];

  for (let i = 0; i < found.length; i += 1) {
    const el = found[i];
    if (!el || seen.has(el) || !isTabbable(el, node)) continue;
    seen.add(el);
    tabbable.push(el);
  }

  return collapseRadioGroups(tabbable);
}

function radioGroupKey(el: HTMLInputElement): string | null {
  if (el.type !== 'radio' || !el.name) return null;
  const form = el.form;
  return `${form ? form.id || form.getAttribute('name') || 'form' : ''}\u0000${el.name}`;
}

/** Browsers tab into a radio group once: the checked radio, else the first one. */
function collapseRadioGroups(elements: HTMLElement[]): HTMLElement[] {
  const chosen = new Map<string, HTMLInputElement>();
  for (const el of elements) {
    if (!(el instanceof HTMLInputElement)) continue;
    const key = radioGroupKey(el);
    if (key === null) continue;
    const existing = chosen.get(key);
    if (!existing || (el.checked && !existing.checked)) chosen.set(key, el);
  }
  if (chosen.size === 0) return elements;

  return elements.filter((el) => {
    if (!(el instanceof HTMLInputElement)) return true;
    const key = radioGroupKey(el);
    return key === null || chosen.get(key) === el;
  });
}

export function wrapIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (((current + delta) % length) + length) % length;
}

function resolveTarget(
  node: HTMLElement,
  initialFocus: FocusTrapParams['initialFocus']
): { target: HTMLElement; addedTabIndex: boolean } {
  if (initialFocus instanceof HTMLElement && node.contains(initialFocus)) {
    return { target: initialFocus, addedTabIndex: false };
  }

  if (typeof initialFocus === 'string' && initialFocus) {
    const found = node.querySelector<HTMLElement>(initialFocus);
    if (found) return { target: found, addedTabIndex: false };
  }

  const tabbable = getTabbable(node);
  // Prefer the first interactive control over passive scroll regions (marked for keyboard scrolling).
  const preferred = tabbable.find((el) => !el.hasAttribute('data-focus-trap-region')) ?? tabbable[0];
  if (preferred) return { target: preferred, addedTabIndex: false };

  if (node.hasAttribute('tabindex')) return { target: node, addedTabIndex: false };
  node.tabIndex = -1;
  return { target: node, addedTabIndex: true };
}

export function focusTrap(node: HTMLElement, params: FocusTrapParams = {}) {
  let enabled = params.enabled !== false;
  let restoreFocus = params.restoreFocus !== false;
  let initialFocus = params.initialFocus;
  let previouslyFocused: HTMLElement | null = null;
  let active = false;
  let addedTabIndex = false;

  function onKeydown(event: KeyboardEvent) {
    if (!enabled || event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;

    const tabbable = getTabbable(node);
    if (tabbable.length === 0) {
      event.preventDefault();
      node.focus();
      return;
    }

    const currentElement = document.activeElement;
    const current = currentElement instanceof HTMLElement ? tabbable.indexOf(currentElement) : -1;

    if (current === -1) {
      event.preventDefault();
      tabbable[event.shiftKey ? tabbable.length - 1 : 0].focus();
      return;
    }

    const leaving = event.shiftKey ? current === 0 : current === tabbable.length - 1;
    if (!leaving) return;

    event.preventDefault();
    tabbable[wrapIndex(current, event.shiftKey ? -1 : 1, tabbable.length)].focus();
  }

  function activate() {
    if (active) return;
    active = true;
    const activeElement = document.activeElement;
    previouslyFocused = activeElement instanceof HTMLElement ? activeElement : null;
    node.addEventListener('keydown', onKeydown);
    const resolved = resolveTarget(node, initialFocus);
    addedTabIndex = resolved.addedTabIndex;
    const target = resolved.target;
    queueMicrotask(() => {
      if (!active) return;
      target.focus();
    });
  }

  function deactivate() {
    if (!active) return;
    active = false;
    node.removeEventListener('keydown', onKeydown);
    if (addedTabIndex) {
      node.removeAttribute('tabindex');
      addedTabIndex = false;
    }
    const restoreTarget = previouslyFocused;
    previouslyFocused = null;
    if (restoreFocus && restoreTarget?.isConnected) restoreTarget.focus();
  }

  if (enabled) activate();

  return {
    update(next: FocusTrapParams = {}) {
      restoreFocus = next.restoreFocus !== false;
      initialFocus = next.initialFocus;
      const nextEnabled = next.enabled !== false;
      if (nextEnabled === enabled) return;
      enabled = nextEnabled;
      if (enabled) activate();
      else deactivate();
    },
    destroy() {
      if (enabled) deactivate();
    },
  };
}
