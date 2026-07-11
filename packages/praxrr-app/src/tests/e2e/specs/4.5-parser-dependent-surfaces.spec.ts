import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const E2E_USERNAME = process.env.E2E_USERNAME;
const E2E_PASSWORD = process.env.E2E_PASSWORD;
const PARSER_URL = process.env.E2E_PARSER_URL ?? 'http://127.0.0.1:5000';
const REPO_ROOT = process.cwd();
const PARSER_PACKAGE = path.join(REPO_ROOT, 'packages/praxrr-parser');
const PARSER_BINARY = path.join(
  REPO_ROOT,
  'dist/test/e2e',
  `praxrr-parser-${process.pid}${process.platform === 'win32' ? '.exe' : ''}`
);

let parserProcess: ChildProcess | null = null;
let ownsParserProcess = false;

async function parserHealth(): Promise<{ status: string; version: string } | null> {
  try {
    const response = await fetch(`${PARSER_URL}/health`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as { status: string; version: string };
  } catch {
    return null;
  }
}

async function waitForParser(expectedAvailable: boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (Boolean(await parserHealth()) === expectedAvailable) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Go parser did not become ${expectedAvailable ? 'ready' : 'unavailable'} within ${timeoutMs}ms`);
}

async function startGoParser(): Promise<void> {
  const existing = await parserHealth();
  if (existing) {
    expect(existing.version).toMatch(/go/i);
    ownsParserProcess = false;
    return;
  }

  await mkdir(path.dirname(PARSER_BINARY), { recursive: true });
  const build = spawn('go', ['build', '-o', PARSER_BINARY, './cmd/praxrr-parser'], {
    cwd: PARSER_PACKAGE,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let buildError = '';
  build.stderr?.on('data', (chunk: Buffer) => (buildError += chunk.toString()));
  const buildCode = await new Promise<number | null>((resolve) => build.once('exit', resolve));
  if (buildCode !== 0) {
    throw new Error(`Failed to build Go parser: ${buildError}`);
  }

  parserProcess = spawn(PARSER_BINARY, [], {
    env: { ...process.env, PARSER_ADDR: new URL(PARSER_URL).host },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  ownsParserProcess = true;

  let stderr = '';
  parserProcess.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
    stderr = stderr.slice(-4_000);
  });
  parserProcess.once('exit', (code) => {
    if (code && code !== 0 && !(stderr.includes('signal') && !ownsParserProcess)) {
      console.error(`Go parser exited with ${code}: ${stderr}`);
    }
  });
  await waitForParser(true);
  const health = await parserHealth();
  expect(health?.version).toMatch(/go/i);
}

async function stopOwnedParser(): Promise<void> {
  if (!ownsParserProcess || !parserProcess) {
    await rm(PARSER_BINARY, { force: true });
    return;
  }
  const child = parserProcess;
  ownsParserProcess = false;
  parserProcess = null;

  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 5_000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
  await waitForParser(false, 10_000);
  await rm(PARSER_BINARY, { force: true });
}

async function ensureAuthenticated(page: Page): Promise<void> {
  await page.goto('/settings/general');
  await page.waitForLoadState('networkidle');
  if (page.url().includes('/settings/general') || page.url().includes('/settings/security')) return;

  if (page.url().includes('/auth/setup')) {
    if (!E2E_USERNAME || !E2E_PASSWORD) {
      test.skip(true, 'AUTH is required. Set E2E_USERNAME and E2E_PASSWORD to run parser UI e2e tests.');
    }
    await page.getByRole('textbox', { name: 'Username' }).fill(E2E_USERNAME!);
    await page.getByLabel('Password').fill(E2E_PASSWORD!);
    await page.getByLabel('Confirm Password').fill(E2E_PASSWORD!);
    await page.getByRole('button', { name: 'Create Account' }).click();
    await page.waitForLoadState('networkidle');
  }

  if (page.url().includes('/auth/login')) {
    if (!E2E_USERNAME || !E2E_PASSWORD) {
      test.skip(true, 'AUTH is required. Set E2E_USERNAME and E2E_PASSWORD to run parser UI e2e tests.');
    }
    await page.getByRole('textbox', { name: 'Username' }).fill(E2E_USERNAME!);
    await page.getByLabel('Password').fill(E2E_PASSWORD!);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForLoadState('networkidle');
  }
}

async function databaseIdFrom(page: Page, route: string): Promise<number | null> {
  await page.goto(route);
  await page.waitForLoadState('networkidle');
  await page.waitForURL(new RegExp(`${route}/\\d+`), { timeout: 15_000 }).catch(() => undefined);
  const match = new URL(page.url()).pathname.match(new RegExp(`^${route}/(\\d+)`));
  return match ? Number.parseInt(match[1], 10) : null;
}

test.describe('4.5 parser-dependent surfaces', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  test.beforeAll(async () => {
    await startGoParser();
  });

  test.afterAll(async () => {
    await stopOwnedParser();
  });

  test.beforeEach(async ({ page }) => {
    await ensureAuthenticated(page);
  });

  test('real Go health, parse, match, invalid-pattern, and bounded-timeout contracts stay distinct', async ({
    request,
  }) => {
    const appHealth = await request.get('/api/v1/parser/health');
    expect(appHealth.ok()).toBe(true);
    expect(await appHealth.json()).toEqual({ parserAvailable: true });

    const domainMiss = await fetch(`${PARSER_URL}/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'plain title without release metadata',
        type: 'movie',
      }),
    });
    expect(domainMiss.status).toBe(200);
    expect(await domainMiss.json()).toMatchObject({
      title: 'plain title without release metadata',
    });

    const invalidRequest = await fetch(`${PARSER_URL}/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '', type: 'movie' }),
    });
    expect(invalidRequest.status).toBe(400);

    const invalidPattern = '[';
    const invalidMatch = await fetch(`${PARSER_URL}/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'release', patterns: [invalidPattern] }),
    });
    expect(invalidMatch.status).toBe(200);
    expect(await invalidMatch.json()).toEqual({
      results: { [invalidPattern]: false },
    });

    const timeoutPattern = '(a+)+$';
    const startedAt = Date.now();
    const timedMatch = await fetch(`${PARSER_URL}/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `${'a'.repeat(999)}!`,
        patterns: [timeoutPattern],
      }),
    });
    expect(timedMatch.status).toBe(200);
    expect(await timedMatch.json()).toEqual({
      results: { [timeoutPattern]: false },
    });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  test('score and impact surfaces preserve inputs and recover from a bounded Go outage', async ({ page, request }) => {
    if (!ownsParserProcess) {
      test.skip(true, 'The parser was supplied externally, so this test cannot stop and restart that process safely.');
    }

    const scoreDatabaseId = await databaseIdFrom(page, '/score-simulator');
    if (!scoreDatabaseId) {
      test.skip(true, 'No configured database is available for parser surface checks.');
    }

    await stopOwnedParser();
    await expect
      .poll(async () => (await request.get('/api/v1/parser/health')).json(), {
        timeout: 10_000,
      })
      .toEqual({ parserAvailable: false });

    await page.goto(`/score-simulator/${scoreDatabaseId}`);
    await page.waitForLoadState('networkidle');
    const scoreInput = page.locator('#score-simulator-title');
    await scoreInput.fill('Recovery.Movie.2024.1080p.WEB-DL-GROUP');
    await scoreInput.focus();
    await expect(page.getByText('Parser service unavailable. Score simulation requires parser output')).toBeVisible();
    await expect(scoreInput).toBeFocused();

    const impactDatabaseId = await databaseIdFrom(page, '/impact-simulator');
    expect(impactDatabaseId).toBe(scoreDatabaseId);
    const impactInput = page.locator('#impact-release-titles');
    await impactInput.fill('Recovery.Movie.2024.1080p.WEB-DL-GROUP');
    await expect(page.getByText(/Parser service unavailable — release scoring is disabled/)).toBeVisible();

    await startGoParser();
    await expect
      .poll(async () => (await request.get('/api/v1/parser/health')).json(), {
        timeout: 10_000,
      })
      .toEqual({ parserAvailable: true });
    await expect(page.getByText(/Parser service unavailable — release scoring is disabled/)).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(impactInput).toHaveValue('Recovery.Movie.2024.1080p.WEB-DL-GROUP');
  });

  test('custom-format, entity-testing, and regex101 direct consumers remain reachable with Go healthy', async ({
    page,
    request,
  }) => {
    const entityDatabaseId = await databaseIdFrom(page, '/quality-profiles/entity-testing');
    if (!entityDatabaseId) {
      test.skip(true, 'No configured database is available for entity-testing checks.');
    }
    await expect(page.getByText('Parser service unavailable')).toHaveCount(0);

    await page.goto('/custom-formats');
    await page.waitForLoadState('networkidle');
    const customFormatLink = page.locator('a[href^="/custom-formats/"]').first();
    if ((await customFormatLink.count()) > 0) {
      const customFormatHref = await customFormatLink.getAttribute('href');
      expect(customFormatHref).toMatch(/^\/custom-formats\/\d+\/\d+$/);
      await customFormatLink.focus();
      await expect(customFormatLink).toBeFocused();
      await page.goto(`${customFormatHref}/testing`);
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('Parser service unavailable')).toHaveCount(0);
    }

    const regex101 = await request.get('/api/regex101/__praxrr_e2e_missing__%2F1');
    expect(regex101.status()).toBeGreaterThanOrEqual(400);
    expect(regex101.status()).toBeLessThan(600);
  });
});
