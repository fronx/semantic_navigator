import { describe, it, expect } from 'vitest';
import { calculateScales } from '../chunk-scale';
import { CHUNK_Z_TRANSITION_MIN, CHUNK_Z_TRANSITION_MAX } from '../chunk-zoom-config';

describe('calculateScales', () => {
  describe('scale interpolation', () => {
    it('should return full keyword scale when far away', () => {
      const scales = calculateScales(CHUNK_Z_TRANSITION_MAX);
      expect(scales.keywordScale).toBe(1);
      expect(scales.chunkScale).toBe(0);
    });

    it('should return full chunk scale when very close', () => {
      const scales = calculateScales(CHUNK_Z_TRANSITION_MIN);
      expect(scales.keywordScale).toBe(0);
      expect(scales.chunkScale).toBeCloseTo(1);
    });

    it('should interpolate scales at midpoint', () => {
      const midZ = (CHUNK_Z_TRANSITION_MIN + CHUNK_Z_TRANSITION_MAX) / 2;
      const scales = calculateScales(midZ);

      // At midpoint, t = 0.5
      expect(scales.keywordScale).toBeCloseTo(0.5);
      // Chunk scale is exponential: (1 - 0.5)^2 = 0.25
      expect(scales.chunkScale).toBeCloseTo(0.25);
    });

    it('should clamp scales when camera is beyond max range', () => {
      const scales = calculateScales(CHUNK_Z_TRANSITION_MAX + 1000);
      expect(scales.keywordScale).toBe(1);
      expect(scales.chunkScale).toBe(0);
    });

    it('should clamp scales when camera is beyond min range', () => {
      const scales = calculateScales(CHUNK_Z_TRANSITION_MIN - 100);
      expect(scales.keywordScale).toBe(0);
      expect(scales.chunkScale).toBeCloseTo(1);
    });
  });

  describe('exponential easing', () => {
    it('should use exponential easing for chunk scale', () => {
      // Test that chunk scale increases faster near the end (exponential)
      const z75 = CHUNK_Z_TRANSITION_MIN + (CHUNK_Z_TRANSITION_MAX - CHUNK_Z_TRANSITION_MIN) * 0.25;
      const z25 = CHUNK_Z_TRANSITION_MIN + (CHUNK_Z_TRANSITION_MAX - CHUNK_Z_TRANSITION_MIN) * 0.75;

      const scales75 = calculateScales(z75); // t=0.25, invT=0.75
      const scales25 = calculateScales(z25); // t=0.75, invT=0.25

      // At t=0.75, chunkScale = (0.25)^2 = 0.0625
      // At t=0.25, chunkScale = (0.75)^2 = 0.5625
      expect(scales25.chunkScale).toBeCloseTo(0.0625);
      expect(scales75.chunkScale).toBeCloseTo(0.5625);

      // Verify exponential behavior: chunks grow faster as you get closer
      expect(scales75.chunkScale).toBeGreaterThan(scales25.chunkScale * 5);
    });

    it('should keep keyword scale linear', () => {
      const z25 = CHUNK_Z_TRANSITION_MIN + (CHUNK_Z_TRANSITION_MAX - CHUNK_Z_TRANSITION_MIN) * 0.25;
      const z50 = CHUNK_Z_TRANSITION_MIN + (CHUNK_Z_TRANSITION_MAX - CHUNK_Z_TRANSITION_MIN) * 0.5;
      const z75 = CHUNK_Z_TRANSITION_MIN + (CHUNK_Z_TRANSITION_MAX - CHUNK_Z_TRANSITION_MIN) * 0.75;

      const scales25 = calculateScales(z25);
      const scales50 = calculateScales(z50);
      const scales75 = calculateScales(z75);

      // Linear interpolation: evenly spaced
      expect(scales25.keywordScale).toBeCloseTo(0.25);
      expect(scales50.keywordScale).toBeCloseTo(0.5);
      expect(scales75.keywordScale).toBeCloseTo(0.75);
    });
  });

  describe('opacity values', () => {
    it('should match chunk scale for edges and labels', () => {
      const scales = calculateScales(5000); // arbitrary value

      expect(scales.chunkEdgeOpacity).toBe(scales.chunkScale);
      expect(scales.chunkLabelOpacity).toBe(scales.chunkScale);
    });

    it('should match keyword scale for label opacity', () => {
      const scales = calculateScales(5000);
      expect(scales.keywordLabelOpacity).toBe(scales.keywordScale);
    });
  });

  describe('performance', () => {
    it('should calculate scales in under 1ms', () => {
      const iterations = 1000;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        const z = CHUNK_Z_TRANSITION_MIN + Math.random() * (CHUNK_Z_TRANSITION_MAX - CHUNK_Z_TRANSITION_MIN);
        calculateScales(z);
      }

      const end = performance.now();
      const avgTime = (end - start) / iterations;

      expect(avgTime).toBeLessThan(1); // Should be much faster, but 1ms is a safe upper bound
    });
  });
});
