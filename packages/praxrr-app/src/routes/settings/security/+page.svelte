<script lang="ts">
  import type { PageData, ActionData } from './$types';
  import { onMount } from 'svelte';
  import { enhance, applyAction, deserialize } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import {
    LogOut,
    Check,
    Globe,
    Monitor,
    Smartphone,
    Network,
    Clock,
    ShieldCheck,
    Fingerprint,
    Trash2,
    Pencil,
  } from 'lucide-svelte';
  import { parseUTC } from '$shared/utils/dates';
  import Button from '$ui/button/Button.svelte';
  import PageTitle from '$ui/meta/PageTitle.svelte';
  import CollapsibleCard from '$ui/card/CollapsibleCard.svelte';
  import FormInput from '$ui/form/FormInput.svelte';
  import Table from '$ui/table/Table.svelte';
  import TableActionButton from '$ui/table/TableActionButton.svelte';
  import { alertStore } from '$alerts/store';
  import { SETTINGS_SECURITY_SESSIONS } from '$shared/disclosure/sectionKeys';
  import type { Column } from '$ui/table/types';
  import ApiTokensCard from './components/ApiTokensCard.svelte';
  import {
    supportsWebAuthn,
    registerPasskey as doRegisterPasskey,
    WebAuthnError,
    type WebAuthnCredentialSummary,
  } from '$lib/client/utils/webauthn.ts';

  export let data: PageData;
  export let form: ActionData;

  let changingPassword = false;
  let currentPassword = '';
  let newPassword = '';
  let confirmPassword = '';

  let passkeyName = '';
  let registering = false;
  // null until resolved in onMount — avoids rendering a false "unsupported" message during SSR.
  let canUseWebAuthn: boolean | null = null;

  $: if (form?.passwordSuccess) {
    alertStore.add('success', 'Password changed successfully');
    currentPassword = '';
    newPassword = '';
    confirmPassword = '';
  }
  $: if (form?.passwordError) {
    alertStore.add('error', form.passwordError);
  }
  $: if (form?.createdApiToken) {
    alertStore.add('success', `API token '${form.createdApiToken.token.name}' created`);
  }
  $: if (form?.apiTokenRevoked) {
    alertStore.add('success', 'API token revoked');
  }
  $: if (form?.apiTokenError) {
    alertStore.add('error', form.apiTokenError);
  }
  $: if (form?.sessionRevoked) {
    alertStore.add('success', 'Session revoked');
  }
  $: if (form?.sessionsRevoked !== undefined) {
    alertStore.add('success', `Revoked ${form.sessionsRevoked} session(s)`);
  }
  $: if (form?.sessionError) {
    alertStore.add('error', form.sessionError);
  }
  $: if (form?.passkeyDeleted) {
    alertStore.add('success', 'Passkey removed');
  }
  $: if (form?.passkeyRenamed) {
    alertStore.add('success', 'Passkey renamed');
  }
  $: if (form?.passkeyError) {
    alertStore.add('error', form.passkeyError);
  }

  function formatDate(dateStr: string): string {
    const date = parseUTC(dateStr);
    return date ? date.toLocaleString() : '';
  }

  interface SessionRow {
    public_id: string;
    created_at: string;
    expires_at: string;
    last_active_at: string | null;
    ip_address: string | null;
    browser: string | null;
    os: string | null;
    device_type: string | null;
    isCurrent: boolean;
  }

  function formatRelativeTime(dateStr: string | null): string {
    if (!dateStr) return 'Never';
    const date = parseUTC(dateStr);
    if (!date) return 'Unknown';

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  const sessionColumns: Column<SessionRow>[] = [
    {
      key: 'browser',
      header: 'Browser',
      headerIcon: Globe,
      cell: (row) => row.browser ?? 'Unknown',
    },
    {
      key: 'os',
      header: 'OS',
      headerIcon: Monitor,
      cell: (row) => row.os ?? 'Unknown',
    },
    {
      key: 'device_type',
      header: 'Device',
      headerIcon: Smartphone,
      cell: (row) => row.device_type ?? 'Unknown',
    },
    {
      key: 'ip_address',
      header: 'IP',
      headerIcon: Network,
      cell: (row) => row.ip_address ?? 'Unknown',
    },
    {
      key: 'last_active_at',
      header: 'Last Active',
      headerIcon: Clock,
      cell: (row) => formatRelativeTime(row.last_active_at),
    },
  ];

  onMount(() => {
    canUseWebAuthn = supportsWebAuthn();
  });

  async function registerPasskey() {
    if (registering) {
      return;
    }

    registering = true;
    try {
      const result = await doRegisterPasskey(passkeyName.trim() || undefined);
      if (result.verified) {
        alertStore.add('success', 'Passkey registered');
        passkeyName = '';
        await invalidateAll();
      }
    } catch (e) {
      alertStore.add(
        'error',
        e instanceof WebAuthnError ? e.message : e instanceof Error ? e.message : 'Passkey registration failed'
      );
    } finally {
      registering = false;
    }
  }

  async function renamePasskey(row: WebAuthnCredentialSummary) {
    const next = window.prompt('Rename passkey', row.name);
    if (next === null) {
      return;
    }

    const name = next.trim();
    if (!name) {
      alertStore.add('error', 'Passkey name is required');
      return;
    }

    const body = new FormData();
    body.set('credentialId', row.id);
    body.set('name', name);

    const response = await fetch('?/renamePasskey', {
      method: 'POST',
      headers: { 'x-sveltekit-action': 'true' },
      body,
    });
    const result = deserialize(await response.text());
    await applyAction(result);
    if (result.type === 'success') {
      await invalidateAll();
    }
  }

  const passkeyColumns: Column<WebAuthnCredentialSummary>[] = [
    {
      key: 'name',
      header: 'Name',
      headerIcon: Fingerprint,
      cell: (row) => row.name,
    },
    {
      key: 'createdAt',
      header: 'Created',
      headerIcon: Clock,
      cell: (row) => ({
        html: `<span class="text-xs text-neutral-500 dark:text-neutral-400">${formatDate(row.createdAt)}</span>`,
      }),
    },
    {
      key: 'lastUsedAt',
      header: 'Last Used',
      headerIcon: Clock,
      cell: (row) => ({
        html: `<span class="text-xs text-neutral-500 dark:text-neutral-400">${row.lastUsedAt ? formatDate(row.lastUsedAt) : '—'}</span>`,
      }),
    },
    {
      key: 'deviceType',
      header: 'Device',
      headerIcon: Smartphone,
      cell: (row) => (row.deviceType === 'multiDevice' ? 'Multi-device' : 'Single-device'),
    },
    {
      key: 'backedUp',
      header: 'Backed Up',
      headerIcon: ShieldCheck,
      cell: (row) =>
        row.backedUp
          ? {
              html: '<span class="inline-flex items-center rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">Backed up</span>',
            }
          : {
              html: '<span class="inline-flex items-center rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">Local only</span>',
            },
    },
  ];
</script>

<PageTitle parts={['Security', 'Settings']} />

<div class="p-4 md:p-8">
  <div class="mb-8">
    <h1 class="text-2xl font-bold text-neutral-900 md:text-3xl dark:text-neutral-50">Security</h1>
    <p class="mt-2 text-base text-neutral-600 md:mt-3 md:text-lg dark:text-neutral-400">
      Manage your password, API tokens, and active sessions
    </p>
    <a
      href="/security-posture"
      class="text-accent-600 dark:text-accent-500 mt-3 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
    >
      <ShieldCheck size={16} />
      View security posture — audit auth, transport, and credential exposure →
    </a>
  </div>

  <div class="space-y-8">
    <!-- Change Password -->
    {#if data.passwordEnabled}
      <div class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div class="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
          <h2 class="text-lg font-semibold text-neutral-900 md:text-xl dark:text-neutral-50">Change Password</h2>
          <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">Update your account password</p>
        </div>
        <div class="p-6">
          <form
            method="POST"
            action="?/changePassword"
            class="space-y-4"
            use:enhance={() => {
              changingPassword = true;
              return async ({ update }) => {
                await update({ reset: false });
                changingPassword = false;
              };
            }}
          >
            <FormInput
              name="currentPassword"
              label="Current Password"
              type="password"
              placeholder="Enter current password"
              autocomplete="current-password"
              private_
              bind:value={currentPassword}
            />
            <FormInput
              name="newPassword"
              label="New Password"
              type="password"
              placeholder="Minimum 8 characters"
              autocomplete="new-password"
              private_
              bind:value={newPassword}
            />
            <FormInput
              name="confirmPassword"
              label="Confirm New Password"
              type="password"
              placeholder="Re-enter new password"
              autocomplete="new-password"
              private_
              bind:value={confirmPassword}
            />
            <div class="flex justify-end">
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                icon={Check}
                iconColor="text-accent-500"
                text={changingPassword ? 'Saving...' : 'Change Password'}
                disabled={changingPassword}
              />
            </div>
          </form>
        </div>
      </div>
    {/if}

    <ApiTokensCard
      tokens={data.apiTokens}
      hasLegacyToken={data.hasLegacyApiToken}
      created={form?.createdApiToken ?? null}
    />

    {#if data.passkeysEnabled}
      <!-- Passkeys -->
      <div class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div class="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
          <h2 class="text-lg font-semibold text-neutral-900 md:text-xl dark:text-neutral-50">Passkeys</h2>
          <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Sign in without a password using a passkey on this device or a hardware security key
          </p>
        </div>
        <div class="p-6">
          <div class="space-y-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div class="flex-1">
                <FormInput
                  name="passkeyName"
                  label="Name (optional)"
                  placeholder="e.g. MacBook Touch ID"
                  bind:value={passkeyName}
                />
              </div>
              <Button
                type="button"
                variant="primary"
                icon={Fingerprint}
                text={registering ? 'Registering...' : 'Register a passkey'}
                disabled={!canUseWebAuthn || registering}
                on:click={registerPasskey}
              />
            </div>
            {#if canUseWebAuthn === false}
              <p class="text-sm text-neutral-500 dark:text-neutral-400">This browser doesn't support passkeys.</p>
            {/if}
            {#if data.passkeys.length > 0}
              <Table columns={passkeyColumns} data={data.passkeys} compact responsive>
                <svelte:fragment slot="actions" let:row>
                  <div class="flex items-center justify-end gap-2">
                    <TableActionButton
                      icon={Pencil}
                      title="Rename passkey"
                      variant="neutral"
                      size="sm"
                      on:click={() => renamePasskey(row)}
                    />
                    <form
                      method="POST"
                      action="?/deletePasskey"
                      use:enhance={() => {
                        return async ({ update }) => {
                          await update();
                          await invalidateAll();
                        };
                      }}
                    >
                      <input type="hidden" name="credentialId" value={row.id} />
                      <TableActionButton
                        icon={Trash2}
                        title="Delete passkey"
                        variant="danger"
                        size="sm"
                        type="submit"
                      />
                    </form>
                  </div>
                </svelte:fragment>
              </Table>
            {:else}
              <p class="text-sm text-neutral-500 dark:text-neutral-400">No passkeys registered yet</p>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    <!-- Active Sessions -->
    <CollapsibleCard
      title="Active Sessions"
      description="Manage your logged-in sessions across devices"
      sectionKey={SETTINGS_SECURITY_SESSIONS}
    >
      {#if !data.canManageSessions}
        <p class="text-sm text-neutral-500 dark:text-neutral-400">
          Session management is not available for this sign-in method.
        </p>
        <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Sign in with a user account to review and revoke sessions.
        </p>
      {:else}
        {#if data.sessions.length > 1}
          <div class="mb-4 flex justify-end">
            <form
              method="POST"
              action="?/revokeOtherSessions"
              use:enhance={() => {
                return async ({ update }) => {
                  await update();
                  await invalidateAll();
                };
              }}
            >
              <Button
                type="submit"
                variant="secondary"
                size="xs"
                icon={LogOut}
                iconColor="text-red-500"
                text="Revoke Others"
              />
            </form>
          </div>
        {/if}
        {#if data.sessions.length > 0}
          <Table columns={sessionColumns} data={data.sessions} compact responsive actionsHeader="Status">
            <svelte:fragment slot="actions" let:row>
              {#if row.isCurrent}
                <span
                  class="inline-flex items-center rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
                  >Current</span
                >
              {:else}
                <form
                  method="POST"
                  action="?/revokeSession"
                  use:enhance={() => {
                    return async ({ update }) => {
                      await update();
                      await invalidateAll();
                    };
                  }}
                >
                  <input type="hidden" name="public_id" value={row.public_id} />
                  <TableActionButton icon={LogOut} title="Revoke session" variant="danger" size="sm" type="submit" />
                </form>
              {/if}
            </svelte:fragment>
          </Table>
        {:else}
          <p class="text-sm text-neutral-500 dark:text-neutral-400">No active sessions</p>
        {/if}
      {/if}
    </CollapsibleCard>
  </div>
</div>
