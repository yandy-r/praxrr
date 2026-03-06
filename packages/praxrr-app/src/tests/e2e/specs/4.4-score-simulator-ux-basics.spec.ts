import { expect, type Page, type Route, test } from "@playwright/test";

const E2E_USERNAME = process.env.E2E_USERNAME;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

const SINGLE_RELEASE_TITLE = "E2E.UX.ALPHA.2024.1080p.WEB";
const BATCH_ALPHA_TITLE = "E2E.UX.BATCH.ALPHA.2024.1080p.WEB";
const BATCH_BETA_TITLE = "E2E.UX.BATCH.BETA.2024.1080p.WEB";

interface ProfileContext {
  databaseId: number;
  profileName: string;
}

interface SimulateRequestBody {
  releases?: Array<{ id: string; title: string; type: "movie" | "series" }>;
  profileNames?: string[];
}

function buildContributions(
  title: string,
): Array<{ cfName: string; score: number }> {
  const upper = title.toUpperCase();
  if (upper.includes("ALPHA")) {
    return [
      { cfName: "CF Alpha", score: 120 },
      { cfName: "CF Shared", score: 30 },
    ];
  }

  if (upper.includes("BETA")) {
    return [{ cfName: "CF Beta", score: 110 }];
  }

  return [{ cfName: "CF Base", score: 100 }];
}

function buildSimulateResponse(body: SimulateRequestBody) {
  const releases = body.releases ?? [];
  const profileNames = body.profileNames && body.profileNames.length > 0
    ? body.profileNames
    : ["pcd:E2E Profile"];

  return {
    parserAvailable: false,
    results: releases.map((release) => {
      const contributions = buildContributions(release.title);
      const totalScore = contributions.reduce(
        (sum, contribution) => sum + contribution.score,
        0,
      );

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
  const requestBody =
    (route.request().postDataJSON() ?? {}) as SimulateRequestBody;
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(buildSimulateResponse(requestBody)),
  });
}

async function installSimulationMocks(page: Page): Promise<void> {
  await page.route("**/api/v1/parser/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ parserAvailable: false }),
    });
  });

  await page.route("**/api/v1/simulate/score", handleSimulateRoute);
}

async function setupClipboardMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const writes: string[] = [];
    (window as { __praxrrClipboardWrites?: string[] }).__praxrrClipboardWrites =
      writes;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText(value: string) {
          writes.push(value);
          return Promise.resolve();
        },
      },
    });
  });
}

async function getClipboardWrites(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    return (window as { __praxrrClipboardWrites?: string[] })
      .__praxrrClipboardWrites ?? [];
  });
}

async function ensureAuthenticated(page: Page): Promise<void> {
  await page.goto("/settings/general");
  await page.waitForLoadState("networkidle");

  if (
    page.url().includes("/settings/general") ||
    page.url().includes("/settings/security")
  ) {
    return;
  }

  if (page.url().includes("/auth/setup")) {
    if (!E2E_USERNAME || !E2E_PASSWORD) {
      test.skip(
        "AUTH is required. Set E2E_USERNAME and E2E_PASSWORD to run auth-gated UI e2e tests.",
      );
    }

    await page.getByRole("textbox", { name: "Username" }).fill(E2E_USERNAME!);
    await page.getByLabel("Password").fill(E2E_PASSWORD!);
    await page.getByLabel("Confirm Password").fill(E2E_PASSWORD!);
    await page.getByRole("button", { name: "Create Account" }).click();
    await page.waitForLoadState("networkidle");
  }

  if (page.url().includes("/auth/login")) {
    if (!E2E_USERNAME || !E2E_PASSWORD) {
      test.skip(
        "AUTH is required. Set E2E_USERNAME and E2E_PASSWORD to run auth-gated UI e2e tests.",
      );
    }

    await page.getByRole("textbox", { name: "Username" }).fill(E2E_USERNAME!);
    await page.getByLabel("Password").fill(E2E_PASSWORD!);
    await page.getByRole("button", { name: "Sign In" }).click();
    await page.waitForLoadState("networkidle");
  }
}

async function findQualityProfileContext(
  page: Page,
): Promise<ProfileContext | null> {
  await page.goto("/quality-profiles");
  await page.waitForLoadState("networkidle");

  const dbMatch = page.url().match(/\/quality-profiles\/(\d+)/);
  if (!dbMatch) {
    return null;
  }

  const firstRow = page.locator("table tbody tr").first();
  if ((await firstRow.count()) === 0) {
    return null;
  }

  const profileName = (await firstRow.locator("td").first().innerText()).trim();
  if (!profileName) {
    return null;
  }

  return {
    databaseId: Number.parseInt(dbMatch[1], 10),
    profileName,
  };
}

test.describe("4.4 Score Simulator UX basics", () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    await setupClipboardMock(page);
    await installSimulationMocks(page);
    await ensureAuthenticated(page);
  });

  test("first-run quick-start shows 3 steps and Try example release primes simulation input", async ({ page }) => {
    const context = await findQualityProfileContext(page);
    if (!context) {
      test.skip("No quality profile context found for quick-start UX checks.");
    }

    await page.goto(`/score-simulator/${context!.databaseId}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "Start in 3 steps" }))
      .toBeVisible();
    await expect(page.getByText("1. Choose profile")).toBeVisible();
    await expect(page.getByText("2. Paste release title")).toBeVisible();
    await expect(page.getByText("3. Run simulation")).toBeVisible();
    await expect(page.locator("#score-simulator-title")).toHaveValue("");

    await page.getByRole("button", { name: "Try example release" }).click();
    await expect(page.locator("#score-simulator-title")).not.toHaveValue("");
    await expect(page.getByRole("heading", { name: "Start in 3 steps" }))
      .toBeVisible();

    const releaseInputCard = page
      .locator("div.rounded-lg")
      .filter({ has: page.getByRole("heading", { name: "Single Release Score Simulation" }) })
      .first();
    await releaseInputCard.getByRole("button", {
      name: "Select quality profile...",
    }).click();
    await page.getByRole("button", { name: context!.profileName, exact: true })
      .click();
    await releaseInputCard.getByRole("button", { name: "Simulate" }).click();

    await expect(page.getByText("Total Score").first()).toBeVisible();
    await expect(page.getByText("Current:").first()).toBeVisible();
  });

  test("decision summary appears after simulation and updates when overrides change total", async ({ page }) => {
    const context = await findQualityProfileContext(page);
    if (!context) {
      test.skip(
        "No quality profile context found for decision summary checks.",
      );
    }

    const simulatorUrl = `/score-simulator/${context!.databaseId}?profile=${
      encodeURIComponent(`pcd:${context!.profileName}`)
    }&arrType=radarr`;
    await page.goto(simulatorUrl);
    await page.waitForLoadState("networkidle");

    await page.locator("#score-simulator-title").fill(SINGLE_RELEASE_TITLE);
    await page.getByRole("button", { name: "Simulate" }).last().click();

    const scoreBreakdown = page
      .locator("div.rounded-lg")
      .filter({ has: page.getByText("Total Score") })
      .first();
    const alphaRow = scoreBreakdown.locator("li", { hasText: "CF Alpha" })
      .first();

    await expect(alphaRow).toBeVisible();
    await expect(
      scoreBreakdown.getByText("This release meets your upgrade target."),
    ).toBeVisible();
    await expect(scoreBreakdown.getByText(/Current:\s*150/)).toBeVisible();

    await alphaRow.locator("button").first().click();
    const alphaInput = alphaRow.locator('input[type="number"]');
    await alphaInput.fill("40");
    await alphaInput.blur();

    await expect(alphaRow).toHaveClass(/bg-amber-50/);
    await expect(scoreBreakdown.getByText("This release would not be grabbed."))
      .toBeVisible();
    await expect(scoreBreakdown.getByText(/Current:\s*70/)).toBeVisible();
    await expect(scoreBreakdown.getByText(/Remaining to Minimum:\s*30/))
      .toBeVisible();
  });

  test("share safety: full link keeps title/batch while safe link excludes title/batch", async ({ page }) => {
    const context = await findQualityProfileContext(page);
    if (!context) {
      test.skip("No quality profile context found for share safety checks.");
    }

    const simulatorUrl = `/score-simulator/${context!.databaseId}?profile=${
      encodeURIComponent(`pcd:${context!.profileName}`)
    }&arrType=radarr`;
    await page.goto(simulatorUrl);
    await page.waitForLoadState("networkidle");

    await page.locator("#score-simulator-title").fill(SINGLE_RELEASE_TITLE);
    await page.getByRole("button", { name: "Simulate" }).last().click();

    const scoreBreakdown = page
      .locator("div.rounded-lg")
      .filter({ has: page.getByText("Total Score") })
      .first();
    const alphaRow = scoreBreakdown.locator("li", { hasText: "CF Alpha" })
      .first();
    await alphaRow.locator("button").first().click();
    await alphaRow.locator('input[type="number"]').fill("40");
    await alphaRow.locator('input[type="number"]').blur();

    await page.getByRole("button", { name: "Show Advanced" }).click();
    await page.locator("#batch-input-textarea").fill(
      `${BATCH_ALPHA_TITLE}\n${BATCH_BETA_TITLE}`,
    );

    await page.getByRole("button", { name: "Copy Full Link" }).click();
    await expect(
      page.locator('div[role="button"]').filter({
        hasText: "Full link copied to clipboard.",
      }).last(),
    ).toBeVisible();

    const fullLinkWrites = await getClipboardWrites(page);
    expect(fullLinkWrites.length).toBeGreaterThan(0);
    const fullLink = fullLinkWrites.at(-1);
    expect(fullLink).toBeTruthy();
    expect(fullLink!).toContain("title=");
    expect(fullLink!).toContain("batch=");
    expect(fullLink!).toContain("overrides=");

    await page.getByRole("button", { name: "Copy Safe Link" }).click();
    await expect(
      page.locator('div[role="button"]').filter({
        hasText: "Safe link copied to clipboard.",
      }).last(),
    ).toBeVisible();

    const safeLinkWrites = await getClipboardWrites(page);
    expect(safeLinkWrites.length).toBeGreaterThan(1);
    const safeLink = safeLinkWrites.at(-1);
    expect(safeLink).toBeTruthy();
    expect(safeLink!).not.toContain("title=");
    expect(safeLink!).not.toContain("batch=");
    expect(safeLink!).toContain("profile=");
    expect(safeLink!).toContain("overrides=");
  });

  test("mobile 390x844 supports override edit/reset controls without horizontal scrolling", async ({ page }) => {
    const context = await findQualityProfileContext(page);
    if (!context) {
      test.skip(
        "No quality profile context found for mobile ergonomics checks.",
      );
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const simulatorUrl = `/score-simulator/${context!.databaseId}?profile=${
      encodeURIComponent(`pcd:${context!.profileName}`)
    }&arrType=radarr`;
    await page.goto(simulatorUrl);
    await page.waitForLoadState("networkidle");

    await page.locator("#score-simulator-title").fill(SINGLE_RELEASE_TITLE);
    await page.getByRole("button", { name: "Simulate" }).last().click();

    const scoreBreakdown = page
      .locator("div.rounded-lg")
      .filter({ has: page.getByText("Total Score") })
      .first();
    const alphaRow = scoreBreakdown.locator("li", { hasText: "CF Alpha" })
      .first();
    const editControl = alphaRow.locator("button").first();

    await expect(alphaRow).toBeVisible();
    await expect(editControl).toBeVisible();
    await editControl.click();
    await expect(alphaRow.locator('input[type="number"]')).toBeVisible();
    await alphaRow.locator('input[type="number"]').fill("40");
    await alphaRow.locator('input[type="number"]').blur();

    const resetControl = alphaRow.getByRole("button", {
      name: /Reset override for CF Alpha/,
    });
    await expect(resetControl).toBeVisible();
    await resetControl.click();
    await expect(alphaRow).not.toHaveClass(/bg-amber-50/);

    const hasHorizontalOverflow = await page.evaluate(() => {
      const rootWidth = document.documentElement.scrollWidth;
      const bodyWidth = document.body.scrollWidth;
      return Math.max(rootWidth, bodyWidth) > window.innerWidth + 1;
    });
    expect(hasHorizontalOverflow).toBe(false);
  });
});
