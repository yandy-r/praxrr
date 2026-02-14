import {
	assertArrayIncludes,
	assertEquals,
	assertExists,
	assertStringIncludes
} from '@std/assert';
import { transformCustomFormatWithDiagnostics, type PcdCustomFormat } from '$lib/server/sync/customFormats/transformer.ts';
import {
	transformQualityProfile,
	type PcdQualityProfile
} from '$lib/server/sync/qualityProfiles/transformer.ts';
import { getLanguagesWithSupport } from '$lib/server/sync/mappings.ts';

Deno.test('lidarr custom format transform keeps supported condition types', () => {
	const format: PcdCustomFormat = {
		id: 1,
		name: 'Music Preferred',
		includeInRename: false,
		conditions: [
			{
				name: 'Title contains FLAC',
				type: 'release_title',
				arrType: 'all',
				negate: false,
				required: true,
				patterns: [{ name: 'FLAC', pattern: 'FLAC' }]
			},
			{
				name: 'Freeleech',
				type: 'indexer_flag',
				arrType: 'all',
				negate: false,
				required: false,
				indexerFlags: ['freeleech']
			},
			{
				name: 'Small files',
				type: 'size',
				arrType: 'all',
				negate: false,
				required: false,
				size: { minBytes: 1, maxBytes: 10 }
			}
		]
	};

	const transformed = transformCustomFormatWithDiagnostics(format, 'lidarr');

	assertEquals(transformed.skippedConditions.length, 0);
	assertEquals(transformed.format.specifications.length, 3);
	assertArrayIncludes(
		transformed.format.specifications.map((spec) => spec.implementation),
		['ReleaseTitleSpecification', 'IndexerFlagSpecification', 'SizeSpecification']
	);
});

Deno.test('lidarr custom format transform skips unsupported conditions with explicit reasons', () => {
	const format: PcdCustomFormat = {
		id: 2,
		name: 'Unsupported for Lidarr',
		includeInRename: false,
		conditions: [
			{
				name: 'Web source',
				type: 'source',
				arrType: 'all',
				negate: false,
				required: true,
				sources: ['web_dl']
			},
			{
				name: 'Language English',
				type: 'language',
				arrType: 'all',
				negate: false,
				required: false,
				languages: [{ name: 'English', except: false }]
			}
		]
	};

	const transformed = transformCustomFormatWithDiagnostics(format, 'lidarr');

	assertEquals(transformed.format.specifications.length, 0);
	assertEquals(transformed.skippedConditions.length, 2);
	assertStringIncludes(
		transformed.skippedConditions[0].reason,
		'not supported by Lidarr custom formats'
	);
});

Deno.test('lidarr quality profile transform maps quality and custom-format scores', () => {
	const profile: PcdQualityProfile = {
		id: 3,
		name: 'Lossless Target',
		upgradesAllowed: true,
		minimumCustomFormatScore: 10,
		upgradeUntilScore: 100,
		upgradeScoreIncrement: 5,
		qualities: [
			{
				type: 'quality',
				referenceId: 6,
				name: 'FLAC',
				position: 0,
				enabled: true,
				upgradeUntil: true
			}
		],
		language: null,
		customFormats: [{ formatId: 1, formatName: 'Lossless CF', score: 25 }]
	};

	const transformed = transformQualityProfile(
		profile,
		'lidarr',
		new Map([['flac', 'FLAC']]),
		new Map([['Lossless CF', 101]]),
		new Map([
			['Lossless CF', 101],
			['Other Format', 202]
		])
	);

	assertEquals(transformed.language, undefined);
	assertEquals(transformed.minFormatScore, 10);
	assertEquals(transformed.cutoffFormatScore, 100);

	const enabledQuality = transformed.items.find((item) => item.quality?.id === 6);
	assertExists(enabledQuality);
	assertEquals(enabledQuality.allowed, true);

	const mappedScore = transformed.formatItems.find((item) => item.format === 101);
	assertExists(mappedScore);
	assertEquals(mappedScore.score, 25);

	const zeroScore = transformed.formatItems.find((item) => item.format === 202);
	assertExists(zeroScore);
	assertEquals(zeroScore.score, 0);
});

Deno.test('language support metadata keeps lidarr disabled for language conditions', () => {
	const languages = getLanguagesWithSupport();
	const english = languages.find((entry) => entry.name === 'English');
	assertExists(english);
	assertEquals(english.lidarr, false);
});
