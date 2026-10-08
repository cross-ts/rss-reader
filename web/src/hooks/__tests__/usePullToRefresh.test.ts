import { describe, it, expect } from 'vitest';
import { rubber, PTR_MAX, PTR_READY } from '../usePullToRefresh';

describe('rubber', () => {
  it('is 0 at 0 and monotonically increasing below PTR_MAX', () => {
    expect(rubber(0)).toBe(0);
    expect(rubber(100)).toBeGreaterThan(rubber(50));
    expect(rubber(10000)).toBeLessThanOrEqual(PTR_MAX);
    expect(rubber(500)).toBeGreaterThan(PTR_MAX - 5);
  });

  it('reaches the ready threshold at a moderate pull', () => {
    expect(rubber(100)).toBeLessThan(PTR_READY);
    expect(rubber(200)).toBeGreaterThanOrEqual(PTR_READY);
  });
});
