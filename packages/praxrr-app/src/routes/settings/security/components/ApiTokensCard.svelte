<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { AlertTriangle, Ban, Clock, Copy, KeyRound, Plus, Tag, X } from 'lucide-svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import Button from '$ui/button/Button.svelte';
  import Modal from '$ui/modal/Modal.svelte';
  import Table from '$ui/table/Table.svelte';
  import TableActionButton from '$ui/table/TableActionButton.svelte';
  import type { Column } from '$ui/table/types';
  import { alertStore } from '$alerts/store';
  import { parseUTC } from '$shared/utils/dates';
  import {
    API_TOKEN_EXPIRY_OPTIONS,
    API_TOKEN_NAME_MAX_LENGTH,
    API_TOKEN_SCOPES,
    API_TOKEN_SCOPE_INFO,
    type ApiTokenStatus,
    type ApiTokenSummary,
  } from '$shared/auth/apiTokenScopes.ts';

  export let tokens: ApiTokenSummary[];
  export let hasLegacyToken: boolean;
  /** The token returned by the last successful create action; its secret is shown exactly once. */
  export let created: { secret: string; token: ApiTokenSummary } | null = null;

  let creating = false;
  let revoking = false;
  let dismissedSecret: string | null = null;
  let pendingRevoke: ApiTokenSummary | null = null;
  let revokeForm: HTMLFormElement | null = null;

  $: visibleSecret = created && created.secret !== dismissedSecret ? created.secret : null;

  const statusVariants: Record<ApiTokenStatus, 'success' | 'warning' | 'neutral'> = {
    active: 'success',
    expired: 'warning',
    revoked: 'neutral',
  };
  const statusLabels: Record<ApiTokenStatus, string> = {
    active: 'Active',
    expired: 'Expired',
    revoked: 'Revoked',
  };

  const inputClass =
    'block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50 dark:focus:border-neutral-500 dark:focus:ring-neutral-500';

  // Columns without `cell` render through the table's `cell` slot below.
  const columns: Column<ApiTokenSummary>[] = [
    { key: 'name', header: 'Name', headerIcon: KeyRound },
    { key: 'prefix', header: 'Prefix', hideOnMobile: true },
    { key: 'scopes', header: 'Scopes', headerIcon: Tag },
    { key: 'createdAt', header: 'Created', headerIcon: Clock, hideOnMobile: true },
    { key: 'lastUsedAt', header: 'Last used', headerIcon: Clock },
    { key: 'expiresAt', header: 'Expires', headerIcon: Clock, hideOnMobile: true },
    { key: 'status', header: 'Status' },
  ];

  function formatDate(value: string | null): string {
    if (!value) return 'Never';
    return parseUTC(value)?.toLocaleString() ?? 'Unknown';
  }

  async function copySecret(secret: string) {
    try {
      await navigator.clipboard.writeText(secret);
      alertStore.add('success', 'Token copied to clipboard');
    } catch {
      alertStore.add('error', 'Could not copy token');
    }
  }

  function confirmRevoke() {
    if (!pendingRevoke || !revokeForm) return;
    revokeForm.requestSubmit();
  }
</script>

<div class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
  <div class="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
    <h2 class="text-lg font-semibold text-neutral-900 md:text-xl dark:text-neutral-50">API tokens</h2>
    <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
      Tokens authenticate <code class="rounded bg-neutral-100 px-1 py-0.5 text-xs dark:bg-neutral-800">/api/v1</code>
      requests via the
      <code class="rounded bg-neutral-100 px-1 py-0.5 text-xs dark:bg-neutral-800">X-Api-Key</code> header. Give each integration
      its own token with only the scopes it needs.
    </p>
  </div>
  <div class="space-y-6 p-6">
    {#if hasLegacyToken}
      <div
        role="alert"
        class="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
      >
        <AlertTriangle size={16} class="mt-0.5 shrink-0" />
        <p>The legacy API key is deprecated. Create scoped tokens for your integrations, then revoke the legacy key.</p>
      </div>
    {/if}

    {#if visibleSecret}
      <div
        class="space-y-3 rounded-lg border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/40"
        data-testid="created-api-token"
      >
        <p class="text-sm font-medium text-emerald-900 dark:text-emerald-200">
          Copy this token now. You won't be able to see it again.
        </p>
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="text"
            readonly
            value={visibleSecret}
            aria-label="New API token"
            class="{inputClass} font-mono"
            on:focus={(event) => event.currentTarget.select()}
          />
          <div class="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={Copy}
              text="Copy"
              ariaLabel="Copy new API token"
              on:click={() => visibleSecret && copySecret(visibleSecret)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={X}
              text="Dismiss"
              ariaLabel="Dismiss new API token"
              on:click={() => (dismissedSecret = visibleSecret)}
            />
          </div>
        </div>
      </div>
    {/if}

    <form
      method="POST"
      action="?/createApiToken"
      class="space-y-4"
      use:enhance={() => {
        creating = true;
        return async ({ update }) => {
          await update();
          await invalidateAll();
          creating = false;
        };
      }}
    >
      <label class="block space-y-1">
        <span class="text-sm font-medium text-neutral-900 dark:text-neutral-50">Name</span>
        <input
          type="text"
          name="name"
          required
          maxlength={API_TOKEN_NAME_MAX_LENGTH}
          placeholder="e.g. Home Assistant"
          autocomplete="off"
          class={inputClass}
        />
      </label>

      <fieldset class="space-y-2">
        <legend class="text-sm font-medium text-neutral-900 dark:text-neutral-50">Scopes</legend>
        {#each API_TOKEN_SCOPES as scope (scope)}
          <label class="flex items-start gap-3">
            <input
              type="checkbox"
              name="scopes"
              value={scope}
              checked={scope === 'read'}
              class="mt-0.5 h-4 w-4 rounded border-neutral-300 dark:border-neutral-700"
            />
            <span>
              <span class="block text-sm font-medium text-neutral-900 dark:text-neutral-50"
                >{API_TOKEN_SCOPE_INFO[scope].label}</span
              >
              <span class="block text-xs text-neutral-500 dark:text-neutral-400"
                >{API_TOKEN_SCOPE_INFO[scope].description}</span
              >
            </span>
          </label>
        {/each}
      </fieldset>

      <label class="block space-y-1">
        <span class="text-sm font-medium text-neutral-900 dark:text-neutral-50">Expires</span>
        <select name="expiresInDays" class={inputClass}>
          {#each API_TOKEN_EXPIRY_OPTIONS as days (days ?? 'never')}
            <option value={days === null ? 'never' : String(days)}>{days === null ? 'Never' : `${days} days`}</option>
          {/each}
        </select>
      </label>

      <div class="flex justify-end">
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          icon={Plus}
          iconColor="text-accent-500"
          text={creating ? 'Creating...' : 'Create token'}
          disabled={creating}
        />
      </div>
    </form>

    {#if tokens.length > 0}
      <Table {columns} data={tokens} compact responsive>
        <svelte:fragment slot="cell" let:row let:column>
          {#if column.key === 'name'}
            <span class="inline-flex items-center gap-2">
              {row.name}
              {#if row.isLegacy}
                <Badge variant="warning">Legacy</Badge>
              {/if}
            </span>
          {:else if column.key === 'prefix'}
            <span class="font-mono text-xs">{row.prefix}…</span>
          {:else if column.key === 'scopes'}
            <span class="flex flex-wrap gap-1">
              {#each row.scopes as scope (scope)}
                <Badge variant="neutral">{API_TOKEN_SCOPE_INFO[scope].label}</Badge>
              {/each}
            </span>
          {:else if column.key === 'createdAt'}
            <span class="text-xs text-neutral-500 dark:text-neutral-400">{formatDate(row.createdAt)}</span>
          {:else if column.key === 'lastUsedAt'}
            <span class="text-xs text-neutral-500 dark:text-neutral-400">{formatDate(row.lastUsedAt)}</span>
          {:else if column.key === 'expiresAt'}
            <span class="text-xs text-neutral-500 dark:text-neutral-400">{formatDate(row.expiresAt)}</span>
          {:else if column.key === 'status'}
            <Badge variant={statusVariants[row.status]}>{statusLabels[row.status]}</Badge>
          {/if}
        </svelte:fragment>
        <svelte:fragment slot="actions" let:row>
          {#if row.status !== 'revoked'}
            <TableActionButton
              icon={Ban}
              title="Revoke token {row.name}"
              variant="danger"
              size="sm"
              on:click={() => (pendingRevoke = row)}
            />
          {/if}
        </svelte:fragment>
      </Table>
    {:else}
      <p class="text-sm text-neutral-500 dark:text-neutral-400">No API tokens yet</p>
    {/if}
  </div>
</div>

<form
  method="POST"
  action="?/revokeApiToken"
  class="hidden"
  bind:this={revokeForm}
  use:enhance={() => {
    revoking = true;
    return async ({ update }) => {
      await update();
      await invalidateAll();
      revoking = false;
      pendingRevoke = null;
    };
  }}
>
  <input type="hidden" name="id" value={pendingRevoke?.id ?? ''} />
</form>

<Modal
  open={pendingRevoke !== null}
  header="Revoke API token"
  bodyMessage="Revoke '{pendingRevoke?.name ??
    ''}'? Integrations using this token stop working immediately. This cannot be undone."
  confirmText="Revoke"
  confirmDanger
  loading={revoking}
  on:confirm={confirmRevoke}
  on:cancel={() => (pendingRevoke = null)}
/>
