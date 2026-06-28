import { describe, it, expect } from 'vitest';
import { extractThumbnail } from '../thumbnail';

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
