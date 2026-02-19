import { assertEquals, assertThrows } from '@std/assert';
import {
	parseArrInstanceEnvVars,
	parseEnabledFromEnv,
	parseTagsFromEnv,
} from '../../lib/server/utils/arr/envInstances.ts';

const APP_INSTANCE_ENV_KEY_RE =
	/^([A-Z]+)_INSTANCE_(URL|API_KEY|NAME|EXTERNAL_URL|TAGS|ENABLED)_(\d+)$/;

function withEnvVars(variables: Record<string, string>, test: () => void): void {
	const originalEnv = Deno.env.toObject();
	const managedKeys = Object.keys(originalEnv).filter((key) => APP_INSTANCE_ENV_KEY_RE.test(key));
	const restoredKeys: Record<string, string | undefined> = {};

	for (const key of managedKeys) {
		restoredKeys[key] = originalEnv[key];
		Deno.env.delete(key);
	}

	for (const [key, value] of Object.entries(variables)) {
		Deno.env.set(key, value);
	}

	try {
		test();
	} finally {
		for (const key of Object.keys(restoredKeys)) {
			Deno.env.delete(key);
		}

		for (const [key, value] of Object.entries(restoredKeys)) {
			if (value !== undefined) {
				Deno.env.set(key, value);
			}
		}
	}
}

Deno.test('parseArrInstanceEnvVars: skips instances with missing required fields', () => {
	withEnvVars({
		RADARR_INSTANCE_URL_1: 'http://radarr.local:7878',
	}, () => {
		assertEquals(parseArrInstanceEnvVars(), []);
	});

	withEnvVars({
		RADARR_INSTANCE_API_KEY_1: 'radarr-key-1',
	}, () => {
		assertEquals(parseArrInstanceEnvVars(), []);
	});
});

Deno.test('parseArrInstanceEnvVars: parses sparse indices with deterministic ordering', () => {
	withEnvVars({
		RADARR_INSTANCE_URL_1: 'http://radarr-1.local:7878',
		RADARR_INSTANCE_API_KEY_1: 'radarr-key-1',
		RADARR_INSTANCE_NAME_1: 'Movies',
		RADARR_INSTANCE_URL_3: 'http://radarr-3.local:7878',
		RADARR_INSTANCE_API_KEY_3: 'radarr-key-3',
		RADARR_INSTANCE_TAGS_3: 'new, quality',
	}, () => {
		const first = parseArrInstanceEnvVars();
		const second = parseArrInstanceEnvVars();

		assertEquals(first, [
			{
				type: 'radarr',
				index: 1,
				url: 'http://radarr-1.local:7878',
				apiKey: 'radarr-key-1',
				name: 'Movies',
				externalUrl: null,
				tags: [],
				enabled: true,
			},
			{
				type: 'radarr',
				index: 3,
				url: 'http://radarr-3.local:7878',
				apiKey: 'radarr-key-3',
				name: 'Radarr 3',
				externalUrl: null,
				tags: ['new', 'quality'],
				enabled: true,
			},
		]);
		assertEquals(second, first);
	});
});

Deno.test('parseTagsFromEnv: normalizes comma-separated tag strings', () => {
	assertEquals(parseTagsFromEnv('movies, quality, 4k,,local'), ['movies', 'quality', '4k', 'local']);
	assertEquals(parseTagsFromEnv(undefined), []);
});

Deno.test('parseArrInstanceEnvVars: rejects invalid URLs and preserves explicit URL parse failures as skips', () => {
	withEnvVars({
		RADARR_INSTANCE_URL_1: 'not a valid url',
		RADARR_INSTANCE_API_KEY_1: 'radarr-key-1',
	}, () => {
		assertEquals(parseArrInstanceEnvVars(), []);
	});

	withEnvVars({
		RADARR_INSTANCE_URL_1: 'http://radarr.local:7878',
		RADARR_INSTANCE_API_KEY_1: 'radarr-key-1',
		RADARR_INSTANCE_EXTERNAL_URL_1: 'ftp://radarr.local',
	}, () => {
		const parsed = parseArrInstanceEnvVars();
		assertEquals(parsed.length, 1);
		assertEquals(parsed[0].externalUrl, null);
	});
});

Deno.test('parseArrInstanceEnvVars: rejects unsupported arr app types', () => {
	withEnvVars({
		UNKNOWN_INSTANCE_URL_1: 'http://example.local:7878',
		UNKNOWN_INSTANCE_API_KEY_1: 'ignored-key',
	}, () => {
		assertThrows(
			() => parseArrInstanceEnvVars(),
			Error,
			'Unsupported arr app type in env var key: UNKNOWN'
		);
	});
});

Deno.test('parseEnabledFromEnv: normalizes common bool-like values', () => {
	assertEquals(parseEnabledFromEnv('false'), false);
	assertEquals(parseEnabledFromEnv('0'), false);
	assertEquals(parseEnabledFromEnv('true'), true);
	assertEquals(parseEnabledFromEnv('1'), true);
	assertEquals(parseEnabledFromEnv(undefined), true);
});
