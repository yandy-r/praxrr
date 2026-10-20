<script lang="ts">
  import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-svelte';
  import type { AlertAction, AlertType } from './store';
  import { alertStore } from './store';
  import { fade } from 'svelte/transition';

  export let id: string;
  export let type: AlertType;
  export let message: string;
  export let action: AlertAction | undefined = undefined;

  const icons = {
    success: CheckCircle,
    error: XCircle,
    warning: AlertTriangle,
    info: Info,
  };

  const styles = {
    success:
      'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/50 dark:text-emerald-200',
    error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-800/60 dark:bg-red-950/50 dark:text-red-200',
    warning:
      'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/50 dark:text-amber-200',
    info: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800/60 dark:bg-sky-950/50 dark:text-sky-200',
  };

  const iconColors = {
    success: 'text-emerald-600 dark:text-emerald-300',
    error: 'text-red-600 dark:text-red-300',
    warning: 'text-amber-600 dark:text-amber-300',
    info: 'text-sky-600 dark:text-sky-300',
  };

  const Icon = icons[type];

  function dismiss() {
    alertStore.remove(id);
  }
</script>

<!-- The message is announced by AlertLiveRegion, so only the text is hidden from assistive tech;
     focusable controls stay exposed with accessible names (axe aria-hidden-focus). -->
{#if action}
  <div
    in:fade={{ duration: 150 }}
    out:fade={{ duration: 100 }}
    class="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-semibold {styles[type]}"
  >
    <Icon size={14} aria-hidden="true" class="flex-shrink-0 {iconColors[type]}" />
    <span aria-hidden="true" class="min-w-0 truncate">{message}</span>
    <a href={action.href} onclick={dismiss} class="flex-shrink-0 underline underline-offset-2">{action.label}</a>
    <button
      type="button"
      aria-label="Dismiss notification"
      onclick={dismiss}
      class="ml-auto flex-shrink-0 opacity-70 hover:opacity-100"
    >
      <X size={14} />
    </button>
  </div>
{:else}
  <div
    in:fade={{ duration: 150 }}
    out:fade={{ duration: 100 }}
    role="button"
    aria-label="Dismiss notification"
    tabindex="0"
    onclick={dismiss}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        dismiss();
      }
    }}
    class="flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-semibold {styles[type]}"
  >
    <Icon size={14} aria-hidden="true" class="flex-shrink-0 {iconColors[type]}" />
    <span aria-hidden="true" class="min-w-0 truncate">{message}</span>
  </div>
{/if}
