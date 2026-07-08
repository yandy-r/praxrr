<script lang="ts">
  export let label: string;
</script>

<div class="my-3 space-y-2 px-3">
  <div class="h-px rounded-full bg-neutral-200 dark:bg-neutral-700"></div>
  <p class="pl-1 text-left text-xs font-semibold tracking-[0.08em] text-neutral-500 uppercase dark:text-neutral-400">
    {label}
  </p>
  <div class="h-px rounded-full bg-neutral-200 dark:bg-neutral-700"></div>
</div>
