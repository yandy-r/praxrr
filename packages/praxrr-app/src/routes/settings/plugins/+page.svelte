<script lang="ts">
  import { onMount } from 'svelte';
  import { Check, RefreshCw, RotateCw } from 'lucide-svelte';
  import { alertStore } from '$alerts/store';
  import Button from '$ui/button/Button.svelte';
  import IconCheckbox from '$ui/form/IconCheckbox.svelte';
  import PluginCard from './components/PluginCard.svelte';
  import {
    isPluginListResponse,
    isPluginMutationResponse,
    isPluginReloadResponse,
    isPluginSettingsResponse,
  } from './contract.ts';
  import {
    pluginIdentityKey,
    pluginMutationUrl,
    sortPluginsForPresentation,
    type PluginErrorResponse,
    type PluginRecord,
  } from './presentation.ts';

  type LoadErrorKind = 'unauthorized' | 'request';

  interface ReloadSummary {
    discovered: number;
    registered: number;
    rejected: number;
    missing: number;
  }

  interface LoadOptions {
    preserveOnFailure?: boolean;
    announceFailure?: boolean;
  }

  let items: PluginRecord[] = [];
  let pluginsEnabled: boolean | null = null;
  let loading = true;
  let settingsPending = false;
  let loadError: string | null = null;
  let loadErrorKind: LoadErrorKind | null = null;
  let staleReason: string | null = null;
  let statusMessage = 'Loading plugin registry…';
  let reloadSummary: ReloadSummary | null = null;
  let reloadError: string | null = null;
  let reloadPending = false;
  let listRequestId = 0;
  let pendingIdentities = new Set<string>();
  let rowErrors: Record<string, string> = {};

  function unauthorizedMessage(): string {
    return 'Your session is no longer authorized. Sign in again, then retry.';
  }

  async function responseError(response: Response, fallback: string): Promise<string> {
    if (response.status === 401) return unauthorizedMessage();

    const body = (await response.json().catch(() => null)) as PluginErrorResponse | null;
    return body && typeof body.error === 'string' && body.error.length > 0 ? body.error : fallback;
  }

  function invalidateListRequest(): void {
    listRequestId += 1;
    loading = false;
  }

  function setRowError(key: string, message: string | null): void {
    const next = { ...rowErrors };
    if (message) next[key] = message;
    else delete next[key];
    rowErrors = next;
  }

  async function loadPlugins(options: LoadOptions = {}): Promise<boolean> {
    const requestId = ++listRequestId;
    const preserveOnFailure = options.preserveOnFailure ?? pluginsEnabled !== null;
    loading = true;
    loadError = null;
    loadErrorKind = null;
    statusMessage = preserveOnFailure ? 'Refreshing plugin registry…' : 'Loading plugin registry…';

    try {
      const response = await fetch('/api/v1/plugins');
      if (requestId !== listRequestId) return false;

      if (!response.ok) {
        const message = await responseError(response, `Unable to load the plugin registry (HTTP ${response.status}).`);
        if (requestId !== listRequestId) return false;
        applyLoadFailure(message, response.status === 401 ? 'unauthorized' : 'request', preserveOnFailure);
        if (options.announceFailure) alertStore.add('error', message);
        return false;
      }

      const payload = (await response.json().catch(() => null)) as unknown;
      if (requestId !== listRequestId) return false;
      if (!isPluginListResponse(payload)) {
        const message = 'The plugin registry returned an unexpected response. Retry the request.';
        applyLoadFailure(message, 'request', preserveOnFailure);
        if (options.announceFailure) alertStore.add('error', message);
        return false;
      }

      pluginsEnabled = payload.pluginsEnabled;
      items = payload.pluginsEnabled ? sortPluginsForPresentation(payload.items) : [];
      loadError = null;
      loadErrorKind = null;
      staleReason = null;
      rowErrors = {};
      statusMessage = payload.pluginsEnabled
        ? `Plugin registry loaded. ${payload.items.length} ${payload.items.length === 1 ? 'record' : 'records'} available.`
        : 'Plugin ecosystem is off. Enable it below to scan and manage plugins.';
      return true;
    } catch {
      if (requestId !== listRequestId) return false;
      const message = 'Unable to load the plugin registry. Check the connection and retry.';
      applyLoadFailure(message, 'request', preserveOnFailure);
      if (options.announceFailure) alertStore.add('error', message);
      return false;
    } finally {
      if (requestId === listRequestId) loading = false;
    }
  }

  function applyLoadFailure(message: string, kind: LoadErrorKind, preserve: boolean): void {
    if (preserve && pluginsEnabled !== null) {
      staleReason = message;
      statusMessage = `Plugin registry refresh failed. Showing the last confirmed view. ${message}`;
      return;
    }

    loadError = message;
    loadErrorKind = kind;
    statusMessage = message;
  }

  async function refreshPlugins(): Promise<void> {
    if (loading || reloadPending || settingsPending || pendingIdentities.size > 0) return;
    await loadPlugins({ preserveOnFailure: pluginsEnabled !== null, announceFailure: true });
  }

  async function setEcosystemEnabled(enabled: boolean): Promise<void> {
    if (loading || reloadPending || settingsPending || pendingIdentities.size > 0 || pluginsEnabled === enabled) {
      return;
    }

    settingsPending = true;
    statusMessage = enabled ? 'Enabling the plugin ecosystem…' : 'Disabling the plugin ecosystem…';

    try {
      const response = await fetch('/api/v1/plugins/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginsEnabled: enabled }),
      });

      if (!response.ok) {
        const message = await responseError(
          response,
          `Unable to ${enabled ? 'enable' : 'disable'} plugins (HTTP ${response.status}).`
        );
        alertStore.add('error', message);
        statusMessage = message;
        return;
      }

      const payload = (await response.json().catch(() => null)) as unknown;
      if (!isPluginSettingsResponse(payload)) {
        const message = 'Plugin settings returned an unexpected response. Retry the request.';
        alertStore.add('error', message);
        statusMessage = message;
        return;
      }

      pluginsEnabled = payload.pluginsEnabled;
      if (!payload.pluginsEnabled) {
        items = [];
        reloadSummary = null;
        reloadError = null;
        rowErrors = {};
        staleReason = null;
        statusMessage = 'Plugin ecosystem disabled. Registry management is paused until re-enabled.';
        alertStore.add('success', 'Plugin ecosystem disabled.');
        return;
      }

      alertStore.add('success', 'Plugin ecosystem enabled.');
      await loadPlugins({ preserveOnFailure: false, announceFailure: true });
    } catch {
      const message = 'Unable to update plugin settings. Check the connection and retry.';
      alertStore.add('error', message);
      statusMessage = message;
    } finally {
      settingsPending = false;
    }
  }

  function replacePlugin(next: PluginRecord): boolean {
    const identity = pluginIdentityKey(next);
    let replaced = false;
    const updated = items.map((item) => {
      if (pluginIdentityKey(item) !== identity) return item;
      replaced = true;
      return next;
    });

    if (replaced) items = sortPluginsForPresentation(updated);
    return replaced;
  }

  async function setPluginEnabled(plugin: PluginRecord, enabled: boolean): Promise<void> {
    const identity = pluginIdentityKey(plugin);
    if (
      loading ||
      reloadPending ||
      settingsPending ||
      pendingIdentities.size > 0 ||
      pendingIdentities.has(identity) ||
      pluginsEnabled !== true
    ) {
      return;
    }

    invalidateListRequest();
    pendingIdentities = new Set([...pendingIdentities, identity]);
    setRowError(identity, null);
    statusMessage = `Saving enablement intent for ${plugin.manifest.name}…`;

    try {
      const response = await fetch(pluginMutationUrl(plugin, enabled ? 'enable' : 'disable'), { method: 'POST' });

      if (!response.ok) {
        if (response.status === 404 || response.status === 409) {
          const changedMessage =
            response.status === 404
              ? 'This plugin record changed or was removed. Refreshing the registry.'
              : 'Plugin management was disabled while the change was pending. Refreshing enablement state.';
          setRowError(identity, changedMessage);
          alertStore.add('warning', changedMessage);
          const refreshed = await loadPlugins({ preserveOnFailure: true });
          if (!refreshed && pluginsEnabled === true)
            setRowError(identity, `${changedMessage} Refresh failed; retry below.`);
          return;
        }

        const message = await responseError(
          response,
          `Unable to ${enabled ? 'enable' : 'disable'} this plugin (HTTP ${response.status}).`
        );
        setRowError(identity, message);
        statusMessage = message;
        alertStore.add('error', message);
        return;
      }

      const payload = (await response.json().catch(() => null)) as unknown;
      if (!isPluginMutationResponse(payload) || pluginIdentityKey(payload.plugin) !== identity) {
        const message = 'The plugin update returned an unexpected response. Refresh the registry before retrying.';
        setRowError(identity, message);
        statusMessage = message;
        alertStore.add('error', message);
        return;
      }

      if (!replacePlugin(payload.plugin)) {
        const message = 'The updated plugin no longer matches this registry view. Refresh the registry.';
        setRowError(identity, message);
        statusMessage = message;
        alertStore.add('warning', message);
        return;
      }

      const message = `Saved ${payload.plugin.enabled ? 'enabled' : 'disabled'} intent for ${payload.plugin.manifest.name}.`;
      setRowError(identity, null);
      statusMessage = message;
      alertStore.add('success', message);
    } catch {
      const message = 'Unable to save plugin intent. Check the connection and retry the action.';
      setRowError(identity, message);
      statusMessage = message;
      alertStore.add('error', message);
    } finally {
      const nextPending = new Set(pendingIdentities);
      nextPending.delete(identity);
      pendingIdentities = nextPending;
    }
  }

  function reloadStatus(summary: ReloadSummary): string {
    return `Reload committed: ${summary.discovered} discovered, ${summary.registered} registered, ${summary.rejected} rejected, ${summary.missing} missing.`;
  }

  async function reloadPlugins(): Promise<void> {
    if (loading || reloadPending || settingsPending || pendingIdentities.size > 0 || pluginsEnabled !== true) return;

    invalidateListRequest();
    reloadPending = true;
    reloadSummary = null;
    reloadError = null;
    statusMessage = 'Reloading plugin registry…';

    try {
      const response = await fetch('/api/v1/plugins/reload', { method: 'POST' });
      if (!response.ok) {
        const message = await responseError(response, `Unable to reload plugins (HTTP ${response.status}).`);
        reloadError = message;
        statusMessage = message;
        alertStore.add('error', message);
        return;
      }

      const payload = (await response.json().catch(() => null)) as unknown;
      if (!isPluginReloadResponse(payload)) {
        const message = 'Plugin reload returned an unexpected response. The prior registry view is unchanged.';
        reloadError = message;
        statusMessage = message;
        alertStore.add('error', message);
        return;
      }

      const featureOffCountsAreZero =
        payload.discovered === 0 && payload.registered === 0 && payload.rejected === 0 && payload.missing === 0;
      if (!payload.pluginsEnabled && !payload.reloaded && featureOffCountsAreZero) {
        pluginsEnabled = false;
        items = [];
        rowErrors = {};
        reloadSummary = null;
        reloadError = null;
        staleReason = null;
        loadError = null;
        loadErrorKind = null;
        statusMessage = 'Plugin ecosystem is off. Enable it below to scan and manage plugins.';
        alertStore.add('info', statusMessage);
        return;
      }

      if (!payload.pluginsEnabled || !payload.reloaded) {
        const message =
          'Plugin reload did not return a committed reconciliation. The prior registry view is unchanged.';
        reloadError = message;
        statusMessage = message;
        alertStore.add('error', message);
        return;
      }

      reloadSummary = {
        discovered: payload.discovered,
        registered: payload.registered,
        rejected: payload.rejected,
        missing: payload.missing,
      };
      const committedMessage = reloadStatus(reloadSummary);
      statusMessage =
        payload.rejected > 0
          ? `${committedMessage} Review server logs for redacted validation diagnostics.`
          : committedMessage;
      alertStore.add(payload.rejected > 0 ? 'warning' : 'success', statusMessage);

      const refreshed = await loadPlugins({ preserveOnFailure: true });
      if (!refreshed) {
        const reason = staleReason ?? loadError ?? 'The authoritative registry refresh failed.';
        staleReason = `Reload committed, but the refreshed registry could not be loaded. ${reason}`;
        statusMessage = staleReason;
        alertStore.add('warning', staleReason);
      } else {
        statusMessage =
          payload.rejected > 0
            ? `${committedMessage} ${payload.rejected} rejected ${payload.rejected === 1 ? 'entry was' : 'entries were'} omitted; review server logs for redacted validation diagnostics.`
            : `${committedMessage} The registry view is current.`;
      }
    } catch {
      const message = 'Unable to reload plugins. Check the connection and retry the action.';
      reloadError = message;
      statusMessage = message;
      alertStore.add('error', message);
    } finally {
      reloadPending = false;
    }
  }

  onMount(() => {
    void loadPlugins({ preserveOnFailure: false, announceFailure: true });
  });
</script>

<svelte:head>
  <title>Plugin Management - Praxrr</title>
</svelte:head>

<div class="space-y-6 [&_button]:min-h-11">
  <header class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
    <div class="max-w-3xl">
      <h1 class="text-2xl font-bold text-neutral-900 md:text-3xl dark:text-neutral-50">Plugin Management</h1>
      <p class="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-400">
        Inspect validated plugin metadata, saved enablement intent, lifecycle evidence, declared points, and grants.
        Execution telemetry is unavailable in this build.
      </p>
    </div>

    {#if pluginsEnabled === true}
      <div class="flex shrink-0 flex-col items-stretch gap-3 sm:items-end">
        <div class="flex items-center gap-3 rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-700">
          <IconCheckbox
            icon={Check}
            checked={true}
            disabled={settingsPending || loading || reloadPending || pendingIdentities.size > 0}
            title="Disable plugins"
            on:click={() => setEcosystemEnabled(false)}
          />
          <div class="min-w-0">
            <p class="text-sm font-medium text-neutral-900 dark:text-neutral-100">Plugins enabled</p>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">Turn off to pause scan and management</p>
          </div>
        </div>
        <div class="flex shrink-0 flex-wrap gap-2">
          <Button
            text="Refresh registry"
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            disabled={loading || reloadPending || settingsPending || pendingIdentities.size > 0}
            aria-busy={loading}
            onclick={refreshPlugins}
          />
          <Button
            text="Reload plugins"
            variant="primary"
            size="sm"
            icon={RotateCw}
            disabled={loading || reloadPending || settingsPending || pendingIdentities.size > 0}
            aria-busy={reloadPending}
            onclick={reloadPlugins}
          />
        </div>
      </div>
    {/if}
  </header>

  <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{statusMessage}</p>

  {#if reloadSummary}
    <section
      class="rounded-xl border p-4 {reloadSummary.rejected > 0
        ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100'
        : 'border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100'}"
      aria-labelledby="plugin-reload-summary"
    >
      <h2 id="plugin-reload-summary" class="font-semibold">Latest reload summary</h2>
      <dl class="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt class="opacity-70">Discovered</dt>
          <dd class="text-lg font-semibold">{reloadSummary.discovered}</dd>
        </div>
        <div>
          <dt class="opacity-70">Registered</dt>
          <dd class="text-lg font-semibold">{reloadSummary.registered}</dd>
        </div>
        <div>
          <dt class="opacity-70">Rejected</dt>
          <dd class="text-lg font-semibold">{reloadSummary.rejected}</dd>
        </div>
        <div>
          <dt class="opacity-70">Missing</dt>
          <dd class="text-lg font-semibold">{reloadSummary.missing}</dd>
        </div>
      </dl>
      {#if reloadSummary.rejected > 0}
        <p class="mt-3 text-sm">
          Rejected entries are reported only as an aggregate. Review server logs for redacted validation diagnostics.
        </p>
      {/if}
    </section>
  {/if}

  {#if reloadError && pluginsEnabled === true}
    <section
      class="flex flex-col gap-3 rounded-xl border border-red-300 bg-red-50 p-4 text-red-950 sm:flex-row sm:items-center sm:justify-between dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100"
      aria-labelledby="plugin-reload-error"
    >
      <div>
        <h2 id="plugin-reload-error" class="font-semibold">Plugin reload failed</h2>
        <p class="mt-1 text-sm break-words">{reloadError}</p>
      </div>
      <Button
        text="Retry reload"
        variant="secondary"
        size="sm"
        disabled={loading || reloadPending || settingsPending || pendingIdentities.size > 0}
        onclick={reloadPlugins}
      />
    </section>
  {/if}

  {#if staleReason}
    <section
      class="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
      aria-labelledby="plugin-stale-title"
    >
      <div>
        <h2 id="plugin-stale-title" class="font-semibold">Showing the last confirmed registry view</h2>
        <p class="mt-1 text-sm break-words">{staleReason}</p>
      </div>
      <Button
        text="Retry refresh"
        variant="secondary"
        size="sm"
        disabled={loading || reloadPending || settingsPending || pendingIdentities.size > 0}
        onclick={refreshPlugins}
      />
    </section>
  {/if}

  {#if loading && pluginsEnabled === null && !loadError}
    <section
      class="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center dark:border-neutral-700 dark:bg-neutral-900"
      aria-busy="true"
    >
      <RefreshCw class="mx-auto animate-spin text-neutral-400" size={24} aria-hidden="true" />
      <h2 class="mt-3 font-semibold text-neutral-900 dark:text-neutral-100">Loading plugin registry</h2>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">Reading the redacted management inventory.</p>
    </section>
  {:else if loadError && pluginsEnabled === null}
    <section
      class="rounded-xl border border-red-300 bg-red-50 p-5 text-red-950 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100"
      aria-labelledby="plugin-load-error"
    >
      <h2 id="plugin-load-error" class="font-semibold">
        {loadErrorKind === 'unauthorized' ? 'Authentication required' : 'Plugin registry unavailable'}
      </h2>
      <p class="mt-2 text-sm break-words">{loadError}</p>
      <div class="mt-4">
        <Button text="Retry load" variant="secondary" size="sm" disabled={loading} onclick={refreshPlugins} />
      </div>
    </section>
  {:else if pluginsEnabled === false}
    <section
      class="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900"
      aria-labelledby="plugin-disabled-title"
    >
      <h2 id="plugin-disabled-title" class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
        Plugin ecosystem is off
      </h2>
      <p class="mt-2 max-w-3xl text-sm leading-6 text-neutral-600 dark:text-neutral-400">
        Enable plugins to scan
        <code class="font-mono">PLUGINS_DIR</code>, register validated manifests, and manage each plugin's saved
        enablement intent. Observe dispatch stays inactive until the ecosystem is on. Per-plugin toggles are separate
        from this master switch.
      </p>
      <div class="mt-5 flex items-start gap-3">
        <IconCheckbox
          icon={Check}
          checked={false}
          disabled={settingsPending || loading}
          title="Enable plugins"
          on:click={() => setEcosystemEnabled(true)}
        />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-neutral-900 dark:text-neutral-50">Enable plugins</p>
          <p class="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
            Turns on discovery and management without editing environment variables or restarting Praxrr.
          </p>
        </div>
      </div>
    </section>
  {:else if pluginsEnabled === true && items.length === 0}
    <section
      class="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center dark:border-neutral-700 dark:bg-neutral-900"
      aria-labelledby="plugins-empty-title"
    >
      <h2 id="plugins-empty-title" class="font-semibold text-neutral-900 dark:text-neutral-100">
        No plugins discovered
      </h2>
      <p class="mx-auto mt-2 max-w-xl text-sm leading-6 text-neutral-600 dark:text-neutral-400">
        The enabled registry contains no validated plugin records. Reload to rescan the configured
        <code class="font-mono">PLUGINS_DIR</code>.
      </p>
      <div class="mt-4">
        <Button
          text="Reload plugins"
          variant="primary"
          size="sm"
          icon={RotateCw}
          disabled={loading || reloadPending || settingsPending}
          aria-busy={reloadPending}
          onclick={reloadPlugins}
        />
      </div>
    </section>
  {:else if pluginsEnabled === true}
    <section class="space-y-4" aria-labelledby="plugin-records-title" aria-busy={loading || reloadPending}>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="plugin-records-title" class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          Registry records
        </h2>
        <span class="text-xs text-neutral-500 dark:text-neutral-400">
          {items.length}
          {items.length === 1 ? 'record' : 'records'}
        </span>
      </div>

      {#each items as plugin (pluginIdentityKey(plugin))}
        {@const identity = pluginIdentityKey(plugin)}
        <PluginCard
          {plugin}
          pending={pendingIdentities.has(identity)}
          disabled={reloadPending || loading || settingsPending || pendingIdentities.size > 0}
          error={rowErrors[identity] ?? null}
          retryLabel="Retry intent change"
          onRetry={() => setPluginEnabled(plugin, !plugin.enabled)}
          onAction={setPluginEnabled}
        />
      {/each}
    </section>
  {/if}
</div>
