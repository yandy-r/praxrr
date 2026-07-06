/**
 * Markdown utility for parsing markdown to HTML
 */

import { marked } from 'marked';

/**
 * Simple HTML sanitizer to avoid postcss dependency issues in compiled binaries
 */
function sanitizeHtml(html: string): string {
  // Allowed tags
  const allowedTags = new Set([
    'p',
    'br',
    'strong',
    'em',
    'u',
    'code',
    'pre',
    'blockquote',
    'ul',
    'ol',
    'li',
    'a',
    'img',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'hr',
    'del',
    'ins',
  ]);

  // Allowed attributes per tag
  const allowedAttrs: Record<string, Set<string>> = {
    a: new Set(['href', 'title']),
    img: new Set(['src', 'alt', 'title']),
  };

  // Remove script tags and their content
  html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove event handlers and javascript: URLs
  html = html.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
  html = html.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, '');

  // Filter tags and attributes
  return html.replace(/<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi, (match, tag, attrs) => {
    const lowerTag = tag.toLowerCase();

    // Remove disallowed tags
    if (!allowedTags.has(lowerTag)) {
      return '';
    }

    // If closing tag, allow it
    if (match.startsWith('</')) {
      return `</${lowerTag}>`;
    }

    // Filter attributes
    const allowedForTag = allowedAttrs[lowerTag];
    if (!allowedForTag) {
      return `<${lowerTag}>`;
    }

    const filteredAttrs = attrs.replace(
      /([a-z][a-z0-9-]*)\s*=\s*["']([^"']*)["']/gi,
      (_attrMatch: string, attrName: string, attrValue: string) => {
        if (allowedForTag.has(attrName.toLowerCase())) {
          return ` ${attrName}="${attrValue}"`;
        }
        return '';
      }
    );

    return `<${lowerTag}${filteredAttrs}>`;
  });
}

/**
 * Parse markdown to sanitized HTML
 */
export function parseMarkdown(markdown: string | null | undefined): string {
  if (!markdown) return '';

  // Parse markdown to HTML
  const html = marked.parse(markdown) as string;

  // Sanitize HTML to prevent XSS
  return sanitizeHtml(html);
}

/**
 * Strip markdown formatting and return plain text
 */
export function stripMarkdown(markdown: string | null | undefined): string {
  if (!markdown) return '';

  const html = parseMarkdown(markdown);
  return html.replace(/<[^>]*>/g, '').trim();
}
