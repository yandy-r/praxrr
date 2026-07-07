import { assertEquals } from '@std/assert';
import { tierToDefaultMode } from '$shared/complexity/tiers.ts';
import {
	resolveDisclosureInitialMode,
	resolveTierDrivenMode,
	shouldBlockTierUpdates
} from '$lib/client/ui/form/disclosureSectionLogic.ts';

Deno.test('DisclosureSection precedence uses tier default when persisted=false', () => {
	const beginner = resolveDisclosureInitialMode(undefined, 'beginner', tierToDefaultMode);
	assertEquals(beginner.resolvedInitialMode, 'basic');

	const advanced = resolveDisclosureInitialMode(undefined, 'advanced', tierToDefaultMode);
	assertEquals(advanced.resolvedInitialMode, 'advanced');

	const tierDriven = resolveTierDrivenMode(
		'intermediate',
		tierToDefaultMode,
		beginner.hasExplicitInitialMode,
		false
	);
	assertEquals(tierDriven, 'basic');
});

Deno.test('DisclosureSection precedence blocks tier updates when disclosure is persisted', () => {
	assertEquals(shouldBlockTierUpdates(false, true), true);
	assertEquals(
		resolveTierDrivenMode('advanced', tierToDefaultMode, false, true),
		null
	);
});

Deno.test('DisclosureSection precedence blocks tier updates when initialMode is explicit', () => {
	const { hasExplicitInitialMode, resolvedInitialMode } = resolveDisclosureInitialMode(
		'basic',
		'advanced',
		tierToDefaultMode
	);

	assertEquals(hasExplicitInitialMode, true);
	assertEquals(resolvedInitialMode, 'basic');
	assertEquals(
		resolveTierDrivenMode('advanced', tierToDefaultMode, hasExplicitInitialMode, false),
		null
	);
});

Deno.test('DisclosureSection precedence stops tier updates after manual toggle persists', () => {
	let preferencePersisted = false;
	let mode = resolveTierDrivenMode('beginner', tierToDefaultMode, false, preferencePersisted);
	assertEquals(mode, 'basic');

	mode = 'advanced';
	preferencePersisted = true;

	const tierUpdate = resolveTierDrivenMode('advanced', tierToDefaultMode, false, preferencePersisted);
	assertEquals(tierUpdate, null);
	assertEquals(mode, 'advanced');
});
