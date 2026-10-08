/** Isomorphic markdown rendering with an explicit HTML allowlist and fail-closed URL policy. */
import { Marked } from 'marked';
import xssModule from 'xss';
import type * as XSS from 'xss';

// xss is CommonJS: only the default import resolves in Node ESM (Vite SSR), but its typings model it as the filter fn.
const xss = xssModule as unknown as typeof XSS;

const md = new Marked({ gfm: true, async: false });
const ALLOWED_HREF_PROTOCOLS = ['http:', 'https:', 'mailto:'] as const;
const ALLOWED_SRC_PROTOCOLS = ['http:', 'https:'] as const;

const filter = new xss.FilterXSS({
  whiteList: {
    p: [],
    br: [],
    hr: [],
    strong: [],
    em: [],
    del: [],
    u: [],
    ins: [],
    code: [],
    pre: [],
    blockquote: [],
    ul: [],
    li: [],
    h1: [],
    h2: [],
    h3: [],
    h4: [],
    h5: [],
    h6: [],
    table: [],
    thead: [],
    tbody: [],
    tr: [],
    ol: ['start'],
    a: ['href', 'title'],
    img: ['src', 'alt', 'title'],
    th: ['align'],
    td: ['align'],
    input: ['type', 'checked', 'disabled'],
  },
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style'],
  onTag(tag, html, info) {
    if (tag !== 'input' || info.isClosing) return;
    let checkbox = false;
    let checked = false;
    xss.parseAttr(html.replace(/^<input\b/i, '').replace(/\/?\s*>$/, ''), (name, value) => {
      if (name === 'type') checkbox = xss.friendlyAttrValue(value).toLowerCase() === 'checkbox';
      if (name === 'checked') checked = true;
      return '';
    });
    return checkbox ? `<input type="checkbox" disabled${checked ? ' checked' : ''}>` : '';
  },
  // Drop an allowlisted attribute entirely when its value is rejected (xss would otherwise emit it bare).
  onTagAttr(tag, name, value, isWhiteAttr) {
    if (isWhiteAttr && safeAttr(tag, name, value) === '') return '';
  },
  safeAttrValue: (tag, name, value) => safeAttr(tag, name, value),
});

function safeAttr(tag: string, name: string, value: string): string {
  if (tag === 'ol' && name === 'start') return /^\d+$/.test(value) ? xss.escapeAttrValue(value) : '';
  if ((tag === 'th' || tag === 'td') && name === 'align') {
    return /^(left|center|right)$/.test(value) ? xss.escapeAttrValue(value) : '';
  }
  if ((tag === 'a' && name === 'href') || (tag === 'img' && name === 'src')) {
    // Entity-decode once (`&#115;`, `&colon;`, `&#x09;`) without friendlyAttrValue's control-char cleanup, so
    // obfuscated (`jav&#x09;ascript:`) or padded (`  javascript:`) values are rejected instead of normalized.
    const decoded = xss.escapeDangerHtml5Entities(xss.escapeHtmlEntities(xss.unescapeQuote(value)));
    // eslint-disable-next-line no-control-regex -- rejecting control characters is the point of this check
    if (/[\u0000-\u001F\u007F]/.test(value + decoded) || decoded !== decoded.trim()) return '';
    // xss decodes only some entities (and maps `&NewLine;` to a space); browsers decode all (`jav&Tab;ascript:`).
    // Any entity in the scheme region (before the first / ? #) could hide a scheme, so reject it.
    if (/^[^/?#]*&/.test(value)) return '';
    const v = xss.friendlyAttrValue(value);
    // Protocol-relative (`//host`) and backslash (`\\host`, `/\host`) forms resolve to foreign hosts in browsers.
    if (v.startsWith('//') || v.includes('\\')) return '';
    // RFC 3986 scheme. A value with a scheme must parse to that same allowed protocol; no scheme means relative.
    const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(v);
    if (scheme) {
      try {
        const protocol = new URL(v, 'https://placeholder.invalid').protocol;
        const allowed: readonly string[] = tag === 'a' ? ALLOWED_HREF_PROTOCOLS : ALLOWED_SRC_PROTOCOLS;
        if (protocol !== `${scheme[1].toLowerCase()}:` || !allowed.includes(protocol)) return '';
      } catch {
        return '';
      }
    } else if (tag === 'img' && v.startsWith('#')) {
      return '';
    }
    return xss.escapeAttrValue(v);
  }
  return xss.escapeAttrValue(value);
}

export function sanitizeHtml(html: string | null | undefined): string {
  return html ? filter.process(html) : '';
}

export function parseMarkdown(src: string | null | undefined): string {
  return src ? sanitizeHtml(md.parse(src) as string) : '';
}

export function parseMarkdownInline(src: string | null | undefined): string {
  return src ? sanitizeHtml(md.parseInline(src) as string) : '';
}
