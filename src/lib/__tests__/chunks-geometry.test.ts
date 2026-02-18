import { describe, it, expect } from 'vitest';
import { computeFocusSeedBoost, FOCUS_SEED_SCALE } from '../chunks-geometry';

describe('computeFocusSeedBoost', () => {
  it('returns FOCUS_SEED_SCALE for a focus seed with no hover animation', () => {
    expect(computeFocusSeedBoost(true, 0)).toBe(FOCUS_SEED_SCALE);
  });

  it('returns 1 for a non-focus-seed node', () => {
    expect(computeFocusSeedBoost(false, 0)).toBe(1);
  });

  it('returns 1 while hover animation is in progress on a focus seed (prevents scale spike)', () => {
    // This is the regression case: mouse left the focus seed but hover is still decaying.
    // Without the fix, focusSeedBoost snapped to 2 while hoverScale was still > 1.
    expect(computeFocusSeedBoost(true, 1)).toBe(1);    // fully hovered
    expect(computeFocusSeedBoost(true, 0.5)).toBe(1);  // mid hover-out
    expect(computeFocusSeedBoost(true, 0.01)).toBe(1); // nearly done decaying
  });

  it('restores FOCUS_SEED_SCALE only after hover animation fully completes', () => {
    expect(computeFocusSeedBoost(true, 0)).toBe(FOCUS_SEED_SCALE);
  });
});
