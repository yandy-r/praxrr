<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { alertStore } from '$alerts/store';
  import Button from '$ui/button/Button.svelte';
  import { uniqueId } from '$lib/client/utils/uniqueId';
  import {
    importBundle,
    parseBundle,
    reportCanApply,
    MAX_BUNDLE_BYTES,
    type PcdBundle,
    type BundleReport,
    type CollisionPolicy,
  } from '$lib/client/bundles/api.ts';

  export let databaseId: number;
  export let canWriteToBase = false;
  export let bundle: PcdBundle | null = null;
  export let showInput = true;
  export let busy = false;

  const dispatch = createEventDispatcher<{ applied: void }>();
  const id = uniqueId('bundle-import');
  let text = '';
  let layer: 'user' | 'base' = 'user';
  let policy: CollisionPolicy = 'skip';
  let overrides: Record<string, CollisionPolicy> = {};
  let report: BundleReport | null = null;
  let planDigest = '';
  let previewVersion = -1;
  let inputVersion = 0;

  $: if (!canWriteToBase) layer = 'user';
  $: previewCurrent = previewVersion === inputVersion;
  $: canApply = previewCurrent && reportCanApply(report) && !busy;

  function markChanged() {
    inputVersion += 1;
  }
  $: counts =
    bundle?.entities.reduce<Record<string, number>>((result, entry) => {
      result[entry.entityType] = (result[entry.entityType] || 0) + 1;
      return result;
    }, {}) ?? {};

  function parseText(version = inputVersion + 1) {
    report = null;
    overrides = {};
    bundle = null;
    inputVersion = version;
    if (!text.trim()) return;
    try {
      bundle = parseBundle(text);
    } catch (error) {
      alertStore.add('error', error instanceof Error ? error.message : 'Invalid bundle');
    }
  }

  async function upload(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > MAX_BUNDLE_BYTES) {
      alertStore.add('error', 'Bundle must be no larger than 5 MiB');
      input.value = '';
      return;
    }
    try {
      text = await file.text();
      const version = inputVersion + 1;
      parseText(version);
    } catch {
      alertStore.add('error', 'Could not read bundle file');
    }
    input.value = '';
  }

  async function run(dryRun: boolean) {
    if (busy || (!dryRun && !canApply)) return;
    let selected = bundle;
    if (showInput) {
      try {
        selected = parseBundle(text);
        bundle = selected;
      } catch (error) {
        alertStore.add('error', error instanceof Error ? error.message : 'Invalid bundle');
        return;
      }
    }
    if (!selected) return;
    busy = true;
    try {
      const submittedVersion = inputVersion;
      const response = await importBundle({
        databaseId,
        layer,
        bundle: selected,
        dryRun,
        collisions: { default: policy, perEntity: overrides },
        ...(dryRun ? {} : { expectedPlanDigest: planDigest }),
      });
      if (response.status === 409) {
        report = (response.body.report as BundleReport | undefined) ?? null;
        previewVersion = -1;
        planDigest = '';
        alertStore.add('warning', 'Target changed, run another dry run');
        return;
      }
      report = response.report;
      previewVersion = dryRun ? submittedVersion : -1;
      planDigest = dryRun && response.report.planDigest ? response.report.planDigest : '';
      if (!dryRun) {
        if (report.applied) {
          alertStore.add('success', 'Bundle imported successfully');
          await invalidateAll();
          dispatch('applied');
        } else {
          alertStore.add(
            'error',
            report.rolledBack
              ? 'Import failed; all changes were rolled back'
              : 'Bundle was not applied. Review the report.'
          );
        }
      }
    } catch (error) {
      report = null;
      planDigest = '';
      previewVersion = -1;
      alertStore.add('error', error instanceof Error ? error.message : 'Bundle import failed');
    } finally {
      busy = false;
    }
  }
</script>

<section class="space-y-5" aria-label="Bundle import">
  {#if showInput}
    <div class="space-y-2">
      <label for={id + '-json'} class="block text-sm font-medium">Bundle JSON</label>
      <textarea
        id={id + '-json'}
        bind:value={text}
        on:input={markChanged}
        on:change={() => parseText()}
        disabled={busy}
        rows="8"
        class="w-full rounded-md border border-neutral-300 bg-white p-3 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950"
        placeholder={'{"version": 1, "entities": [...]}'}
      ></textarea>
      <label for={id + '-file'} class="block text-sm font-medium">Or upload a JSON file (up to 5 MiB)</label>
      <input
        id={id + '-file'}
        type="file"
        accept=".json,application/json"
        on:change={upload}
        disabled={busy}
        class="block max-w-full text-sm"
      />
    </div>
  {/if}
  {#if bundle}
    <p class="text-sm text-neutral-600 dark:text-neutral-400" role="status">
      Version {bundle.version} · {bundle.entities.length} entities
      {#each Object.entries(counts) as [type, count]}<span class="ml-2">{type}: {count}</span>{/each}
    </p>
  {/if}
  <fieldset disabled={busy} class="flex flex-wrap gap-4">
    <label class="space-y-1 text-sm">
      <span class="block font-medium">Layer</span>
      <select
        bind:value={layer}
        on:change={markChanged}
        class="rounded-md border border-neutral-300 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-950"
      >
        <option value="user">User overrides</option>
        {#if canWriteToBase}<option value="base">Base</option>{/if}
      </select>
    </label>
    <label class="space-y-1 text-sm">
      <span class="block font-medium">Default collision policy</span>
      <select
        bind:value={policy}
        on:change={markChanged}
        class="rounded-md border border-neutral-300 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-950"
      >
        <option value="skip">Skip existing</option><option value="rename">Rename incoming</option><option
          value="overwrite">Overwrite existing</option
        >
      </select>
    </label>
  </fieldset>
  <p class="text-xs text-neutral-500">
    Dry run previews all changes without writing. Overwrite replaces matching entities; rename preserves them.
  </p>
  <div class="flex gap-3">
    <Button
      text={busy ? 'Working…' : 'Dry run'}
      disabled={busy || (!bundle && !text.trim())}
      on:click={() => run(true)}
    />
    <Button text="Apply bundle" variant="primary" disabled={!canApply} on:click={() => run(false)} />
  </div>
  {#if report}
    <div class="space-y-3" aria-live="polite">
      <h2 class="text-base font-semibold">{report.applied ? 'Import result' : 'Import preview'}</h2>
      {#if !previewCurrent}<p class="text-sm text-amber-700 dark:text-amber-400">
          Settings changed. Run another dry run before applying.
        </p>{/if}
      <div class="overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800">
        <table class="w-full text-left text-sm">
          <thead class="bg-neutral-100 dark:bg-neutral-800"
            ><tr
              ><th class="p-2">Entity type</th><th class="p-2">Name → final name</th><th class="p-2">Action</th><th
                class="p-2">Collision policy</th
              ></tr
            ></thead
          >
          <tbody>
            {#each report.outcomes as outcome}
              <tr class="border-t border-neutral-200 dark:border-neutral-800">
                <td class="p-2">{outcome.entityType}</td><td class="p-2"
                  >{outcome.name}{#if outcome.finalName && outcome.finalName !== outcome.name}
                    → {outcome.finalName}{/if}</td
                >
                <td class="p-2"
                  ><span class="rounded bg-neutral-100 px-2 py-1 text-xs dark:bg-neutral-800">{outcome.action}</span
                  >{#if outcome.error}<p class="text-red-600 dark:text-red-400">{outcome.error}</p>{/if}</td
                >
                <td class="p-2"
                  ><select
                    aria-label={`Collision policy for ${outcome.entityType}: ${outcome.name}`}
                    disabled={busy || report.applied}
                    value={overrides[`${outcome.entityType}:${outcome.name}`] ?? ''}
                    on:change={(event) => {
                      const key = `${outcome.entityType}:${outcome.name}`;
                      const value = event.currentTarget.value;
                      const next = { ...overrides };
                      if (value) next[key] = value as CollisionPolicy;
                      else delete next[key];
                      markChanged();
                      overrides = next;
                    }}
                    class="rounded border border-neutral-300 bg-white p-1 dark:border-neutral-700 dark:bg-neutral-950"
                  >
                    <option value="">Use default</option><option value="skip">Skip</option><option value="rename"
                      >Rename</option
                    ><option value="overwrite">Overwrite</option>
                  </select></td
                >
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if report.missingReferences.length}
        <h3 class="font-medium text-red-700 dark:text-red-400">Missing references — import blocked</h3>
        <ul class="list-inside list-disc text-sm">
          {#each report.missingReferences as ref}<li>
              {ref.fromType} “{ref.fromName}” requires {ref.toType} “{ref.toName}”
            </li>{/each}
        </ul>
      {/if}
      {#if report.errors.length}
        <h3 class="font-medium text-red-700 dark:text-red-400">Errors — import blocked</h3>
        <ul class="list-inside list-disc text-sm">
          {#each report.errors as error}<li>{error.name ?? error.entityType ?? 'Bundle'}: {error.error}</li>{/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>
