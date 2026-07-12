<script lang="ts">
  import Badge from '$ui/badge/Badge.svelte';
  import Button from '$ui/button/Button.svelte';
  import {
    capabilityPresentations,
    discoveryPresentation,
    enablementIntentPresentation,
    executionTelemetryPresentation,
    extensionPointPresentations,
    lifecyclePresentation,
    type PluginRecord,
  } from '../presentation.ts';

  export let plugin: PluginRecord;
  export let pending: boolean = false;
  export let disabled: boolean = false;
  export let error: string | null = null;
  export let retryLabel: string = 'Retry';
  export let onRetry: (() => void) | undefined = undefined;
  export let onAction: (plugin: PluginRecord, enabled: boolean) => void;

  $: discovery = discoveryPresentation(plugin);
  $: intent = enablementIntentPresentation(plugin);
  $: lifecycle = lifecyclePresentation(plugin.state);
  $: points = extensionPointPresentations(plugin);
  $: capabilities = capabilityPresentations(plugin);
  $: telemetry = executionTelemetryPresentation();

  function handleAction(): void {
    if (disabled || pending) return;
    onAction(plugin, intent.action === 'enable');
  }
</script>

<article
  class="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900 [&_button]:min-h-11"
  aria-busy={pending}
>
  <div class="border-b border-neutral-200 p-4 sm:p-5 dark:border-neutral-800">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div class="min-w-0 space-y-3">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="text-lg font-semibold break-words text-neutral-950 dark:text-neutral-50">
              {plugin.manifest.name}
            </h2>
            <Badge variant={plugin.discovered ? 'info' : 'warning'}>{discovery.label}</Badge>
          </div>
          <p class="mt-1 font-mono text-xs break-all text-neutral-500 dark:text-neutral-400">
            {plugin.manifest.apiVersion} / {plugin.manifest.id}
          </p>
          {#if plugin.manifest.description}
            <p class="mt-2 text-sm leading-6 break-words text-neutral-600 dark:text-neutral-300">
              {plugin.manifest.description}
            </p>
          {/if}
        </div>

        <div class="flex flex-wrap gap-2" aria-label="Plugin status summary">
          <Badge variant={plugin.enabled ? 'accent' : 'neutral'}>{intent.label}</Badge>
          <Badge variant={lifecycle.tone}>{lifecycle.label}</Badge>
        </div>
      </div>

      <div class="flex shrink-0 flex-col items-start gap-2 sm:items-end [&_button]:min-h-11">
        <Button
          text={intent.actionLabel}
          variant={intent.action === 'disable' ? 'danger' : 'primary'}
          size="sm"
          disabled={disabled && !pending}
          ariaLabel={`${intent.actionLabel}: ${plugin.manifest.name}`}
          aria-disabled={disabled || pending}
          aria-busy={pending}
          onclick={handleAction}
        />
        {#if pending}
          <span class="text-xs text-neutral-500 dark:text-neutral-400" role="status">Saving confirmed intent…</span>
        {/if}
      </div>
    </div>
  </div>

  {#if error}
    <div class="border-b border-red-200 bg-red-50 px-4 py-3 sm:px-5 dark:border-red-900/60 dark:bg-red-950/30">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p class="text-sm break-words text-red-800 dark:text-red-200" role="alert">{error}</p>
        {#if onRetry}
          <Button
            text={retryLabel}
            variant="secondary"
            size="xs"
            disabled={disabled || pending}
            ariaLabel={`${retryLabel}: ${plugin.manifest.name}`}
            onclick={onRetry}
          />
        {/if}
      </div>
    </div>
  {/if}

  <details class="group">
    <summary
      class="focus-visible:outline-accent-500 flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-neutral-700 marker:hidden hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] sm:px-5 dark:text-neutral-200 dark:hover:bg-neutral-800/60"
    >
      <span>Inspect plugin details</span>
      <span class="text-xs text-neutral-500 group-open:hidden dark:text-neutral-400" aria-hidden="true">Expand</span>
      <span class="hidden text-xs text-neutral-500 group-open:inline dark:text-neutral-400" aria-hidden="true"
        >Collapse</span
      >
    </summary>

    <div class="space-y-6 border-t border-neutral-200 p-4 sm:p-5 dark:border-neutral-800">
      <section aria-labelledby={`plugin-identity-${plugin.manifest.apiVersion}-${plugin.manifest.id}`}>
        <h3
          id={`plugin-identity-${plugin.manifest.apiVersion}-${plugin.manifest.id}`}
          class="text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400"
        >
          Identity
        </h3>
        <dl class="mt-3 grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div class="min-w-0">
            <dt class="text-neutral-500 dark:text-neutral-400">Name</dt>
            <dd class="break-words text-neutral-900 dark:text-neutral-100">{plugin.manifest.name}</dd>
          </div>
          <div class="min-w-0">
            <dt class="text-neutral-500 dark:text-neutral-400">Version</dt>
            <dd class="font-mono break-all text-neutral-900 dark:text-neutral-100">{plugin.manifest.version}</dd>
          </div>
          <div class="min-w-0">
            <dt class="text-neutral-500 dark:text-neutral-400">Plugin ID</dt>
            <dd class="font-mono break-all text-neutral-900 dark:text-neutral-100">{plugin.manifest.id}</dd>
          </div>
          <div class="min-w-0">
            <dt class="text-neutral-500 dark:text-neutral-400">API version</dt>
            <dd class="font-mono break-all text-neutral-900 dark:text-neutral-100">{plugin.manifest.apiVersion}</dd>
          </div>
          <div class="min-w-0">
            <dt class="text-neutral-500 dark:text-neutral-400">Runtime declaration</dt>
            <dd class="font-mono break-all text-neutral-900 dark:text-neutral-100">{plugin.manifest.runtime}</dd>
          </div>
          <div class="min-w-0">
            <dt class="text-neutral-500 dark:text-neutral-400">Module entry</dt>
            <dd class="font-mono break-all text-neutral-900 dark:text-neutral-100">{plugin.manifest.entry}</dd>
          </div>
          {#if plugin.manifest.author}
            <div class="min-w-0">
              <dt class="text-neutral-500 dark:text-neutral-400">Author</dt>
              <dd class="break-words text-neutral-900 dark:text-neutral-100">{plugin.manifest.author}</dd>
            </div>
          {/if}
          {#if plugin.manifest.engines?.praxrr}
            <div class="min-w-0">
              <dt class="text-neutral-500 dark:text-neutral-400">Advisory Praxrr engine</dt>
              <dd class="font-mono break-all text-neutral-900 dark:text-neutral-100">
                {plugin.manifest.engines.praxrr}
              </dd>
            </div>
          {/if}
        </dl>
      </section>

      <section aria-labelledby={`plugin-state-${plugin.manifest.apiVersion}-${plugin.manifest.id}`}>
        <h3
          id={`plugin-state-${plugin.manifest.apiVersion}-${plugin.manifest.id}`}
          class="text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400"
        >
          Registry evidence
        </h3>
        <dl class="mt-3 space-y-4 text-sm">
          <div>
            <dt class="font-medium text-neutral-800 dark:text-neutral-200">Discovery</dt>
            <dd class="mt-1 text-neutral-600 dark:text-neutral-300">
              <span class="font-medium text-neutral-900 dark:text-neutral-100">{discovery.label}.</span>
              {discovery.description}
            </dd>
          </div>
          <div>
            <dt class="font-medium text-neutral-800 dark:text-neutral-200">Saved enablement intent</dt>
            <dd class="mt-1 text-neutral-600 dark:text-neutral-300">
              <span class="font-medium text-neutral-900 dark:text-neutral-100">{intent.label}.</span>
              {intent.description}
            </dd>
          </div>
          <div>
            <dt class="font-medium text-neutral-800 dark:text-neutral-200">Lifecycle state</dt>
            <dd class="mt-1 text-neutral-600 dark:text-neutral-300">
              <span class="font-medium text-neutral-900 dark:text-neutral-100">{lifecycle.label}.</span>
              {lifecycle.description}
            </dd>
          </div>
        </dl>

        <dl class="mt-4 grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div class="min-w-0">
            <dt class="text-neutral-500 dark:text-neutral-400">Registered at</dt>
            <dd class="break-all text-neutral-900 dark:text-neutral-100">
              <time datetime={plugin.registeredAt}>{plugin.registeredAt}</time>
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-neutral-500 dark:text-neutral-400">Record created</dt>
            <dd class="break-all text-neutral-900 dark:text-neutral-100">
              <time datetime={plugin.createdAt}>{plugin.createdAt}</time>
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-neutral-500 dark:text-neutral-400">Record updated</dt>
            <dd class="break-all text-neutral-900 dark:text-neutral-100">
              <time datetime={plugin.updatedAt}>{plugin.updatedAt}</time>
            </dd>
          </div>
        </dl>

        <div
          class="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800/50"
        >
          <p class="text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
            Last lifecycle error
          </p>
          <p class="mt-1 text-sm break-words text-neutral-700 dark:text-neutral-200">
            {plugin.lastError ?? 'No lifecycle error recorded.'}
          </p>
        </div>
      </section>

      <section aria-labelledby={`plugin-points-${plugin.manifest.apiVersion}-${plugin.manifest.id}`}>
        <h3
          id={`plugin-points-${plugin.manifest.apiVersion}-${plugin.manifest.id}`}
          class="text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400"
        >
          Declared extension points
        </h3>
        {#if points.length > 0}
          <ul class="mt-3 space-y-3">
            {#each points as point (point.id)}
              <li class="min-w-0 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
                <div class="flex flex-wrap items-center gap-2">
                  <code class="text-xs break-all text-neutral-900 dark:text-neutral-100">{point.id}</code>
                  <Badge variant={point.wired ? 'info' : 'warning'}>{point.wiringLabel}</Badge>
                  <Badge variant="neutral">{point.kind}</Badge>
                </div>
                <p class="mt-2 text-xs text-neutral-600 dark:text-neutral-300">
                  {point.mutates ? 'Mutating point.' : 'Non-mutating point.'}
                  {#if point.requiredCapability}
                    Requires <code class="break-all">{point.requiredCapability}</code>.
                  {:else}
                    No current grant can authorize this point.
                  {/if}
                </p>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="mt-3 text-sm text-neutral-600 dark:text-neutral-300">No extension points declared.</p>
        {/if}
      </section>

      <section aria-labelledby={`plugin-grants-${plugin.manifest.apiVersion}-${plugin.manifest.id}`}>
        <h3
          id={`plugin-grants-${plugin.manifest.apiVersion}-${plugin.manifest.id}`}
          class="text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400"
        >
          Granted capabilities
        </h3>
        {#if capabilities.length > 0}
          <ul class="mt-3 space-y-3">
            {#each capabilities as capability (capability.id)}
              <li class="min-w-0 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-medium text-neutral-900 dark:text-neutral-100">{capability.label}</span>
                  <Badge variant="neutral" mono>{capability.id}</Badge>
                </div>
                <p class="mt-2 text-sm text-neutral-600 dark:text-neutral-300">{capability.description}</p>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="mt-3 text-sm text-neutral-600 dark:text-neutral-300">No capabilities granted.</p>
        {/if}
        <p class="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
          Current grants are read-only and cannot represent credential, secret, network, filesystem, environment,
          database, or write access.
        </p>
      </section>

      <section
        class="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30"
        aria-labelledby={`plugin-telemetry-${plugin.manifest.apiVersion}-${plugin.manifest.id}`}
      >
        <h3
          id={`plugin-telemetry-${plugin.manifest.apiVersion}-${plugin.manifest.id}`}
          class="font-medium text-amber-950 dark:text-amber-100"
        >
          {telemetry.label}
        </h3>
        <p class="mt-1 text-sm text-amber-900 dark:text-amber-200">{telemetry.description}</p>
      </section>
    </div>
  </details>
</article>
