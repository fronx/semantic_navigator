import { describe, it, expect } from 'vitest';
import { calculateSimulationAlpha } from '../simulation-zoom-config';

describe('calculateSimulationAlpha - reasonable ranges', () => {
  it('should have high alpha (>0.15) at far zoom (Z=8000)', () => {
    const alpha = calculateSimulationAlpha(8000);
    // At 8000 (40% through range), should have at least 50% of max alpha
    expect(alpha).toBeGreaterThan(0.15);
  });

  it('should have high alpha (>0.18) at far zoom (Z=10000)', () => {
    const alpha = calculateSimulationAlpha(10000);
    // At 10000 (45% through new range 1800-20000), should have substantial alpha
    expect(alpha).toBeGreaterThan(0.18);
  });

  it('should have near-max alpha (>0.24) at very far zoom (Z=15000)', () => {
    const alpha = calculateSimulationAlpha(15000);
    // At 15000 (72% through new range 1800-20000), should have high alpha
    expect(alpha).toBeGreaterThan(0.24);
  });

  it('should have low alpha (<0.06) only when very close (Z<2000)', () => {
    const alpha1000 = calculateSimulationAlpha(1000);
    const alpha2000 = calculateSimulationAlpha(2000);

    // Very close: should be low
    expect(alpha1000).toBeLessThan(0.06);

    // At 2000 (10% through range): should start climbing
    expect(alpha2000).toBeGreaterThan(0.02);
  });
});
