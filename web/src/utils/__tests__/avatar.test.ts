import { describe, it, expect } from 'vitest';
import { avatarColor, initial } from '../avatar';

describe('avatarColor', () => {
  it('is deterministic and returns a hex color', () => {
    expect(avatarColor('Zenn')).toBe(avatarColor('Zenn'));
    expect(avatarColor('Zenn')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('handles empty title', () => {
    expect(avatarColor('')).toBe(avatarColor('?'));
  });
});

describe('initial', () => {
  it('returns the first character', () => {
    expect(initial('Zenn')).toBe('Z');
    expect(initial('週刊')).toBe('週');
  });

  it('keeps surrogate pairs intact', () => {
    expect(initial('𠮷野家')).toBe('𠮷');
    expect(initial('😀 smile')).toBe('😀');
  });

  it('falls back to ? for empty', () => {
    expect(initial('')).toBe('?');
  });
});
