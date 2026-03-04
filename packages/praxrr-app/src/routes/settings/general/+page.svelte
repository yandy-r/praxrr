<script lang="ts">
	import LoggingSettings from './components/LoggingSettings.svelte';
	import BackupSettings from './components/BackupSettings.svelte';
	import AISettings from './components/AISettings.svelte';
	import TMDBSettings from './components/TMDBSettings.svelte';
	import UISettings from './components/UISettings.svelte';
	import ArrDefaultsSettings from './components/ArrDefaultsSettings.svelte';
	import CollapsibleCard from '$ui/card/CollapsibleCard.svelte';
	import {
		SETTINGS_LOGGING,
		SETTINGS_AI,
		SETTINGS_TMDB,
		SETTINGS_BACKUP
	} from '$shared/disclosure/sectionKeys';
	import type { PageData } from './$types';

	export let data: PageData;
</script>

<div class="p-4 md:p-8">
	<div class="mb-8">
		<h1 class="text-2xl font-bold text-neutral-900 md:text-3xl dark:text-neutral-50">General Settings</h1>
		<p class="mt-3 text-base text-neutral-600 md:text-lg dark:text-neutral-400">
			Configure general application settings and preferences
		</p>
	</div>
	<div class="space-y-8">
		<!-- UI Preferences -->
		<UISettings />

		<!-- Arr Instance Defaults -->
		<ArrDefaultsSettings settings={data.generalSettings} />

		<!-- Backup Configuration -->
		<CollapsibleCard
			title="Backup Configuration"
			description="Configure automatic backups, schedule, and retention policy"
			sectionKey={SETTINGS_BACKUP}
		>
			<BackupSettings settings={data.backupSettings} />
		</CollapsibleCard>

		<!-- Logging Configuration -->
		<CollapsibleCard
			title="Logging Configuration"
			description="Configure how Praxrr handles application logs, rotation, and retention"
			sectionKey={SETTINGS_LOGGING}
		>
			<LoggingSettings settings={data.logSettings} />
		</CollapsibleCard>

		<!-- AI Configuration -->
		<CollapsibleCard
			title="AI Configuration"
			description="Configure AI-powered features like commit message generation. Works with OpenAI, Ollama, LM Studio, or any OpenAI-compatible API."
			sectionKey={SETTINGS_AI}
		>
			<AISettings
				settings={{
					enabled: data.aiSettings.enabled,
					api_url: data.aiSettings.api_url,
					api_key_masked: data.aiSettings.api_key_masked,
					has_api_key: data.aiSettings.has_api_key,
					model: data.aiSettings.model
				}}
			/>
		</CollapsibleCard>

		<!-- TMDB Configuration -->
		<CollapsibleCard
			title="TMDB Configuration"
			description="Configure TMDB API access for searching movies and TV series."
			sectionKey={SETTINGS_TMDB}
		>
			<TMDBSettings
				settings={{
					api_key_masked: data.tmdbSettings.api_key_masked,
					has_api_key: data.tmdbSettings.has_api_key
				}}
			/>
		</CollapsibleCard>
	</div>
</div>
