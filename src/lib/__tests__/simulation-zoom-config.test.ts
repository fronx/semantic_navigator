import { describe, it, expect } from 'vitest';
import {
  calculateSimulationAlpha,
  calculateVelocityDecay,
} from '../simulation-zoom-config';

describe('calculateSimulationAlpha', () => {
  it('returns minimum alpha when zoomed in close', () => {
    expect(calculateSimulationAlpha(50)).toBeCloseTo(0.01, 2);
  });

  it('returns maximum alpha when zoomed out far', () => {
    expect(calculateSimulationAlpha(20000)).toBeCloseTo(0.30, 2);
  });

  it('returns halted alpha below simulation Z min (1800)', () => {
    expect(calculateSimulationAlpha(1000)).toBe(0.01);
  });

  it('increases monotonically as Z increases', () => {
    const values = [50, 1800, 5000, 20000].map(calculateSimulationAlpha);

    // Below 1800: halted at minimum
    expect(values[0]).toBe(0.01);
    expect(values[1]).toBe(0.01);

    // Above 1800: increases monotonically
    expect(values[2]).toBeGreaterThan(values[1]);
    expect(values[3]).toBeGreaterThan(values[2]);
  });

  it('clamps to valid range for extreme inputs', () => {
    for (const z of [-100, 100000]) {
      const alpha = calculateSimulationAlpha(z);
      expect(alpha).toBeGreaterThanOrEqual(0.01);
      expect(alpha).toBeLessThanOrEqual(0.30);
    }
  });
});

describe('calculateVelocityDecay', () => {
  it('returns maximum decay when zoomed in close', () => {
    expect(calculateVelocityDecay(50)).toBeCloseTo(0.9, 2);
  });

  it('returns minimum decay when zoomed out far', () => {
    expect(calculateVelocityDecay(20000)).toBeCloseTo(0.5, 2);
  });

  it('returns maximum decay below simulation Z min (1800)', () => {
    expect(calculateVelocityDecay(1000)).toBe(0.9);
  });

  it('decreases monotonically as Z increases (inverse of alpha)', () => {
    const values = [50, 1800, 5000, 20000].map(calculateVelocityDecay);

    // Below 1800: maximum decay
    expect(values[0]).toBe(0.9);
    expect(values[1]).toBe(0.9);

    // Above 1800: decreases as Z increases
    expect(values[2]).toBeLessThan(values[1]);
    expect(values[3]).toBeLessThan(values[2]);
  });

  it('clamps to valid range for extreme inputs', () => {
    for (const z of [-100, 100000]) {
      const decay = calculateVelocityDecay(z);
      expect(decay).toBeGreaterThanOrEqual(0.5);
      expect(decay).toBeLessThanOrEqual(0.9);
    }
  });
});
