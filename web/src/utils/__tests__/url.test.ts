import { describe, it, expect } from 'vitest';
import { safeHttpUrl, domainOf } from '../url';

describe('safeHttpUrl', () => {
  it('allows http and https', () => {
    expect(safeHttpUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeHttpUrl('http://example.com')).toBe('http://example.com');
  });

  it('rejects other schemes, relative and empty values', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,x')).toBeNull();
    expect(safeHttpUrl('/relative')).toBeNull();
    expect(safeHttpUrl('')).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });
});

describe('domainOf', () => {
  it('returns the hostname', () => {
    expect(domainOf('https://blog.example.com/feed.xml')).toBe('blog.example.com');
  });

  it('falls back to the input when unparsable', () => {
    expect(domainOf('nope')).toBe('nope');
    expect(domainOf('')).toBe('');
  });
});
