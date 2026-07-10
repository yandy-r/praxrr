// Orchestrates one isolated `astro build` per entry in versions.json and assembles the
// per-version outputs into a single `dist/` (default version at the root, others under
// `/<id>/`). Each build carries its own base, Pagefind index, and OpenAPI reference, so
// versioned URLs and per-version search scoping come for free. A fail-fast guard asserts
// the assembled tree before it is deployed. See docs/site/src/content/docs/app/docs-versioning.md.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(siteRoot, 'dist');
const stageRoot = path.join(distDir, '.versions');

const manifest = JSON.parse(readFileSync(path.join(siteRoot, 'versions.json'), 'utf8'));
if (!Array.isArray(manifest) || manifest.length === 0) {
	throw new Error('versions.json must be a non-empty array');
}
if (manifest.filter((v) => v.default).length !== 1) {
	throw new Error('versions.json must have exactly one entry with "default": true');
}
// Ids become filesystem + URL path segments, so reject separators, dot-prefixed names, and
// the staging dir name. Collisions with real content dirs (e.g. "api") are caught at assembly.
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
for (const version of manifest) {
	if (typeof version.id !== 'string' || !ID_PATTERN.test(version.id) || version.id === '.versions') {
		throw new Error(
			`invalid version id ${JSON.stringify(version.id)} in versions.json: must match ${ID_PATTERN} and not be ".versions"`
		);
	}
}

// Astro CLI resolved from the local install so this works under plain `node` (no PATH astro).
const astroBin = path.join(siteRoot, 'node_modules', '.bin', 'astro');

function countHtml(dir, { excludeDirs = [] } = {}) {
	if (!existsSync(dir)) return 0;
	let count = 0;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (excludeDirs.includes(full)) continue;
			count += countHtml(full, { excludeDirs });
		} else if (entry.isFile() && entry.name.endsWith('.html')) {
			count += 1;
		}
	}
	return count;
}

rmSync(distDir, { recursive: true, force: true });

// 1. Build each version into its own staged outDir (dist/.versions/<id>).
for (const version of manifest) {
	console.log(`\n[build-versions] building "${version.id}" (base ${version.base})`);
	execFileSync(astroBin, ['build', '--root', '.'], {
		cwd: siteRoot,
		stdio: 'inherit',
		env: { ...process.env, DOCS_VERSION: version.id }
	});
}

// 2. Assemble: default → dist/ first, others → dist/<id>/ (guarded against colliding with
// a real content dir the default build emitted, e.g. an id of "api" or "app").
const assemblyOrder = [...manifest].sort((a, b) => (b.default ? 1 : 0) - (a.default ? 1 : 0));
for (const version of assemblyOrder) {
	const src = path.join(stageRoot, version.id);
	if (!existsSync(path.join(src, 'index.html'))) {
		throw new Error(`build for "${version.id}" produced no index.html at ${src}`);
	}
	const dest = version.default ? distDir : path.join(distDir, version.id);
	if (!version.default) {
		if (existsSync(dest)) {
			throw new Error(
				`version id "${version.id}" collides with an existing path (dist/${version.id}) from the default build; choose a non-conflicting id`
			);
		}
		mkdirSync(dest, { recursive: true });
	}
	// dest is an ancestor (default) or sibling of src, never a subdirectory of src, so
	// Node's self-copy guard does not fire and .versions is not recursed into.
	cpSync(src, dest, { recursive: true });
}

// 3. Drop the staging tree and publish the manifest alongside the assembled site.
rmSync(stageRoot, { recursive: true, force: true });
cpSync(path.join(siteRoot, 'versions.json'), path.join(distDir, 'versions.json'));

// 4. Fail-fast guard on the assembled output.
const defaultVersion = manifest.find((v) => v.default);
const nonDefault = manifest.filter((v) => !v.default);
const nonDefaultDirs = nonDefault.map((v) => path.join(distDir, v.id));

const required = [
	path.join(distDir, 'index.html'),
	path.join(distDir, 'versions.json'),
	path.join(distDir, 'pagefind')
];
for (const v of nonDefault) {
	required.push(path.join(distDir, v.id, 'index.html'), path.join(distDir, v.id, 'pagefind'));
}
for (const p of required) {
	if (!existsSync(p)) throw new Error(`guard: expected ${path.relative(siteRoot, p)} to exist`);
}
if (!statSync(path.join(distDir, 'pagefind')).isDirectory()) {
	throw new Error('guard: dist/pagefind must be a directory');
}

const total = countHtml(distDir);
const perVersion = {};
let nonDefaultTotal = 0;
for (const v of nonDefault) {
	perVersion[v.id] = countHtml(path.join(distDir, v.id));
	nonDefaultTotal += perVersion[v.id];
}
perVersion[defaultVersion.id] = countHtml(distDir, { excludeDirs: nonDefaultDirs });

console.log(`\n[build-versions] html pages -> total:${total} ${JSON.stringify(perVersion)}`);

const FLOOR_PER_VERSION = 90;
const FLOOR_TOTAL = 180;
const SYMMETRY = 5;
for (const [id, count] of Object.entries(perVersion)) {
	if (count < FLOOR_PER_VERSION) {
		throw new Error(`guard: version "${id}" has ${count} html pages (< ${FLOOR_PER_VERSION})`);
	}
}
if (total < FLOOR_TOTAL) throw new Error(`guard: ${total} total html pages (< ${FLOOR_TOTAL})`);
// Pre-v2 every version renders identical content, so counts must be near-equal.
for (const v of nonDefault) {
	if (Math.abs(perVersion[defaultVersion.id] - perVersion[v.id]) > SYMMETRY) {
		throw new Error(
			`guard: version "${v.id}" (${perVersion[v.id]}) diverges from default "${defaultVersion.id}" (${perVersion[defaultVersion.id]}) by > ${SYMMETRY}`
		);
	}
}

console.log('[build-versions] assembled dist verified.');
