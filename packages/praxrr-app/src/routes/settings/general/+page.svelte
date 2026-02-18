<script lang="ts">
	import LoggingSettings from './components/LoggingSettings.svelte';
	import BackupSettings from './components/BackupSettings.svelte';
	import AISettings from './components/AISettings.svelte';
	import TMDBSettings from './components/TMDBSettings.svelte';
	import UISettings from './components/UISettings.svelte';
	import ArrDefaultsSettings from './components/ArrDefaultsSettings.svelte';
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
		<BackupSettings settings={data.backupSettings} />

		<!-- Logging Configuration -->
		<LoggingSettings settings={data.logSettings} />

		<!-- AI Configuration -->
		<AISettings settings={data.aiSettings} />

		<!-- TMDB Configuration -->
		<TMDBSettings settings={data.tmdbSettings} />
	</div>
</div>
