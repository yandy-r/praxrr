import { expect, test, type Page, type Route } from '@playwright/test';

const E2E_USERNAME = process.env.E2E_USERNAME;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

const SINGLE_RELEASE_TITLE = 'E2E.WHATIF.ALPHA.2024.1080p.WEB-DL.x264-GRP';
const BATCH_ALPHA_TITLE = 'E2E.WHATIF.ALPHA.BATCH.2024.1080p.WEB';
const BATCH_BETA_TITLE = 'E2E.WHATIF.BETA.BATCH.2024.1080p.WEB';

interface ProfileContext {
	databaseId: number;
	profileName: string;
}

interface SimulateRequestBody {
	releases?: Array<{ id: string; title: string; type: 'movie' | 'series' }>;
	profileNames?: string[];
}

function buildContributions(title: string): Array<{ cfName: string; score: number }> {
	const upper = title.toUpperCase();
	if (upper.includes('BETA')) {
		return [{ cfName: 'CF Beta', score: 110 }];
	}

	if (upper.includes('ALPHA')) {
		return [
			{ cfName: 'CF Alpha', score: 120 },
			{ cfName: 'CF Shared', score: 30 },
		];
	}

	return [{ cfName: 'CF Alpha', score: 100 }];
}

function buildSimulateResponse(body: SimulateRequestBody) {
	const releases = body.releases ?? [];
	const profileNames = body.profileNames && body.profileNames.length > 0 ? body.profileNames : ['pcd:E2E Profile'];

	return {
		parserAvailable: false,
		results: releases.map((release) => {
			const contributions = buildContributions(release.title);
			const totalScore = contributions.reduce((sum, contribution) => sum + contribution.score, 0);

			return {
				id: release.id,
				title: release.title,
				parsed: null,
				cfMatches: contributions.map((contribution) => ({
					name: contribution.cfName,
					matches: true,
					conditions: [],
				})),
				profileScores: profileNames.map((profileName) => ({
					profileName,
					totalScore,
					minimumScore: 100,
					upgradeUntilScore: 150,
					contributions,
				})),
			};
		}),
	};
}

async function handleSimulateRoute(route: Route): Promise<void> {
	const requestBody = (route.request().postDataJSON() ?? {}) as SimulateRequestBody;
	await route.fulfill({
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify(buildSimulateResponse(requestBody)),
	});
}

async function installSimulationMocks(page: Page): Promise<void> {
	await page.route('**/api/v1/parser/health', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ parserAvailable: false }),
		});
	});

	await page.route('**/api/v1/simulate/score', handleSimulateRoute);
}

async function ensureAuthenticated(page: Page): Promise<void> {
	await page.goto('/settings/general');
	await page.waitForLoadState('networkidle');

	if (page.url().includes('/settings/general') || page.url().includes('/settings/security')) {
		return;
	}

	if (page.url().includes('/auth/setup')) {
		if (!E2E_USERNAME || !E2E_PASSWORD) {
			test.skip('AUTH is required. Set E2E_USERNAME and E2E_PASSWORD to run auth-gated UI e2e tests.');
		}

		await page.getByRole('textbox', { name: 'Username' }).fill(E2E_USERNAME!);
		await page.getByLabel('Password').fill(E2E_PASSWORD!);
		await page.getByLabel('Confirm Password').fill(E2E_PASSWORD!);
		await page.getByRole('button', { name: 'Create Account' }).click();
		await page.waitForLoadState('networkidle');
	}

	if (page.url().includes('/auth/login')) {
		if (!E2E_USERNAME || !E2E_PASSWORD) {
			test.skip('AUTH is required. Set E2E_USERNAME and E2E_PASSWORD to run auth-gated UI e2e tests.');
		}

		await page.getByRole('textbox', { name: 'Username' }).fill(E2E_USERNAME!);
		await page.getByLabel('Password').fill(E2E_PASSWORD!);
		await page.getByRole('button', { name: 'Sign In' }).click();
		await page.waitForLoadState('networkidle');
	}
}

async function findQualityProfileContext(page: Page): Promise<ProfileContext | null> {
	await page.goto('/quality-profiles');
	await page.waitForLoadState('networkidle');

	const dbMatch = page.url().match(/\/quality-profiles\/(\d+)/);
	if (!dbMatch) {
		return null;
	}

	const firstRow = page.locator('table tbody tr').first();
	if ((await firstRow.count()) === 0) {
		return null;
	}

	const profileName = (await firstRow.locator('td').first().innerText()).trim();
	if (!profileName) {
		return null;
	}

	return {
		databaseId: Number.parseInt(dbMatch[1], 10),
		profileName,
	};
}

test.describe('4.2 Score Simulator what-if overrides', () => {
	test.describe.configure({ timeout: 120_000 });

	test.beforeEach(async ({ page }) => {
		await installSimulationMocks(page);
		await ensureAuthenticated(page);
	});

	test('overrides recalculate totals, move thresholds, reset cleanly, and re-rank batch results', async ({ page }) => {
		const context = await findQualityProfileContext(page);
		if (!context) {
			test.skip('No quality profile context found for score simulator what-if workflow.');
		}

		const simulatorUrl = `/score-simulator/${context!.databaseId}?profile=${encodeURIComponent(`pcd:${context!.profileName}`)}&arrType=radarr`;
		await page.goto(simulatorUrl);
		await page.waitForLoadState('networkidle');

		await expect(page.getByText(/Parser service unavailable/i).first()).toBeVisible();

		await page.locator('#score-simulator-title').fill(SINGLE_RELEASE_TITLE);
		await page.getByRole('button', { name: 'Simulate' }).last().click();

		const scoreBreakdown = page
			.locator('div.rounded-lg')
			.filter({ has: page.getByText('Total Score') })
			.first();
		const alphaRow = scoreBreakdown.locator('li', { hasText: 'CF Alpha' }).first();
		const sharedRow = scoreBreakdown.locator('li', { hasText: 'CF Shared' }).first();

		await expect(alphaRow).toBeVisible();
		await expect(page.getByText('Upgrade Until Reached').first()).toBeVisible();
		await expect(scoreBreakdown.getByText(/Current:\s*150/)).toBeVisible();

		await alphaRow.locator('button').first().click();
		const alphaInput = alphaRow.locator('input[type="number"]');
		await alphaInput.fill('40');
		await alphaInput.blur();

		await expect(alphaRow).toHaveClass(/bg-amber-50/);
		await expect(alphaRow.locator('span.line-through')).toContainText('120');
		await expect(alphaRow.getByText('-80')).toBeVisible();
		await expect(scoreBreakdown.getByText(/Current:\s*70/)).toBeVisible();
		await expect(page.getByText('Below Minimum').first()).toBeVisible();

		await alphaRow.getByRole('button', { name: /Reset override for CF Alpha/ }).click();
		await expect(alphaRow).not.toHaveClass(/bg-amber-50/);
		await expect(scoreBreakdown.getByText(/Current:\s*150/)).toBeVisible();
		await expect(page.getByText('Upgrade Until Reached').first()).toBeVisible();

		await alphaRow.locator('button').first().click();
		await alphaRow.locator('input[type="number"]').fill('80');
		await alphaRow.locator('input[type="number"]').blur();
		await sharedRow.locator('button').first().click();
		await sharedRow.locator('input[type="number"]').fill('10');
		await sharedRow.locator('input[type="number"]').blur();
		await expect(scoreBreakdown.getByText('2 overrides')).toBeVisible();

		await scoreBreakdown.getByRole('button', { name: 'Reset All' }).click();
		await expect(scoreBreakdown.getByText(/Current:\s*150/)).toBeVisible();
		await expect(scoreBreakdown.getByText('2 overrides')).toHaveCount(0);

		await page.getByRole('button', { name: 'Show Advanced' }).click();
		await page.locator('#batch-input-textarea').fill(`${BATCH_ALPHA_TITLE}\n${BATCH_BETA_TITLE}`);

		await page.getByRole('button', { name: 'Select quality profile...' }).last().click();
		await page.getByRole('button', { name: context!.profileName, exact: true }).click();
		await page.getByRole('button', { name: 'Simulate All' }).click();

		const batchResults = page
			.locator('div')
			.filter({ has: page.getByRole('heading', { name: 'Batch Results' }) })
			.first();
		const batchRows = batchResults.locator('table tbody tr');

		await expect(batchRows.first()).toContainText(BATCH_ALPHA_TITLE);

		await alphaRow.locator('button').first().click();
		await alphaRow.locator('input[type="number"]').fill('-200');
		await alphaRow.locator('input[type="number"]').blur();

		await expect(batchResults.getByText('Ranked with 1 overrides')).toBeVisible();
		await expect(batchRows.first()).toContainText(BATCH_BETA_TITLE);
	});
});
