<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { Plus, Trash2, Lock } from 'lucide-svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import Button from '$ui/button/Button.svelte';
  import type { components } from '$api/v1.d.ts';
  import { PROFILE_SETTING_FIELDS, type ImpactProfileOption, type ProfileSettingField } from '../helpers.ts';

  type ProposedChange = components['schemas']['ProposedChange'];
  type SetCfScoreChange = components['schemas']['SetCfScoreChange'];

  export let profiles: ImpactProfileOption[] = [];
  export let customFormats: Array<{ id: number; name: string }> = [];
  export let changes: ProposedChange[] = [];

  const dispatch = createEventDispatcher<{ change: { changes: ProposedChange[] } }>();

  // Per-profile draft state for the "add custom-format score" row.
  let draftCfName: Record<string, string> = {};
  let draftCfScore: Record<string, string> = {};

  function emit(next: ProposedChange[]) {
    dispatch('change', { changes: next });
  }

  function getProfileSetting(profileName: string, field: ProfileSettingField): number | null {
    const found = changes.find(
      (change) => change.kind === 'set_profile_setting' && change.profileName === profileName && change.field === field
    );
    return found && found.kind === 'set_profile_setting' ? found.value : null;
  }

  function upsertProfileSetting(profileName: string, field: ProfileSettingField, rawValue: string) {
    const next = changes.filter(
      (change) =>
        !(change.kind === 'set_profile_setting' && change.profileName === profileName && change.field === field)
    );

    const trimmed = rawValue.trim();
    if (trimmed.length > 0) {
      const value = Number.parseInt(trimmed, 10);
      if (Number.isFinite(value)) {
        next.push({ kind: 'set_profile_setting', profileName, field, value });
      }
    }

    emit(next);
  }

  function cfScoresForProfile(profileName: string): SetCfScoreChange[] {
    return changes.filter(
      (change): change is SetCfScoreChange => change.kind === 'set_cf_score' && change.profileName === profileName
    );
  }

  function updateCfScore(profileName: string, customFormatName: string, rawValue: string) {
    const trimmed = rawValue.trim();
    const value = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(value)) {
      return;
    }

    const next = changes.filter(
      (change) =>
        !(
          change.kind === 'set_cf_score' &&
          change.profileName === profileName &&
          change.customFormatName === customFormatName
        )
    );
    next.push({ kind: 'set_cf_score', profileName, customFormatName, score: value });
    emit(next);
  }

  function removeCfScore(profileName: string, customFormatName: string) {
    emit(
      changes.filter(
        (change) =>
          !(
            change.kind === 'set_cf_score' &&
            change.profileName === profileName &&
            change.customFormatName === customFormatName
          )
      )
    );
  }

  function addCfScore(profileName: string) {
    const customFormatName = draftCfName[profileName];
    const rawScore = draftCfScore[profileName] ?? '';
    if (!customFormatName || rawScore.trim().length === 0) {
      return;
    }

    updateCfScore(profileName, customFormatName, rawScore);
    draftCfName = { ...draftCfName, [profileName]: '' };
    draftCfScore = { ...draftCfScore, [profileName]: '' };
  }

  const inputClass =
    'w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 focus:border-accent-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100';
</script>

<div class="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
  <div>
    <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Proposed changes</h3>
    <p class="text-xs text-neutral-500 dark:text-neutral-400">
      Edit scores and thresholds for the selected profiles. Changes are applied to a sandbox only — nothing is saved.
    </p>
  </div>

  {#if profiles.length === 0}
    <p class="text-xs text-neutral-500 dark:text-neutral-400">Select one or more quality profiles to edit.</p>
  {:else}
    <div class="space-y-4">
      {#each profiles as profile (profile.value)}
        <div class="space-y-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100">{profile.displayName}</span>
            {#if !profile.editable}
              <Badge variant="trash" size="sm" icon={Lock}>Read-only</Badge>
            {/if}
          </div>

          {#if !profile.editable}
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              TRaSH profile scores are fixed by the guide and cannot be edited here.
            </p>
          {:else}
            <!-- Threshold settings -->
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {#each PROFILE_SETTING_FIELDS as setting (setting.field)}
                <div class="space-y-1">
                  <label
                    for="{profile.value}-{setting.field}"
                    class="block text-xs font-medium text-neutral-700 dark:text-neutral-300"
                  >
                    {setting.label}
                  </label>
                  <input
                    id="{profile.value}-{setting.field}"
                    type="number"
                    step="1"
                    class={inputClass}
                    placeholder="unchanged"
                    value={getProfileSetting(profile.name, setting.field) ?? ''}
                    on:change={(event) => upsertProfileSetting(profile.name, setting.field, event.currentTarget.value)}
                  />
                  <p class="text-[11px] text-neutral-400 dark:text-neutral-500">{setting.hint}</p>
                </div>
              {/each}
            </div>

            <!-- Existing custom-format score changes -->
            {#if cfScoresForProfile(profile.name).length > 0}
              <div class="space-y-1.5">
                {#each cfScoresForProfile(profile.name) as cfChange (cfChange.customFormatName)}
                  <div class="flex items-center gap-2">
                    <span
                      class="flex-1 truncate text-xs text-neutral-700 dark:text-neutral-300"
                      title={cfChange.customFormatName}
                    >
                      {cfChange.customFormatName}
                    </span>
                    <input
                      type="number"
                      step="1"
                      class="{inputClass} w-24"
                      value={cfChange.score}
                      on:change={(event) =>
                        updateCfScore(profile.name, cfChange.customFormatName, event.currentTarget.value)}
                    />
                    <button
                      type="button"
                      class="flex h-7 w-7 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                      aria-label="Remove score change"
                      on:click={() => removeCfScore(profile.name, cfChange.customFormatName)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                {/each}
              </div>
            {/if}

            <!-- Add custom-format score -->
            <div class="flex items-end gap-2">
              <div class="flex-1 space-y-1">
                <label
                  for="{profile.value}-cf-select"
                  class="block text-xs font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Custom format
                </label>
                <select id="{profile.value}-cf-select" class={inputClass} bind:value={draftCfName[profile.value]}>
                  <option value="">Select a custom format…</option>
                  {#each customFormats as cf (cf.id)}
                    <option value={cf.name}>{cf.name}</option>
                  {/each}
                </select>
              </div>
              <div class="w-24 space-y-1">
                <label
                  for="{profile.value}-cf-score"
                  class="block text-xs font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Score
                </label>
                <input
                  id="{profile.value}-cf-score"
                  type="number"
                  step="1"
                  class={inputClass}
                  bind:value={draftCfScore[profile.value]}
                />
              </div>
              <Button
                text="Add"
                variant="secondary"
                size="sm"
                icon={Plus}
                disabled={!draftCfName[profile.value] || !(draftCfScore[profile.value] ?? '').trim()}
                on:click={() => addCfScore(profile.value)}
              />
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
