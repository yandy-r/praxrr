<script>
  // Self-contained demo island mirroring $ui/button/Button.svelte.
  // Uses standard Tailwind colors (the app's accent-* theme vars are not
  // available in the docs site), but reproduces the variant/size API.
  let variant = 'primary';
  let size = 'sm';
  let clicks = 0;

  const variants = ['primary', 'secondary', 'danger', 'ghost'];
  const sizes = ['xs', 'sm', 'md'];

  const sizeClasses = {
    xs: 'gap-1 rounded-lg px-2 py-1 text-xs',
    sm: 'gap-1.5 rounded-xl px-3 py-1.5 text-sm',
    md: 'gap-2 rounded-xl px-4 py-2.5 text-base',
  };

  const variantClasses = {
    primary: 'bg-emerald-600 text-white hover:bg-emerald-700',
    secondary:
      'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800',
  };

  function handleClick() {
    clicks += 1;
  }
</script>

<div class="not-content my-6 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
  <div class="mb-4 flex flex-wrap gap-4">
    <label class="text-sm font-medium text-slate-700 dark:text-slate-200">
      Variant
      <select
        bind:value={variant}
        class="ml-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
      >
        {#each variants as v}
          <option value={v}>{v}</option>
        {/each}
      </select>
    </label>
    <label class="text-sm font-medium text-slate-700 dark:text-slate-200">
      Size
      <select
        bind:value={size}
        class="ml-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
      >
        {#each sizes as s}
          <option value={s}>{s}</option>
        {/each}
      </select>
    </label>
  </div>

  <div class="flex items-center gap-4">
    <button
      type="button"
      class="inline-flex cursor-pointer items-center justify-center font-medium transition-colors {sizeClasses[
        size
      ]} {variantClasses[variant]}"
      onclick={handleClick}
    >
      Click me
    </button>
    <span class="text-sm text-slate-600 dark:text-slate-300">Clicked {clicks} times</span>
  </div>
</div>
