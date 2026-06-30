import { describe, it, expect } from 'vitest';
import { extractThumbnail, extractTextExcerpt } from '../thumbnail';

describe('extractThumbnail', () => {
  it('extracts src from img tag with https URL', () => {
    const html = '<p>Hello</p><img src="https://example.com/photo.jpg" alt="pic">';
    expect(extractThumbnail(html)).toBe('https://example.com/photo.jpg');
  });

  it('extracts src from img tag with http URL', () => {
    const html = '<img src="http://example.com/photo.jpg">';
    expect(extractThumbnail(html)).toBe('http://example.com/photo.jpg');
  });

  it('returns the first img when multiple are present', () => {
    const html = '<img src="https://first.com/a.jpg"><img src="https://second.com/b.jpg">';
    expect(extractThumbnail(html)).toBe('https://first.com/a.jpg');
  });

  it('returns null when no img tag exists', () => {
    expect(extractThumbnail('<p>No images here</p>')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractThumbnail('')).toBeNull();
  });

  it('returns null when img has no src attribute', () => {
    expect(extractThumbnail('<img alt="no src">')).toBeNull();
  });

  it('returns null for img with empty src', () => {
    expect(extractThumbnail('<img src="">')).toBeNull();
  });

  it('returns null for data: URL', () => {
    expect(extractThumbnail('<img src="data:image/png;base64,abc">')).toBeNull();
  });

  it('returns null for javascript: URL', () => {
    expect(extractThumbnail('<img src="javascript:alert(1)">')).toBeNull();
  });

  it('returns null for relative URL', () => {
    expect(extractThumbnail('<img src="/images/photo.jpg">')).toBeNull();
  });

  it('is case-insensitive for protocol matching', () => {
    expect(extractThumbnail('<img src="HTTPS://example.com/pic.jpg">')).toBe(
      'HTTPS://example.com/pic.jpg',
    );
  });
});

describe('extractTextExcerpt', () => {
  it('strips HTML tags and returns plain text', () => {
    expect(extractTextExcerpt('<p>Hello world</p>', 100)).toBe('Hello world');
  });

  it('normalizes whitespace', () => {
    expect(extractTextExcerpt('<p>foo  \n  bar</p>', 100)).toBe('foo bar');
  });

  it('truncates to maxLen and appends ellipsis', () => {
    const result = extractTextExcerpt('<p>abcdefghij</p>', 5);
    expect(result).toBe('abcde…');
  });

  it('does not truncate when text is exactly maxLen', () => {
    expect(extractTextExcerpt('<p>12345</p>', 5)).toBe('12345');
  });

  it('returns empty string for empty input', () => {
    expect(extractTextExcerpt('', 80)).toBe('');
  });

  it('uses default maxLen of 80', () => {
    const long = 'a'.repeat(100);
    const result = extractTextExcerpt(`<p>${long}</p>`);
    expect(result.length).toBeLessThanOrEqual(81); // 80 chars + ellipsis
    expect(result.endsWith('…')).toBe(true);
  });
});
