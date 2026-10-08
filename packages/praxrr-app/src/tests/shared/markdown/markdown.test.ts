/** Pure tests for the shared sanitized markdown renderer: the full 22-row corpus. No DB, no mocks. */
import { assert, assertEquals } from '@std/assert';
import { parseMarkdown, parseMarkdownInline, sanitizeHtml } from '$shared/markdown/markdown.ts';

function attrs(html: string): string[] {
  return [...html.matchAll(/<[a-zA-Z][^>]*>/g)].flatMap((m) =>
    // Drop quoted values first so escaped text inside an attribute is not read as an attribute name.
    [...m[0].replace(/"[^"]*"|'[^']*'/g, '""').matchAll(/([a-zA-Z-]+)\s*=/g)].map((a) => a[1].toLowerCase())
  );
}

function noEventAttrs(html: string): boolean {
  return attrs(html).every((a) => !a.startsWith('on'));
}

function hasAttr(html: string, name: string): boolean {
  return attrs(html).includes(name);
}

Deno.test('parseMarkdown: null/undefined/empty returns empty', () => {
  assertEquals(parseMarkdown(null), '');
  assertEquals(parseMarkdown(undefined), '');
  assertEquals(parseMarkdown(''), '');
  assertEquals(parseMarkdownInline(null), '');
  assertEquals(parseMarkdownInline(undefined), '');
  assertEquals(parseMarkdownInline(''), '');
});

Deno.test('sanitizeHtml: img unquoted onerror removed, src kept', () => {
  const out = sanitizeHtml('<img src=x onerror=alert(1)>');
  assert(!out.includes('onerror'));
  assert(out.includes('src="x"'));
});

Deno.test('sanitizeHtml: img slash-quoted onerror removed', () => {
  const out = sanitizeHtml('<img src="x"/onerror=alert(1)>');
  assert(noEventAttrs(out));
  assert(out.includes('src="x"'));
});

Deno.test('script tag and body removed', () => {
  for (const out of [
    sanitizeHtml('<script>alert(1)</script>'),
    parseMarkdown('<script>alert(1)</script>'),
    parseMarkdownInline('<script>alert(1)</script>'),
  ]) {
    assert(!out.includes('<script'), out);
    assert(!out.includes('alert(1)'), out);
  }
});

Deno.test('sanitizeHtml: svg/math removed', () => {
  const out = sanitizeHtml('<svg onload=alert(1)></svg><math><mi>x</mi></math>');
  assert(!out.includes('<svg'), out);
  assert(!out.includes('<math'), out);
});

Deno.test('sanitizeHtml: javascript href removed, text kept', () => {
  const out = sanitizeHtml('<a href=javascript:alert(1)>x</a>');
  assert(!hasAttr(out, 'href'), out);
  assert(out.includes('>x<'));
});

Deno.test('sanitizeHtml: mixed-case padded javascript href removed', () => {
  const out = sanitizeHtml('<a HREF="  JaVaScRiPt:alert(1)">x</a>');
  assert(!hasAttr(out, 'href'), out);
});

Deno.test('sanitizeHtml: entity-encoded javascript href removed', () => {
  const out = sanitizeHtml('<a href="java&#115;cript:alert(1)">x</a>');
  assert(!hasAttr(out, 'href'), out);
});

Deno.test('sanitizeHtml: hex-entity tab javascript href removed', () => {
  const out = sanitizeHtml('<a href="jav&#x09;ascript:alert(1)">x</a>');
  assert(!hasAttr(out, 'href'), out);
});

Deno.test('sanitizeHtml: &colon; javascript href removed', () => {
  const out = sanitizeHtml('<a href="javascript&colon;alert(1)">x</a>');
  assert(!hasAttr(out, 'href'), out);
});

Deno.test('sanitizeHtml: named-entity (&Tab;/&NewLine;) obfuscated scheme removed, query & kept', () => {
  for (const html of ['<a href="jav&Tab;ascript:alert(1)">x</a>', '<a href="jav&NewLine;ascript:alert(1)">x</a>']) {
    const out = sanitizeHtml(html);
    assert(!/href="[^"]/.test(out), out);
  }
  assert(sanitizeHtml('<a href="https://e.com/?a=1&b=2">x</a>').includes('href="https://e.com/?a=1&b=2"'));
});

Deno.test('data: href and src removed', () => {
  const outA = sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
  assert(!hasAttr(outA, 'href'), outA);
  for (const out of [
    parseMarkdown('![x](data:image/svg+xml;base64,PHN2Zz4=)'),
    parseMarkdownInline('![x](data:image/svg+xml;base64,PHN2Zz4=)'),
  ]) {
    assert(!hasAttr(out, 'src'), out);
    assert(out.includes('alt="x"'), out);
  }
});

Deno.test('markdown scheme-obfuscated links and images neutralized', () => {
  for (const render of [parseMarkdown, parseMarkdownInline]) {
    const out = render('[x](javascript:alert(1)) [y](vbscript:msgbox(1)) ![i](javascript:alert(1))');
    assert(!hasAttr(out, 'href'), out);
    assert(!hasAttr(out, 'src'), out);
    assert(out.includes('>x<'), out);
    assert(out.includes('>y<'), out);
    assert(out.includes('alt="i"'), out);
  }
});

Deno.test('markdown protocol-relative, ftp and tel links rejected', () => {
  for (const render of [parseMarkdown, parseMarkdownInline]) {
    for (const src of ['[x](//evil.example)', '[x](ftp://e.com)', '[x](tel:123)']) {
      const out = render(src);
      assert(!hasAttr(out, 'href'), `${src} -> ${out}`);
      assert(out.includes('>x<'), out);
    }
  }
});

Deno.test('sanitizeHtml: title breakout escaped, href kept', () => {
  const out = sanitizeHtml(`<a title='x" onmouseover="alert(1)' href="/ok">x</a>`);
  assert(out.includes('href="/ok"'), out);
  assert(noEventAttrs(out), out);
  assert(out.includes('title="x&quot;'), out);
});

Deno.test('sanitizeHtml: style/id/name stripped from p', () => {
  const out = sanitizeHtml('<p style="color:red" id="location" name="cookie">x</p>');
  assertEquals(out, '<p>x</p>');
});

Deno.test('sanitizeHtml: text input dropped, checkbox canonical disabled', () => {
  const out = sanitizeHtml('<input type="text" value="fake"><input type="checkbox" checked>');
  assert(!out.includes('text'), out);
  assert(!out.includes('fake'), out);
  const inputs = out.match(/<input\b[^>]*>/g) ?? [];
  assertEquals(inputs.length, 1);
  assert(inputs[0]!.includes('type="checkbox"'), inputs[0]);
  assert(inputs[0]!.includes('disabled'), inputs[0]);
  assert(inputs[0]!.includes('checked'), inputs[0]);
  assert(!inputs[0]!.includes('value'), inputs[0]);
});

Deno.test('sanitizeHtml: th align kept, onclick removed, bogus align dropped', () => {
  const out = sanitizeHtml(
    '<table><tr><th align="left" onclick="alert(1)">x</th><td align="bogus">y</td></tr></table>'
  );
  assert(out.includes('align="left"'), out);
  assert(noEventAttrs(out), out);
  assert(!out.includes('bogus'), out);
});

Deno.test('markdown benign absolute links preserved', () => {
  for (const render of [parseMarkdown, parseMarkdownInline]) {
    const out = render('[a](https://example.com "t") [b](HTTP://example.com) [c](mailto:a@example.com)');
    assert(out.includes('href="https://example.com"'), out);
    assert(out.includes('title="t"'), out);
    assert(out.includes('mailto:a@example.com'), out);
    const img = render('![i](https://e.com/i.png "t")');
    assert(img.includes('src="https://e.com/i.png"'), img);
    assert(img.includes('title="t"'), img);
  }
});

Deno.test('markdown relative hrefs preserved', () => {
  for (const render of [parseMarkdown, parseMarkdownInline]) {
    for (const [src, href] of [
      ['[x](/p)', '/p'],
      ['[x](../p)', '../p'],
      ['[x](guide.md)', 'guide.md'],
      ['[x](?tab=1)', '?tab=1'],
      ['[x](#s)', '#s'],
    ] as const) {
      const out = render(src);
      assert(out.includes(`href="${href}"`), `${src} -> ${out}`);
    }
  }
});

Deno.test('markdown fenced code escapes embedded html', () => {
  for (const render of [parseMarkdown, parseMarkdownInline]) {
    const out = render('```html\n<img src=x onerror=alert(1)>\n```');
    assert(out.includes('<code'), out);
    assert(!out.includes('<img'), out);
    assert(noEventAttrs(out), out);
  }
});

Deno.test('markdown GFM table/start/tasks/emphasis preserved', () => {
  const table = parseMarkdown('| a | b |\n|:- | -:|\n| 1 | 2 |');
  assert(table.includes('align="left"'), table);
  assert(table.includes('align="right"'), table);
  const ol = parseMarkdown('3. item');
  assert(ol.includes('start="3"'), ol);
  const tasks = parseMarkdown('- [x] done\n- [ ] todo');
  const inputs = tasks.match(/<input\b[^>]*>/g) ?? [];
  assertEquals(inputs.length, 2);
  assert(
    inputs.every((i) => i.includes('disabled')),
    tasks
  );
  assert(inputs[0]!.includes('checked'), tasks);
  assert(!inputs[1]!.includes('checked'), tasks);
  const em = parseMarkdown('**b** *e* ~~d~~');
  assert(em.includes('<strong>b</strong>'), em);
  assert(em.includes('<em>e</em>'), em);
  assert(em.includes('<del>d</del>'), em);
});

Deno.test('idempotent sanitize; inline has no p, block has p', () => {
  const rows = [
    '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    '<a href=javascript:alert(1)>x</a>',
    '<p style="color:red" id="i">x</p>',
    '<input type="checkbox" checked>',
  ];
  for (const row of rows) {
    assertEquals(sanitizeHtml(sanitizeHtml(row)), sanitizeHtml(row));
  }
  for (const render of [parseMarkdown, parseMarkdownInline]) {
    assertEquals(render(render('**b** [x](javascript:alert(1))')), render('**b** [x](javascript:alert(1))'));
  }
  assertEquals(parseMarkdownInline('hello'), 'hello');
  assert(parseMarkdown('hello').includes('<p>'), parseMarkdown('hello'));
});
