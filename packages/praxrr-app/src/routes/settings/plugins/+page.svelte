<script lang="ts">
  import { onMount } from 'svelte';
  import { RefreshCw, RotateCw } from 'lucide-svelte';
  import { alertStore } from '$alerts/store';
  import Button from '$ui/button/Button.svelte';
  import PluginCard from './components/PluginCard.svelte';
  import {
    capabilityPresentations,
    extensionPointPresentations,
    pluginIdentityKey,
    pluginMutationUrl,
    sortPluginsForPresentation,
    type PluginErrorResponse,
    type PluginLifecycleState,
    type PluginListResponse,
    type PluginMutationResponse,
    type PluginRecord,
    type PluginReloadResponse,
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

  const LIFECYCLE_STATES = new Set<PluginLifecycleState>([
    'discovered',
    'validated',
    'registered',
    'rejected',
    'activated',
    'failed',
    'unloaded',
  ]);

  let items: PluginRecord[] = [];
  let pluginsEnabled: boolean | null = null;
  let loading = true;
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

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function isPluginRecord(value: unknown): value is PluginRecord {
    if (!isRecord(value) || !isRecord(value.manifest)) return false;

    const manifest = value.manifest;
    const complete =
      typeof manifest.apiVersion === 'string' &&
      typeof manifest.id === 'string' &&
      typeof manifest.name === 'string' &&
      typeof manifest.version === 'string' &&
      manifest.runtime === 'wasm' &&
      typeof manifest.entry === 'string' &&
      Array.isArray(manifest.extensionPoints) &&
      Array.isArray(manifest.capabilities) &&
      (manifest.description === undefined || typeof manifest.description === 'string') &&
      (manifest.author === undefined || typeof manifest.author === 'string') &&
      (manifest.engines === undefined ||
        (isRecord(manifest.engines) &&
          (manifest.engines.praxrr === undefined || typeof manifest.engines.praxrr === 'string'))) &&
      typeof value.enabled === 'boolean' &&
      typeof value.discovered === 'boolean' &&
      typeof value.state === 'string' &&
      LIFECYCLE_STATES.has(value.state as PluginLifecycleState) &&
      typeof value.registeredAt === 'string' &&
      (value.lastError === null || typeof value.lastError === 'string') &&
      typeof value.createdAt === 'string' &&
      typeof value.updatedAt === 'string';

    if (!complete) return false;

    try {
      capabilityPresentations(value as PluginRecord);
      extensionPointPresentations(value as PluginRecord);
      return true;
    } catch {
      return false;
    }
  }

  function isPluginListResponse(value: unknown): value is PluginListResponse {
    return (
      isRecord(value) &&
      typeof value.pluginsEnabled === 'boolean' &&
      Array.isArray(value.items) &&
      value.items.every(isPluginRecord)
    );
  }

  function isPluginMutationResponse(value: unknown): value is PluginMutationResponse {
    return isRecord(value) && value.pluginsEnabled === true && isPluginRecord(value.plugin);
  }

  function isPluginReloadResponse(value: unknown): value is PluginReloadResponse {
    if (!isRecord(value) || typeof value.pluginsEnabled !== 'boolean' || typeof value.reloaded !== 'boolean') {
      return false;
    }

    return ['discovered', 'registered', 'rejected', 'missing'].every((field) => {
      const count = value[field];
      return typeof count === 'number' && Number.isInteger(count) && count >= 0;
    });
  }

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
        : 'Plugin management is disabled by deployment configuration.';
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
    if (loading || reloadPending || pendingIdentities.size > 0) return;
    await loadPlugins({ preserveOnFailure: pluginsEnabled !== null, announceFailure: true });
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
              : 'Plugin management was disabled while the change was pending. Refreshing deployment state.';
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
    if (loading || reloadPending || pendingIdentities.size > 0 || pluginsEnabled !== true) return;

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
        statusMessage = 'Plugin management is disabled by deployment configuration; no reload was performed.';
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

<div class="space-y-6">
  <header class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
    <div class="max-w-3xl">
      <h1 class="text-2xl font-bold text-neutral-900 md:text-3xl dark:text-neutral-50">Plugin Management</h1>
      <p class="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-400">
        Inspect validated plugin metadata, saved enablement intent, lifecycle evidence, declared points, and grants.
        Execution telemetry is unavailable in this build.
      </p>
    </div>

    {#if pluginsEnabled !== false}
      <div class="flex shrink-0 flex-wrap gap-2">
        <Button
          text="Refresh registry"
          variant="secondary"
          size="sm"
          icon={RefreshCw}
          disabled={loading || reloadPending || pendingIdentities.size > 0}
          aria-busy={loading}
          onclick={refreshPlugins}
        />
        {#if pluginsEnabled === true}
          <Button
            text="Reload plugins"
            variant="primary"
            size="sm"
            icon={RotateCw}
            disabled={loading || reloadPending || pendingIdentities.size > 0}
            aria-busy={reloadPending}
            onclick={reloadPlugins}
          />
        {/if}
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
        disabled={loading || reloadPending || pendingIdentities.size > 0}
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
        disabled={loading || reloadPending || pendingIdentities.size > 0}
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
      class="rounded-xl border border-blue-300 bg-blue-50 p-5 text-blue-950 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-100"
      aria-labelledby="plugin-disabled-title"
    >
      <h2 id="plugin-disabled-title" class="font-semibold">Plugin management is disabled</h2>
      <p class="mt-2 max-w-3xl text-sm leading-6">
        Set <code class="font-mono">PLUGINS_ENABLED</code> in the deployment configuration to expose the registry. No plugin
        scan or enablement action is available while the feature is off.
      </p>
      <div class="mt-4">
        <Button
          text="Check configuration again"
          variant="secondary"
          size="sm"
          disabled={loading}
          onclick={refreshPlugins}
        />
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
          disabled={loading || reloadPending}
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
          disabled={reloadPending || loading || pendingIdentities.size > 0}
          error={rowErrors[identity] ?? null}
          retryLabel="Retry intent change"
          onRetry={() => setPluginEnabled(plugin, !plugin.enabled)}
          onAction={setPluginEnabled}
        />
      {/each}
    </section>
  {/if}
</div>
