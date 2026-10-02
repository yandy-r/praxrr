/**
 * Capture and frame the README / docs-site screenshots.
 *
 * Drives a running Praxrr instance with Playwright, captures each showcase view at 2x, then
 * composites every capture into a branded window frame (plus a hero collage) under
 * `docs/site/src/assets/screenshots/`. The README and the docs site both reference that folder.
 *
 * Usage:
 *   deno task screenshots
 *   deno task screenshots -- --base-url http://localhost:6969 --only arr-library,hero
 *   deno task screenshots -- --frame-only          # re-frame existing raw captures
 *
 * See docs/site/src/content/docs/app/screenshots.md for how to seed a demo instance
 * (throwaway Radarr/Sonarr/Lidarr, synced profiles, sample library) before capturing.
 */

import { chromium, type Page } from '@playwright/test';
import path from 'node:path';

type Accent = 'cyan' | 'indigo' | 'blue';

type Shot = {
  name: string;
  /** Path shown in the frame's address bar (cosmetic). */
  label: string;
  accent: Accent;
  capture: (page: Page, ids: Ids) => Promise<void>;
};

type Ids = { database: number; radarr: number; profile: number; customFormat: number };

type Options = {
  baseUrl: string;
  outDir: string;
  rawDir: string;
  only: Set<string>;
  frameOnly: boolean;
  executablePath: string | undefined;
  ids: Ids;
};

const VIEWPORT = { width: 1536, height: 960 };

function parseArgs(args: string[]): Options {
  const value = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const num = (flag: string, fallback: number): number => {
    const raw = value(flag);
    const parsed = raw === undefined ? fallback : Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`${flag} must be a positive integer`);
    }
    return parsed;
  };
  const outDir = path.resolve(value('--out') ?? 'docs/site/src/assets/screenshots');
  return {
    baseUrl: (value('--base-url') ?? 'http://localhost:6969').replace(/\/+$/, ''),
    outDir,
    rawDir: path.resolve(value('--raw') ?? 'dist/screenshots/raw'),
    only: new Set((value('--only') ?? '').split(',').filter(Boolean)),
    frameOnly: args.includes('--frame-only'),
    executablePath: value('--chrome') ?? Deno.env.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE'),
    ids: {
      database: num('--database-id', 1),
      radarr: num('--radarr-id', 1),
      profile: num('--profile-id', 4),
      customFormat: num('--custom-format-id', 10),
    },
  };
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
}

function shots(baseUrl: string): Shot[] {
  const visit =
    (route: (ids: Ids) => string) =>
    (page: Page, ids: Ids): Promise<void> =>
      open(page, `${baseUrl}${route(ids)}`);

  return [
    {
      name: 'quality-profiles',
      label: '/quality-profiles',
      accent: 'cyan',
      capture: visit((ids) => `/quality-profiles/${ids.database}`),
    },
    {
      name: 'custom-formats',
      label: '/custom-formats',
      accent: 'indigo',
      capture: visit((ids) => `/custom-formats/${ids.database}`),
    },
    {
      name: 'profile-scoring',
      label: '/quality-profiles/1080p-quality/scoring',
      accent: 'blue',
      capture: visit((ids) => `/quality-profiles/${ids.database}/${ids.profile}/scoring`),
    },
    {
      name: 'custom-format-conditions',
      label: '/custom-formats/conditions',
      accent: 'indigo',
      capture: visit((ids) => `/custom-formats/${ids.database}/${ids.customFormat}/conditions`),
    },
    {
      name: 'regular-expressions',
      label: '/regular-expressions',
      accent: 'cyan',
      capture: visit((ids) => `/regular-expressions/${ids.database}`),
    },
    {
      name: 'arr-sync',
      label: '/arr/radarr/sync',
      accent: 'blue',
      capture: async (page, ids) => {
        await open(page, `${baseUrl}/arr/${ids.radarr}/sync`);
        await page.mouse.wheel(0, 240);
        await page.waitForTimeout(600);
      },
    },
    {
      name: 'arr-library',
      label: '/arr/radarr/library',
      accent: 'cyan',
      capture: visit((ids) => `/arr/${ids.radarr}/library`),
    },
    { name: 'arr-instances', label: '/arr', accent: 'indigo', capture: visit(() => '/arr') },
    {
      name: 'sync-history',
      label: '/sync-history',
      accent: 'blue',
      capture: visit(() => '/sync-history'),
    },
    { name: 'drift', label: '/drift', accent: 'cyan', capture: visit(() => '/drift') },
    {
      name: 'quality-goals',
      label: '/goals',
      accent: 'blue',
      capture: visit((ids) => `/goals/${ids.database}`),
    },
    {
      name: 'parity-map',
      label: '/parity-map',
      accent: 'cyan',
      capture: visit(() => '/parity-map'),
    },
    {
      name: 'dependency-graph',
      label: '/dependency-graph',
      accent: 'indigo',
      capture: visit((ids) => `/dependency-graph/${ids.database}`),
    },
    {
      name: 'database-commits',
      label: '/databases/praxrr-db/commits',
      accent: 'blue',
      capture: visit((ids) => `/databases/${ids.database}/commits`),
    },
    {
      name: 'security-posture',
      label: '/security-posture',
      accent: 'cyan',
      capture: visit(() => '/security-posture'),
    },
    {
      name: 'resolved-config',
      label: '/resolved-config',
      accent: 'indigo',
      capture: visit((ids) => `/resolved-config/${ids.database}`),
    },
    {
      name: 'score-simulator',
      label: '/score-simulator',
      accent: 'blue',
      capture: async (page, ids) => {
        await open(page, `${baseUrl}/score-simulator/${ids.database}`);
        await page.getByText('Select quality profile...').click();
        await page.waitForTimeout(400);
        await page.getByText('2160p Quality', { exact: true }).last().click();
        await page.waitForTimeout(400);
        await page
          .locator('textarea')
          .first()
          .fill('Dune.Part.Two.2024.2160p.MA.WEB-DL.DDP5.1.Atmos.DV.HDR10.H.265-FLUX');
        await page.getByRole('button', { name: 'Simulate' }).click();
        await page.waitForTimeout(4000);
      },
    },
  ];
}

const ACCENTS: Record<Accent, [string, string]> = {
  cyan: ['rgba(34,211,238,0.38)', 'rgba(129,140,248,0.30)'],
  indigo: ['rgba(129,140,248,0.40)', 'rgba(34,211,238,0.26)'],
  blue: ['rgba(59,130,246,0.40)', 'rgba(6,182,212,0.28)'],
};

const FRAME_CSS = `
* { box-sizing: border-box; margin: 0; }
body { font-family: Inter, 'Segoe UI', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.stage { position: relative; overflow: hidden; background: #070b16; }
.stage::before { content: ''; position: absolute; inset: 0;
  background-image: linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px);
  background-size: 48px 48px; mask-image: radial-gradient(ellipse at center, #000 30%, transparent 78%); }
.glow { position: absolute; border-radius: 50%; filter: blur(90px); }
.win { position: absolute; border-radius: 16px; overflow: hidden; background: #1a1a1a;
  border: 1px solid rgba(255,255,255,0.10);
  box-shadow: 0 0 0 1px rgba(0,0,0,0.6), 0 50px 120px -20px rgba(0,0,0,0.85),
    0 30px 60px -30px rgba(34,211,238,0.25); }
.bar { height: 44px; display: flex; align-items: center; padding: 0 18px; gap: 8px; position: relative;
  background: linear-gradient(#262a33, #1f222a); border-bottom: 1px solid rgba(255,255,255,0.06); }
.dot { width: 13px; height: 13px; border-radius: 50%; }
.url { position: absolute; left: 50%; transform: translateX(-50%); height: 28px; min-width: 420px;
  padding: 0 16px; border-radius: 8px; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.06);
  color: #94a3b8; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 8px; }
.url b { color: #e2e8f0; font-weight: 500; }
.lock { width: 10px; height: 12px; border: 1.5px solid #64748b; border-radius: 2px; position: relative; top: 1px; }
.win img { display: block; width: 100%; }
`;

function windowHtml(src: string, label: string, style: string): string {
  return `<div class="win" style="${style}">
  <div class="bar">
    <span class="dot" style="background:#ff5f57"></span>
    <span class="dot" style="background:#febc2e"></span>
    <span class="dot" style="background:#28c840"></span>
    <div class="url"><span class="lock"></span><span>praxrr.local<b>${label}</b></span></div>
  </div>
  <img src="${src}">
</div>`;
}

function framedHtml(src: string, label: string, accent: Accent): string {
  const [first, second] = ACCENTS[accent];
  // 1408px window; a 1536x960 capture scales to 880px tall + 44px title bar.
  return `<div class="stage" style="width:1600px;height:1040px">
  <div class="glow" style="width:760px;height:560px;left:-160px;top:-180px;background:${first}"></div>
  <div class="glow" style="width:820px;height:620px;right:-200px;bottom:-240px;background:${second}"></div>
  ${windowHtml(src, label, 'left:96px;top:58px;width:1408px')}
</div>`;
}

function heroHtml(raw: (name: string) => string, logo: string): string {
  const chips = [
    ['Radarr', '#fbbf24'],
    ['Sonarr', '#38bdf8'],
    ['Lidarr', '#4ade80'],
    ['Git-backed PCD', '#cbd5e1'],
  ]
    .map(
      ([name, color]) =>
        `<span style="padding:7px 14px;border-radius:999px;font-size:15px;font-weight:600;color:${color};` +
        `background:rgba(15,23,42,0.7);border:1px solid ${color}55">${name}</span>`
    )
    .join('');
  return `<div class="stage" style="width:1600px;height:960px">
  <div class="glow" style="width:900px;height:640px;left:-220px;top:-260px;background:rgba(34,211,238,0.42)"></div>
  <div class="glow" style="width:900px;height:700px;right:-260px;bottom:-300px;background:rgba(129,140,248,0.42)"></div>
  <div class="glow" style="width:600px;height:400px;left:520px;top:420px;background:rgba(59,130,246,0.22)"></div>
  <div style="position:absolute;left:84px;top:190px;width:520px;color:#e2e8f0">
    <div style="display:flex;align-items:center;gap:18px">
      <div style="width:76px;height:76px">${logo.replace('width="512" height="512"', 'width="76" height="76"')}</div>
      <div style="font-size:54px;font-weight:700;letter-spacing:-0.02em">praxrr</div>
    </div>
    <div style="margin-top:34px;font-size:40px;line-height:1.15;font-weight:700;letter-spacing:-0.02em;
      background:linear-gradient(90deg,#67e8f9,#a5b4fc);-webkit-background-clip:text;color:transparent">
      Media automation,<br>perfected in practice.</div>
    <div style="margin-top:22px;font-size:19px;line-height:1.6;color:#94a3b8">Curated quality profiles,
      custom formats and media settings — versioned in Git, compiled per app, and synced to every Arr
      instance you run.</div>
    <div style="margin-top:30px;display:flex;gap:10px;flex-wrap:wrap">${chips}</div>
  </div>
  <div style="position:absolute;left:640px;top:0;width:1200px;height:960px;perspective:2400px">
    <div style="position:absolute;inset:0;transform:rotateY(-14deg) rotateX(6deg);transform-origin:left center">
      ${windowHtml(raw('sync-history'), '/sync-history', 'left:250px;top:40px;width:980px;opacity:0.55;filter:saturate(0.8)')}
      ${windowHtml(raw('score-simulator'), '/score-simulator', 'left:130px;top:150px;width:1000px;opacity:0.8')}
      ${windowHtml(raw('quality-profiles'), '/quality-profiles', 'left:0px;top:270px;width:1020px')}
    </div>
  </div>
</div>`;
}

async function main(): Promise<void> {
  const options = parseArgs(Deno.args);
  const all = shots(options.baseUrl);
  const wanted = (name: string) => options.only.size === 0 || options.only.has(name);
  await Deno.mkdir(options.rawDir, { recursive: true });
  await Deno.mkdir(options.outDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    executablePath: options.executablePath,
    args: ['--allow-file-access-from-files'],
  });
  try {
    if (!options.frameOnly) {
      const context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 2,
        colorScheme: 'dark',
      });
      const page = await context.newPage();
      for (const shot of all.filter((s) => wanted(s.name))) {
        await shot.capture(page, options.ids);
        await page.mouse.move(0, VIEWPORT.height - 1);
        await page.screenshot({ path: path.join(options.rawDir, `${shot.name}.png`) });
        console.log(`captured ${shot.name}`);
      }
      await context.close();
    }

    const context = await browser.newContext({ deviceScaleFactor: 1.25 });
    const page = await context.newPage();
    const raw = (name: string) => `file://${path.join(options.rawDir, `${name}.png`)}`;
    const htmlPath = path.join(options.rawDir, 'frame.html');
    const render = async (body: string, file: string, width: number, height: number) => {
      await page.setViewportSize({ width, height });
      await Deno.writeTextFile(
        htmlPath,
        `<!doctype html><html><head><meta charset="utf-8"><style>${FRAME_CSS}</style></head><body>${body}</body></html>`
      );
      await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(options.outDir, `${file}.png`) });
      console.log(`framed ${file}`);
    };

    for (const shot of all.filter((s) => wanted(s.name))) {
      await render(framedHtml(raw(shot.name), shot.label, shot.accent), shot.name, 1600, 1040);
    }
    if (wanted('hero')) {
      const logo = await Deno.readTextFile('packages/praxrr-app/src/lib/client/assets/logo.svg');
      await render(heroHtml(raw, logo), 'hero', 1600, 960);
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

await main();
