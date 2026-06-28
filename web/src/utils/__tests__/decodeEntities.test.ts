import { describe, it, expect } from 'vitest';
import { decodeEntities } from '../decodeEntities';

describe('decodeEntities', () => {
  it('returns empty string as-is', () => {
    expect(decodeEntities('')).toBe('');
  });

  it('returns null/undefined as-is', () => {
    expect(decodeEntities(null as unknown as string)).toBeNull();
    expect(decodeEntities(undefined as unknown as string)).toBeUndefined();
  });

  it('returns text without ampersand as-is (fast path)', () => {
    expect(decodeEntities('Hello World')).toBe('Hello World');
  });

  it('decodes &amp;', () => {
    expect(decodeEntities('A &amp; B')).toBe('A & B');
  });

  it('decodes &lt; and &gt;', () => {
    expect(decodeEntities('&lt;div&gt;')).toBe('<div>');
  });

  it('decodes &#39; (numeric entity)', () => {
    expect(decodeEntities("it&#39;s")).toBe("it's");
  });

  it('decodes &quot;', () => {
    expect(decodeEntities('&quot;hello&quot;')).toBe('"hello"');
  });

  it('decodes mixed content with entities and plain text', () => {
    expect(decodeEntities('Tom &amp; Jerry &lt;3')).toBe('Tom & Jerry <3');
  });

  it('handles text that contains & but is not an entity', () => {
    const result = decodeEntities('a & b');
    expect(result).toBe('a & b');
  });

  it('decodes &nbsp;', () => {
    const result = decodeEntities('hello&nbsp;world');
    expect(result).toBe('hello world');
  });
});
