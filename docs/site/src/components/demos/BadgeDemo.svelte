<script>
  // Self-contained demo island mirroring $ui/badge/Badge.svelte variants.
  // Uses standard Tailwind palettes in place of the app's accent-* theme.
  let size = 'md';
  const sizes = ['sm', 'md'];

  const badges = [
    {
      variant: 'accent',
      label: 'accent',
      classes: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
    },
    {
      variant: 'success',
      label: 'success',
      classes: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
    },
    {
      variant: 'warning',
      label: 'warning',
      classes: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    },
    { variant: 'danger', label: 'danger', classes: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
    { variant: 'info', label: 'info', classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
    {
      variant: 'neutral',
      label: 'neutral',
      classes: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    },
  ];

  const sizeClasses = {
    sm: 'px-1.5 py-0.5 text-[10px]',
    md: 'px-2 py-0.5 text-xs',
  };
</script>

<div class="not-content my-6 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
  <label class="mb-4 block text-sm font-medium text-slate-700 dark:text-slate-200">
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

  <div class="flex flex-wrap items-center gap-2">
    {#each badges as badge}
      <span class="inline-flex items-center gap-1 rounded font-medium {badge.classes} {sizeClasses[size]}">
        {badge.label}
      </span>
    {/each}
  </div>
</div>
