<script lang="ts">
  import type { PageData, ActionData } from './$types';
  import { onMount } from 'svelte';
  import { enhance, applyAction, deserialize } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { RefreshCw, LogOut, Check, Globe, Monitor, Smartphone, Network, Clock, ShieldCheck, Fingerprint, Trash2, Pencil } from 'lucide-svelte';
  import { parseUTC } from '$shared/utils/dates';
  import Button from '$ui/button/Button.svelte';
  import CollapsibleCard from '$ui/card/CollapsibleCard.svelte';
  import FormInput from '$ui/form/FormInput.svelte';
  import MaskedApiKey from '$ui/form/MaskedApiKey.svelte';
  import Table from '$ui/table/Table.svelte';
  import TableActionButton from '$ui/table/TableActionButton.svelte';
  import { alertStore } from '$alerts/store';
  import { SETTINGS_SECURITY_SESSIONS } from '$shared/disclosure/sectionKeys';
  import type { Column } from '$ui/table/types';
  import { supportsWebAuthn, registerPasskey as doRegisterPasskey, WebAuthnError, type WebAuthnCredentialSummary } from '$lib/client/utils/webauthn.ts';

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

  let regeneratingKey = false;
  let revealInProgress = false;
  let activeAuthApiKey = '';
  let activeAuthApiKeySource: 'regenerate' | 'reveal' | null = null;
  let remaskSession = 0;
  let isAuthApiKeyUnmasked = false;
  let copyAfterReveal = false;
  let revealSubmitButton: HTMLButtonElement | null = null;
  let autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  let revealRequestToken = 0;
  let pendingRevealRequestToken = 0;
  const authApiKeyRevealMs = 30_000;
  $: hasStoredAuthKey = data.hasApiKey || Boolean(data.apiKeyMasked);

  // Handle form responses
  $: if (form?.apiKey) {
    setActiveAuthApiKey(form.apiKey, 'regenerate');
  }
  $: if (form?.passwordSuccess) {
    alertStore.add('success', 'Password changed successfully');
    currentPassword = '';
    newPassword = '';
    confirmPassword = '';
  }
  $: if (form?.passwordError) {
    alertStore.add('error', form.passwordError);
  }
  $: if (form?.apiKeyRegenerated) {
    alertStore.add('success', 'API key regenerated');
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

  function clearAuthApiKeyAutoHide() {
    if (autoHideTimer) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
  }

  function resetRevealSession() {
    revealRequestToken += 1;
    revealInProgress = false;
  }

  function setActiveAuthApiKey(value: string, source: 'regenerate' | 'reveal') {
    if (source === 'regenerate') {
      resetRevealSession();
    }

    activeAuthApiKey = value;
    activeAuthApiKeySource = value ? source : null;
    isAuthApiKeyUnmasked = Boolean(value);
    clearAuthApiKeyAutoHide();

    if (isAuthApiKeyUnmasked) {
      autoHideTimer = setTimeout(() => {
        isAuthApiKeyUnmasked = false;
        remaskSession += 1;
      }, authApiKeyRevealMs);
    }

    remaskSession += 1;
  }

  function clearActiveAuthApiKey(preserveRegenerated = false) {
    resetRevealSession();
    clearAuthApiKeyAutoHide();
    isAuthApiKeyUnmasked = false;

    if (!preserveRegenerated || activeAuthApiKeySource !== 'regenerate') {
      activeAuthApiKey = '';
      activeAuthApiKeySource = null;
    }

    remaskSession += 1;
  }

  $: maskedApiKeyValue = isAuthApiKeyUnmasked && activeAuthApiKey ? activeAuthApiKey : data.apiKeyMasked;
  $: plainApiKeyValue = isAuthApiKeyUnmasked ? activeAuthApiKey : '';

  async function copyActiveAuthApiKey() {
    if (!activeAuthApiKey) {
      return;
    }

    try {
      await navigator.clipboard.writeText(activeAuthApiKey);
      alertStore.add('success', 'API key copied to clipboard');
    } catch {
      alertStore.add('error', 'Could not copy API key');
    }
  }

  function requestRevealCopy(showError = false) {
    if (!hasStoredAuthKey || !revealSubmitButton) {
      if (showError) {
        alertStore.add('error', 'Unable to retrieve API key');
      }
      return;
    }

    pendingRevealRequestToken = ++revealRequestToken;
    revealInProgress = true;
    revealSubmitButton.click();
  }

  function handleRevealChange(event: CustomEvent<{ revealed: boolean; reason: 'manual' | 'timeout' }>) {
    if (!event.detail.revealed) {
      clearActiveAuthApiKey();
      return;
    }

    requestRevealCopy();
  }

  function handleCopyFeedback(event: CustomEvent<{ success: boolean; message: string; error?: Error }>) {
    if (event.detail.success) {
      alertStore.add('success', 'API key copied to clipboard');
      return;
    }

    if (event.detail.error?.message === 'Missing key value') {
      copyAfterReveal = true;
      requestRevealCopy();
      return;
    }

    alertStore.add('error', 'Copy failed');
  }

  function formatDate(dateStr: string): string {
    const date = parseUTC(dateStr);
    return date ? date.toLocaleString() : '';
  }

  interface SessionRow {
    id: string;
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
      cell: (row) => ({
        html: `<span class="font-mono text-xs text-neutral-500 dark:text-neutral-400">${row.ip_address ?? 'Unknown'}</span>`,
      }),
    },
    {
      key: 'last_active_at',
      header: 'Last Active',
      headerIcon: Clock,
      cell: (row) => ({
        html: `<span class="text-xs text-neutral-500 dark:text-neutral-400">${formatRelativeTime(row.last_active_at)}</span>`,
      }),
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

<div class="p-4 md:p-8">
  <div class="mb-8">
    <h1 class="text-2xl font-bold text-neutral-900 md:text-3xl dark:text-neutral-50">Security</h1>
    <p class="mt-2 text-base text-neutral-600 md:mt-3 md:text-lg dark:text-neutral-400">
      Manage your password, API key, and active sessions
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

    <!-- API Key -->
    <div class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div class="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
        <h2 class="text-lg font-semibold text-neutral-900 md:text-xl dark:text-neutral-50">API Key</h2>
        <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Authenticate API requests via <code class="rounded bg-neutral-100 px-1 py-0.5 text-xs dark:bg-neutral-800"
            >X-Api-Key</code
          > header
        </p>
      </div>
      <div class="p-6">
        {#if hasStoredAuthKey}
          <div class="space-y-4">
            {#key remaskSession}
              <MaskedApiKey
                label="Auth API key"
                maskedValue={maskedApiKeyValue}
                value={plainApiKeyValue}
                hasValue={data.hasApiKey}
                revealLabel="Show"
                hideLabel="Hide"
                copyLabel="Copy"
                disabled={revealInProgress}
                on:revealChange={handleRevealChange}
                on:copyFeedback={handleCopyFeedback}
              />
            {/key}

            <form
              method="POST"
              action="?/revealAuthKey"
              use:enhance={() => {
                const requestToken = pendingRevealRequestToken;
                return async ({ result, update }) => {
                  if (requestToken !== revealRequestToken) {
                    return;
                  }

                  revealInProgress = false;
                  if (result.type === 'success') {
                    const response = result.data as { revealedAuthKey?: string };
                    if (response?.revealedAuthKey) {
                      setActiveAuthApiKey(response.revealedAuthKey, 'reveal');
                      if (copyAfterReveal) {
                        await copyActiveAuthApiKey();
                        copyAfterReveal = false;
                      }
                    } else {
                      alertStore.add('error', 'Unable to retrieve API key');
                      clearActiveAuthApiKey(activeAuthApiKeySource === 'regenerate');
                    }
                  } else {
                    alertStore.add('error', 'Unable to retrieve API key');
                    clearActiveAuthApiKey(activeAuthApiKeySource === 'regenerate');
                  }

                  copyAfterReveal = false;

                  await update();
                };
              }}
            >
              <button type="submit" class="hidden" aria-label="Reveal API key" bind:this={revealSubmitButton}></button>
            </form>

            <form
              method="POST"
              action="?/regenerateApiKey"
              use:enhance={() => {
                regeneratingKey = true;
                return async ({ update }) => {
                  await update();
                  regeneratingKey = false;
                };
              }}
            >
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                icon={RefreshCw}
                iconColor="text-accent-500"
                text={regeneratingKey ? 'Regenerating...' : 'Regenerate Key'}
                disabled={regeneratingKey}
              />
            </form>
          </div>
        {:else}
          <div class="flex items-center gap-4">
            <p class="text-sm text-neutral-500 dark:text-neutral-400">No API key configured</p>
            <form
              method="POST"
              action="?/regenerateApiKey"
              use:enhance={() => {
                regeneratingKey = true;
                return async ({ update }) => {
                  await update();
                  regeneratingKey = false;
                };
              }}
            >
              <Button type="submit" variant="secondary" size="sm" text="Generate Key" />
            </form>
          </div>
        {/if}
      </div>
    </div>

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
                      <TableActionButton icon={Trash2} title="Delete passkey" variant="danger" size="sm" type="submit" />
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
                <input type="hidden" name="sessionId" value={row.id} />
                <TableActionButton icon={LogOut} title="Revoke session" variant="danger" size="sm" type="submit" />
              </form>
            {/if}
          </svelte:fragment>
        </Table>
      {:else}
        <p class="text-sm text-neutral-500 dark:text-neutral-400">No active sessions</p>
      {/if}
    </CollapsibleCard>
  </div>
</div>
