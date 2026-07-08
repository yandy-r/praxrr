<script lang="ts">
  import { goto } from '$app/navigation';
  import { enhance } from '$app/forms';
  import { alertStore } from '$alerts/store';
  import Button from '$ui/button/Button.svelte';
  import FormInput from '$ui/form/FormInput.svelte';
  import AdvancedSection from '$ui/form/AdvancedSection.svelte';
  import { ArrowRight, Database, CheckCircle2 } from 'lucide-svelte';
  import type { ActionData, PageData } from './$types';

  export let data: PageData;
  export let form: ActionData;

  let mode: 'basic' | 'advanced' = data.defaultDatabase.configured ? 'basic' : 'advanced';

  let name = (form?.values?.mode === 'custom' ? form.values.name : '') ?? '';
  let repositoryUrl = (form?.values?.mode === 'custom' ? form.values.repository_url : '') ?? '';
  let personalAccessToken = '';

  let linkingDefault = false;
  let linkingCustom = false;
  let advancing = false;

  // Surface the action's error once per submission, not on every reactive pass.
  let lastForm: ActionData | undefined = undefined;
  $: if (form && form !== lastForm) {
    lastForm = form;
    if (form.error) {
      alertStore.add('error', form.error);
    }
  }

  async function handleContinue() {
    advancing = true;
    try {
      const res = await fetch('/api/v1/setup/state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentStep: 'select-profiles' }),
      });
      if (!res.ok) throw new Error('Failed to advance setup step');
      await goto('/setup/select-profiles');
    } catch {
      alertStore.add('error', 'Could not continue — please try again.');
    } finally {
      advancing = false;
    }
  }
</script>

<svelte:head>
  <title>Link Database - Setup - Praxrr</title>
</svelte:head>

{#if data.alreadyLinked}
  <div class="space-y-6">
    <div
      class="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950"
    >
      <CheckCircle2 size={20} class="mt-0.5 shrink-0 text-green-600 dark:text-green-400" />
      <div>
        <p class="text-sm font-medium text-neutral-900 dark:text-neutral-50">Already linked</p>
        <p class="text-sm text-neutral-600 dark:text-neutral-400">
          {data.linkedDatabases.length === 1
            ? `"${data.linkedDatabases[0].name}" is linked.`
            : `${data.linkedDatabases.length} databases are linked.`}
        </p>
      </div>
    </div>

    <Button
      variant="primary"
      size="md"
      icon={ArrowRight}
      iconPosition="right"
      text={advancing ? 'Continuing…' : 'Continue'}
      disabled={advancing}
      on:click={handleContinue}
    />
  </div>
{:else}
  <div class="space-y-6">
    <p class="text-neutral-600 dark:text-neutral-400">
      Link a Praxrr Compliant Database to source quality profiles, custom formats, and release profiles for sync.
    </p>

    <AdvancedSection
      sectionTitle="Custom repository"
      sectionHint="Link your own Git repository instead of the default database."
      showAdvancedLabel="Use a custom repository"
      hideAdvancedLabel="Use the default instead"
      bind:mode
    >
      <div class="space-y-3">
        <div class="flex items-center gap-3">
          <Database size={20} class="text-accent-600 dark:text-accent-400" />
          <div>
            <p class="text-sm font-medium text-neutral-900 dark:text-neutral-50">
              Use default ({data.defaultDatabase.name})
            </p>
            {#if data.defaultDatabase.configured}
              <p class="text-xs text-neutral-500 dark:text-neutral-400">
                {data.defaultDatabase.url} · {data.defaultDatabase.branch}
              </p>
            {:else}
              <p class="text-xs text-neutral-500 dark:text-neutral-400">
                No default database is configured for this deployment.
              </p>
            {/if}
          </div>
        </div>

        {#if data.defaultDatabase.configured}
          <form
            method="POST"
            use:enhance={() => {
              linkingDefault = true;
              return async ({ update }) => {
                await update();
                linkingDefault = false;
              };
            }}
          >
            <input type="hidden" name="mode" value="default" />
            <Button
              type="submit"
              variant="primary"
              size="md"
              text={linkingDefault ? 'Linking…' : 'Link default database'}
              disabled={linkingDefault}
            />
          </form>
        {/if}
      </div>

      <svelte:fragment slot="advanced">
        <form
          method="POST"
          class="space-y-4"
          use:enhance={() => {
            linkingCustom = true;
            return async ({ update }) => {
              await update();
              linkingCustom = false;
            };
          }}
        >
          <input type="hidden" name="mode" value="custom" />
          <FormInput
            label="Name"
            name="name"
            bind:value={name}
            placeholder="e.g., My Config Database"
            description="A friendly name to identify this database"
            required
          />
          <FormInput
            label="Repository URL"
            name="repository_url"
            type="url"
            bind:value={repositoryUrl}
            placeholder="https://github.com/username/database"
            description="Git repository URL containing the PCD manifest. HTTPS only, no embedded credentials."
            required
          />
          <FormInput
            label="Personal Access Token"
            name="personal_access_token"
            bind:value={personalAccessToken}
            placeholder="ghp_..."
            description="Required for private repositories. Never embed credentials in the URL."
            private_
          />
          <Button
            type="submit"
            variant="primary"
            size="md"
            text={linkingCustom ? 'Linking…' : 'Link database'}
            disabled={linkingCustom || !name || !repositoryUrl}
          />
        </form>
      </svelte:fragment>
    </AdvancedSection>
  </div>
{/if}
