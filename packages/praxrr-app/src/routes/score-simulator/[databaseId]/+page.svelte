<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import Tabs from '$ui/navigation/tabs/Tabs.svelte';
	import { alertStore } from '$lib/client/alerts/store';
	import ReleaseInput from './components/ReleaseInput.svelte';
	import SimulationResults from './components/SimulationResults.svelte';
	import ScoreBreakdown from './components/ScoreBreakdown.svelte';
	import type { PageData } from './$types';
	import type { components } from '$api/v1.d.ts';

	type SimulateScoreResponse = components['schemas']['SimulateScoreResponse'];
	type SimulateProfileScore = components['schemas']['SimulateProfileScore'];
	type MediaType = components['schemas']['MediaType'];
	type ArrType = components['schemas']['SimulateScoreRequest']['arrType'];

	export let data: PageData;

	const databaseStorageKey = 'scoreSimulatorDatabase';
	const titleStorageKey = 'scoreSimulator.lastTitle';
	const profileStorageKey = 'scoreSimulator.lastProfileName';
	const arrTypeStorageKey = 'scoreSimulator.lastArrType';

	let releaseTitle = '';
	let mediaType: MediaType = 'movie';
	let selectedArrType: ArrType | null = null;
	let selectedProfileName: string | null = null;
	let simulationResult: SimulateScoreResponse | null = null;
	let isSimulating = false;
	let simulationRequestToken = 0;
	let parserAvailable = data.parserAvailable;

	$: tabs = data.databases.map((db) => ({
		label: db.name,
		href: `/score-simulator/${db.id}`,
		active: db.id === data.currentDatabase.id
	}));

	$: qualityProfileOptions = data.qualityProfiles.map((profile) => ({
		id: profile.id,
		name: profile.name
	}));

	$: selectedProfileScore = getSelectedProfileScore(simulationResult, selectedProfileName);

	onMount(() => {
		if (!browser) return;

		localStorage.setItem(databaseStorageKey, String(data.currentDatabase.id));

		if (!parserAvailable) {
			alertStore.add('warning', 'Parser service unavailable...', 0);
		}

		restorePersistedState();
		void simulate();
	});

	$: if (browser) {
		localStorage.setItem(databaseStorageKey, String(data.currentDatabase.id));
		localStorage.setItem(titleStorageKey, releaseTitle);

		if (selectedProfileName) {
			localStorage.setItem(profileStorageKey, selectedProfileName);
		} else {
			localStorage.removeItem(profileStorageKey);
		}

		if (selectedArrType) {
			localStorage.setItem(arrTypeStorageKey, selectedArrType);
		} else {
			localStorage.removeItem(arrTypeStorageKey);
		}
	}

	async function simulate() {
		const title = releaseTitle.trim();
		if (!title || !selectedProfileName || !selectedArrType) {
			simulationResult = null;
			return;
		}

		const requestToken = ++simulationRequestToken;
		isSimulating = true;

		try {
			const response = await fetch('/api/v1/simulate/score', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					databaseId: data.currentDatabase.id,
					releases: [{ id: generateReleaseId(), title, type: mediaType }],
					profileNames: [selectedProfileName],
					arrType: selectedArrType
				})
			});

			if (!response.ok) {
				throw new Error('Simulation request failed');
			}

			const result = (await response.json()) as SimulateScoreResponse;
			if (requestToken !== simulationRequestToken) {
				return;
			}

			parserAvailable = result.parserAvailable;
			simulationResult = result;
		} catch (err) {
			if (requestToken !== simulationRequestToken) {
				return;
			}

			console.error('Score simulation failed:', err);
			alertStore.add('error', 'Failed to run score simulation.');
		} finally {
			if (requestToken === simulationRequestToken) {
				isSimulating = false;
			}
		}
	}

	function generateReleaseId(): string {
		if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
			return globalThis.crypto.randomUUID();
		}

		return `release-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	}

	function handleReleaseInput() {
		void simulate();
	}

	function handleProfileChange(event: CustomEvent<{ profileName: string | null }>) {
		selectedProfileName = event.detail.profileName;
		void simulate();
	}

	function handleArrTypeChange(event: CustomEvent<{ arrType: ArrType | null }>) {
		selectedArrType = event.detail.arrType;
		void simulate();
	}

	function restorePersistedState() {
		const storedTitle = localStorage.getItem(titleStorageKey);
		if (storedTitle) {
			releaseTitle = storedTitle;
		}

		const storedArrType = localStorage.getItem(arrTypeStorageKey);
		if (storedArrType === 'radarr' || storedArrType === 'sonarr') {
			selectedArrType = storedArrType;
		}

		const storedProfileName = localStorage.getItem(profileStorageKey);
		if (storedProfileName && data.qualityProfiles.some((profile) => profile.name === storedProfileName)) {
			selectedProfileName = storedProfileName;
		}
	}

	function getSelectedProfileScore(
		result: SimulateScoreResponse | null,
		profileName: string | null
	): SimulateProfileScore | null {
		if (!result || !profileName) {
			return null;
		}

		const firstResult = result.results[0];
		if (!firstResult) {
			return null;
		}

		return firstResult.profileScores.find((profile) => profile.profileName === profileName) ?? null;
	}
</script>

<svelte:head>
	<title>Score Simulator - {data.currentDatabase.name} - Praxrr</title>
</svelte:head>

<div class="space-y-6 px-4 pt-4 pb-8 md:px-8">
	<Tabs {tabs} responsive />

	<div class="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr]">
		<div class="space-y-4">
			<ReleaseInput
				bind:title={releaseTitle}
				bind:mediaType
				bind:arrType={selectedArrType}
				bind:selectedProfileName
				qualityProfiles={qualityProfileOptions}
				{isSimulating}
				{parserAvailable}
				on:input={handleReleaseInput}
				on:profileChange={handleProfileChange}
				on:arrTypeChange={handleArrTypeChange}
			/>

			<ScoreBreakdown profileScore={selectedProfileScore} />
		</div>

		<div>
			<SimulationResults result={simulationResult} {selectedProfileName} {isSimulating} />
		</div>
	</div>
</div>
