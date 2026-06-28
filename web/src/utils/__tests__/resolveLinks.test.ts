import { describe, expect, it } from 'vitest';
import { resolveContentLinks } from '../resolveLinks';

describe('resolveContentLinks', () => {
  const baseUrl = 'https://example.com/articles/123';

  it('converts relative path to absolute URL', () => {
    const html = '<a href="/blog/">Blog</a>';
    const result = resolveContentLinks(html, baseUrl);
    expect(result).toContain('href="https://example.com/blog/"');
  });

  it('keeps absolute URLs unchanged', () => {
    const html = '<a href="https://other.com/page">Link</a>';
    const result = resolveContentLinks(html, baseUrl);
    expect(result).toContain('href="https://other.com/page"');
  });

  it('converts relative img src to absolute URL', () => {
    const html = '<img src="/images/photo.jpg">';
    const result = resolveContentLinks(html, baseUrl);
    expect(result).toContain('src="https://example.com/images/photo.jpg"');
  });

  it('adds target="_blank" and rel="noopener noreferrer" to all links', () => {
    const html = '<a href="https://example.com/page">Link</a>';
    const result = resolveContentLinks(html, baseUrl);
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it('returns HTML unchanged when articleUrl is invalid', () => {
    const html = '<a href="/blog/">Blog</a>';
    const result = resolveContentLinks(html, 'not-a-url');
    expect(result).toBe(html);
  });

  it('returns HTML unchanged when articleUrl is not http/https', () => {
    const html = '<a href="/blog/">Blog</a>';
    const result = resolveContentLinks(html, 'ftp://example.com/file');
    expect(result).toBe(html);
  });

  it('returns empty string for empty HTML', () => {
    expect(resolveContentLinks('', baseUrl)).toBe('');
  });

  it('does not convert javascript: hrefs', () => {
    const html = '<a href="javascript:void(0)">Click</a>';
    const result = resolveContentLinks(html, baseUrl);
    expect(result).toContain('href="javascript:void(0)"');
  });

  it('does not convert data: hrefs', () => {
    const html = '<a href="data:text/html,test">Click</a>';
    const result = resolveContentLinks(html, baseUrl);
    expect(result).toContain('href="data:text/html,test"');
  });

  it('does not convert data: img src', () => {
    const html = '<img src="data:image/png;base64,abc">';
    const result = resolveContentLinks(html, baseUrl);
    expect(result).toContain('src="data:image/png;base64,abc"');
  });

  it('resolves relative path based on article URL', () => {
    const html = '<a href="related">Related</a>';
    const result = resolveContentLinks(html, 'https://example.com/blog/post/1');
    expect(result).toContain('href="https://example.com/blog/post/related"');
  });
});
