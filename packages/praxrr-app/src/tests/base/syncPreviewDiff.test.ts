import { assertEquals } from '@std/assert';
import { diffToFieldChanges } from '../../lib/server/sync/preview/diff.ts';

Deno.test('diffToFieldChanges ignores deep-equal nested object snapshots', () => {
	const current = {
		profile: {
			name: 'Example',
			rules: [
				{ key: 'minimumScore', value: 100 },
				{ key: 'upgradeAllowed', value: true }
			]
		}
	};
	const desired = {
		profile: {
			name: 'Example',
			rules: [
				{ key: 'minimumScore', value: 100 },
				{ key: 'upgradeAllowed', value: true }
			]
		}
	};

	assertEquals(diffToFieldChanges(current, desired), []);
});

Deno.test('diffToFieldChanges ignores deep-equal arrays with distinct references', () => {
	const current = {
		items: [
			{ name: 'Alpha', tags: ['x', 'y'] },
			{ name: 'Beta', tags: ['z'] }
		]
	};
	const desired = {
		items: [
			{ name: 'Alpha', tags: ['x', 'y'] },
			{ name: 'Beta', tags: ['z'] }
		]
	};

	assertEquals(diffToFieldChanges(current, desired), []);
});

Deno.test('diffToFieldChanges key strategy avoids order-based false positives', () => {
	const current = {
		formatItems: [
			{ format: 1, score: 10 },
			{ format: 2, score: 20 }
		]
	};
	const desired = {
		formatItems: [
			{ format: 2, score: 20 },
			{ format: 1, score: 10 }
		]
	};

	const changes = diffToFieldChanges(current, desired, {
		arrayKeyStrategies: [
			{
				path: 'formatItems',
				selectKey: (item) => String(item.format ?? '')
			}
		]
	});

	assertEquals(changes, []);
});

Deno.test('diffToFieldChanges still reports scalar leaf changes', () => {
	const current = { enabled: true, retries: 1 };
	const desired = { enabled: false, retries: 1 };

	assertEquals(diffToFieldChanges(current, desired), [
		{
			field: 'enabled',
			type: 'changed',
			current: true,
			desired: false
		}
	]);
});
