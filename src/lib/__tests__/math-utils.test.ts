import { describe, it, expect } from 'vitest';
import { cosineSimilarity, applyContrast, normalize } from '../math-utils';

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const vec = [1, 2, 3, 4];
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0);
  });

  it('returns 1.0 for scalar multiples (same direction)', () => {
    const a = [1, 2, 3];
    const b = [2, 4, 6];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
  });

  it('returns -1.0 for opposite vectors', () => {
    const a = [1, 2, 3];
    const b = [-1, -2, -3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0);
  });

  it('returns correct value for general case', () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    // Manual calculation: dot = 4+10+18 = 32
    // normA = sqrt(1+4+9) = sqrt(14) ≈ 3.742
    // normB = sqrt(16+25+36) = sqrt(77) ≈ 8.775
    // similarity = 32 / (3.742 * 8.775) ≈ 0.9746
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.9746, 4);
  });

  it('handles zero vectors gracefully', () => {
    const zero = [0, 0, 0];
    const nonZero = [1, 2, 3];
    const result = cosineSimilarity(zero, nonZero);
    // Division by zero results in NaN
    expect(result).toBeNaN();
  });

  it('handles both zero vectors', () => {
    const zero1 = [0, 0, 0];
    const zero2 = [0, 0, 0];
    const result = cosineSimilarity(zero1, zero2);
    expect(result).toBeNaN();
  });
});

describe('applyContrast', () => {
  it('returns unchanged value when contrast=1 (linear case)', () => {
    expect(applyContrast(0.0, 1)).toBe(0.0);
    expect(applyContrast(0.3, 1)).toBe(0.3);
    expect(applyContrast(0.5, 1)).toBe(0.5);
    expect(applyContrast(0.7, 1)).toBe(0.7);
    expect(applyContrast(1.0, 1)).toBe(1.0);
  });

  it('keeps 0.5 unchanged at any contrast', () => {
    expect(applyContrast(0.5, 1)).toBe(0.5);
    expect(applyContrast(0.5, 2)).toBe(0.5);
    expect(applyContrast(0.5, 3)).toBe(0.5);
    expect(applyContrast(0.5, 10)).toBe(0.5);
  });

  it('pushes low values lower with high contrast', () => {
    const low = 0.3;
    const result = applyContrast(low, 3);
    expect(result).toBeLessThan(low);
    expect(result).toBeCloseTo(0.11, 2); // From docstring example
  });

  it('pushes high values higher with high contrast', () => {
    const high = 0.7;
    const result = applyContrast(high, 3);
    expect(result).toBeGreaterThan(high);
    expect(result).toBeCloseTo(0.89, 2); // From docstring example
  });

  it('matches all docstring examples at contrast=3', () => {
    expect(applyContrast(0.3, 3)).toBeCloseTo(0.11, 2);
    expect(applyContrast(0.5, 3)).toBeCloseTo(0.5, 2);
    expect(applyContrast(0.7, 3)).toBeCloseTo(0.89, 2);
    expect(applyContrast(0.9, 3)).toBeCloseTo(0.996, 3);
  });

  it('pushes extremes toward 0 and 1 with very high contrast', () => {
    const low = applyContrast(0.2, 10);
    const high = applyContrast(0.8, 10);
    expect(low).toBeCloseTo(0, 3);
    expect(high).toBeCloseTo(1, 3);
  });

  it('is symmetric around 0.5', () => {
    const contrast = 3;
    const low = applyContrast(0.3, contrast);
    const high = applyContrast(0.7, contrast);
    // Symmetric: applyContrast(0.5 - x) + applyContrast(0.5 + x) should equal 1
    expect(low + high).toBeCloseTo(1.0, 10);
  });

  it('handles edge cases 0 and 1', () => {
    expect(applyContrast(0.0, 3)).toBeCloseTo(0.0, 10);
    expect(applyContrast(1.0, 3)).toBeCloseTo(1.0, 10);
  });

  it('handles values very close to 0.5 boundary', () => {
    // Test values just above and below 0.5
    const justBelow = applyContrast(0.4999, 3);
    const justAbove = applyContrast(0.5001, 3);
    expect(justBelow).toBeLessThan(0.5);
    expect(justAbove).toBeGreaterThan(0.5);
    expect(justBelow).toBeCloseTo(0.5, 1);
    expect(justAbove).toBeCloseTo(0.5, 1);
  });
});

describe('normalize', () => {
  it('returns unit vector unchanged', () => {
    const unit = [1, 0, 0];
    const result = normalize(unit);
    expect(result).toEqual([1, 0, 0]);
  });

  it('normalizes general vector to length 1', () => {
    const vec = [3, 4]; // Length 5
    const result = normalize(vec);
    expect(result).toEqual([0.6, 0.8]);

    // Verify length is 1
    const length = Math.sqrt(result[0] ** 2 + result[1] ** 2);
    expect(length).toBeCloseTo(1.0);
  });

  it('normalizes 3D vector correctly', () => {
    const vec = [1, 2, 2]; // Length 3
    const result = normalize(vec);
    expect(result[0]).toBeCloseTo(1 / 3);
    expect(result[1]).toBeCloseTo(2 / 3);
    expect(result[2]).toBeCloseTo(2 / 3);

    // Verify length is 1
    const length = Math.sqrt(result.reduce((sum, v) => sum + v * v, 0));
    expect(length).toBeCloseTo(1.0);
  });

  it('handles zero vector gracefully', () => {
    const zero = [0, 0, 0];
    const result = normalize(zero);
    // Implementation returns original vector when norm is 0
    expect(result).toEqual([0, 0, 0]);
  });

  it('preserves direction of vector', () => {
    const vec = [2, 3, 6];
    const result = normalize(vec);

    // All components should have same sign ratio
    expect(result[0] / result[1]).toBeCloseTo(vec[0] / vec[1]);
    expect(result[1] / result[2]).toBeCloseTo(vec[1] / vec[2]);
  });

  it('handles negative components', () => {
    const vec = [-3, 4, 0]; // Length 5
    const result = normalize(vec);
    expect(result[0]).toBeCloseTo(-0.6);
    expect(result[1]).toBeCloseTo(0.8);
    expect(result[2]).toBe(0);

    const length = Math.sqrt(result.reduce((sum, v) => sum + v * v, 0));
    expect(length).toBeCloseTo(1.0);
  });

  it('handles very small vectors', () => {
    const vec = [1e-10, 2e-10, 2e-10]; // Very small but proportional to [1,2,2]
    const result = normalize(vec);

    // Should still normalize correctly
    const length = Math.sqrt(result.reduce((sum, v) => sum + v * v, 0));
    expect(length).toBeCloseTo(1.0);
  });

  it('handles very large vectors', () => {
    const vec = [1e10, 2e10, 2e10]; // Very large but proportional to [1,2,2]
    const result = normalize(vec);

    // Should still normalize correctly
    const length = Math.sqrt(result.reduce((sum, v) => sum + v * v, 0));
    expect(length).toBeCloseTo(1.0);
  });
});
