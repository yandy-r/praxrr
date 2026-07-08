<script>
  // Self-contained demo island mirroring $ui/toggle/Toggle.svelte:
  // a labelled switch with an icon-checkbox indicator.
  let checked = false;

  function handleToggle() {
    checked = !checked;
  }

  function handleKeydown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleToggle();
    }
  }
</script>

<div class="not-content my-6 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
  <div
    role="switch"
    aria-checked={checked}
    aria-label="Demo toggle"
    tabindex="0"
    onclick={handleToggle}
    onkeydown={handleKeydown}
    class="flex max-w-xs cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
  >
    <span class="truncate">Enable feature</span>
    <span
      class="flex h-5 w-5 items-center justify-center rounded-full border transition-colors {checked
        ? 'border-emerald-600 bg-emerald-600 text-white'
        : 'border-slate-400 bg-transparent text-transparent'}"
      aria-hidden="true"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  </div>
  <p class="mt-3 text-sm text-slate-600 dark:text-slate-300">
    State: <code>checked = {checked}</code>
  </p>
</div>
