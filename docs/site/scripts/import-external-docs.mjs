import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(siteRoot, '../..');

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...valueParts] = arg.replace(/^--/, '').split('=');
    return [key, valueParts.join('=')];
  })
);

const schemaSource = path.resolve(
  siteRoot,
  args.get('schema-source') ?? process.env.PRAXRR_SCHEMA_DOCS_SOURCE ?? '../../packages/praxrr-schema'
);
const dbSource = path.resolve(
  siteRoot,
  args.get('db-source') ?? process.env.PRAXRR_DB_DOCS_SOURCE ?? '../../packages/praxrr-db'
);

const imports = [
  {
    source: path.join(schemaSource, 'docs/structure.md'),
    target: path.join(siteRoot, 'src/content/docs/schema/structure.md'),
    title: 'Structure',
    description: 'Imported PCD schema structure reference.',
    fallback:
      'The schema structure reference is imported from `praxrr-schema/docs/structure.md` during the docs build.',
  },
  {
    source: path.join(schemaSource, 'docs/manifest.md'),
    target: path.join(siteRoot, 'src/content/docs/schema/manifest.md'),
    title: 'Manifest',
    description: 'Imported PCD manifest reference.',
    fallback: 'The manifest reference is imported from `praxrr-schema/docs/manifest.md` during the docs build.',
  },
  {
    source: path.join(dbSource, 'README.md'),
    target: path.join(siteRoot, 'src/content/docs/database/readme.md'),
    title: 'Mirror README',
    description: 'Imported PCD database mirror README.',
    fallback: 'The database README is imported from `praxrr-db/README.md` during the docs build.',
  },
];

for (const doc of imports) {
  mkdirSync(path.dirname(doc.target), { recursive: true });
  const body = existsSync(doc.source)
    ? normalizeMarkdown(readFileSync(doc.source, 'utf8'), doc.source)
    : `${doc.fallback}\n`;

  writeFileSync(
    doc.target,
    `---\ntitle: ${JSON.stringify(doc.title)}\ndescription: ${JSON.stringify(doc.description)}\n---\n\n${body.trim()}\n`
  );
}

console.log(
  `Imported external docs from ${path.relative(repoRoot, schemaSource)} and ${path.relative(repoRoot, dbSource)}`
);

function normalizeMarkdown(markdown, sourcePath) {
  const relativeSource = path.relative(repoRoot, sourcePath);
  const withoutFrontmatter = markdown.replace(/^---\n[\s\S]*?\n---\n+/, '');
  const demoted = withoutFrontmatter.replace(/^# /gm, '## ');

  return `> Source: \`${relativeSource}\`\n\n${demoted}`;
}
