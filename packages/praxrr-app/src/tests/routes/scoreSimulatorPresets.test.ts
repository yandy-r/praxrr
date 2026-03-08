import { assert, assertEquals } from '@std/assert';
import {
	getPresetTitlesForCategory,
	getPresetsForCategory,
	getRandomPresetTitleForCategory,
	resetPresetRandomState,
} from '../../routes/score-simulator/[databaseId]/presets.ts';

Deno.test('getPresetsForCategory returns only groups for the requested category', () => {
	const movieGroups = getPresetsForCategory('movie');
	assert(movieGroups.length > 0);
	assert(movieGroups.every((group) => group.category === 'movie'));

	const seriesGroups = getPresetsForCategory('series');
	assert(seriesGroups.length > 0);
	assert(seriesGroups.every((group) => group.category === 'series'));

	const animeGroups = getPresetsForCategory('anime');
	assert(animeGroups.length > 0);
	assert(animeGroups.every((group) => group.category === 'anime'));
});

Deno.test('getPresetTitlesForCategory returns unique titles', () => {
	const titles = getPresetTitlesForCategory('movie');
	const uniqueTitles = new Set(titles);
	assertEquals(uniqueTitles.size, titles.length);
});

Deno.test('getRandomPresetTitleForCategory does not repeat until all titles are used', () => {
	resetPresetRandomState('movie');
	const titles = getPresetTitlesForCategory('movie');
	const seenTitles = new Set<string>();

	for (let index = 0; index < titles.length; index += 1) {
		const title = getRandomPresetTitleForCategory('movie', () => 0);
		assert(title !== null);
		assert(!seenTitles.has(title));
		seenTitles.add(title);
	}

	assertEquals(seenTitles.size, titles.length);

	const nextCycleTitle = getRandomPresetTitleForCategory('movie', () => 0);
	assert(nextCycleTitle !== null);
	assert(titles.includes(nextCycleTitle));
});

Deno.test('getRandomPresetTitleForCategory is isolated per category', () => {
	resetPresetRandomState();

	const movieTitle = getRandomPresetTitleForCategory('movie', () => 0);
	const seriesTitle = getRandomPresetTitleForCategory('series', () => 0);
	const animeTitle = getRandomPresetTitleForCategory('anime', () => 0);

	assert(movieTitle !== null);
	assert(seriesTitle !== null);
	assert(animeTitle !== null);
	assert(getPresetTitlesForCategory('movie').includes(movieTitle));
	assert(getPresetTitlesForCategory('series').includes(seriesTitle));
	assert(getPresetTitlesForCategory('anime').includes(animeTitle));
});
