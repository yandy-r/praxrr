<script lang="ts">
  import { Pencil } from 'lucide-svelte';
  import { createEventDispatcher } from 'svelte';
  import ActionButton from '$ui/actions/ActionButton.svelte';

  export let active: boolean = false;
  export let count: number = 0;

  const dispatch = createEventDispatcher<{ toggle: void }>();

  // ActionButton does not expose aria-pressed, so mirror the toggle state onto its trigger button.
  function pressed(node: HTMLElement, value: boolean) {
    const button = node.querySelector('button');
    button?.setAttribute('aria-pressed', String(value));
    return {
      update(next: boolean) {
        button?.setAttribute('aria-pressed', String(next));
      },
    };
  }
</script>

<div class="flex" use:pressed={active}>
  <ActionButton
    icon={Pencil}
    label="Show only locally modified"
    variant="neutral"
    square
    iconClass={active ? 'text-accent-600 dark:text-accent-400' : ''}
    on:click={() => dispatch('toggle')}
  >
    {#if count > 0}
      <span
        aria-hidden="true"
        class="bg-accent-600 absolute top-4 right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold text-white"
      >
        {count > 9 ? '9+' : count}
      </span>
    {/if}
  </ActionButton>
</div>
