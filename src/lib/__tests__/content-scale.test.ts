import { describe, it, expect } from 'vitest';
import { calculateScales } from '../content-scale';
import { CONTENT_Z_TRANSITION_MIN, CONTENT_Z_TRANSITION_MAX } from '../content-zoom-config';

describe('calculateScales', () => {
  describe('scale interpolation', () => {
    it('should return full keyword scale when far away', () => {
      const scales = calculateScales(CONTENT_Z_TRANSITION_MAX);
      expect(scales.keywordScale).toBe(1);
      expect(scales.contentScale).toBe(0);
    });

    it('should return full content scale when very close', () => {
      const scales = calculateScales(CONTENT_Z_TRANSITION_MIN);
      expect(scales.keywordScale).toBe(0.3); // MIN_KEYWORD_SCALE
      expect(scales.contentScale).toBeCloseTo(1);
    });

    it('should interpolate scales at midpoint', () => {
      const midZ = (CONTENT_Z_TRANSITION_MIN + CONTENT_Z_TRANSITION_MAX) / 2;
      const scales = calculateScales(midZ);

      // At midpoint, t = 0.5, keywordScale = 0.3 + 0.5 * 0.7 = 0.65
      expect(scales.keywordScale).toBeCloseTo(0.65);
      // Content scale is exponential: (1 - 0.5)^2 = 0.25
      expect(scales.contentScale).toBeCloseTo(0.25);
    });

    it('should clamp scales when camera is beyond max range', () => {
      const scales = calculateScales(CONTENT_Z_TRANSITION_MAX + 1000);
      expect(scales.keywordScale).toBe(1);
      expect(scales.contentScale).toBe(0);
    });

    it('should clamp scales when camera is beyond min range', () => {
      const scales = calculateScales(CONTENT_Z_TRANSITION_MIN - 100);
      expect(scales.keywordScale).toBe(0.3); // MIN_KEYWORD_SCALE
      expect(scales.contentScale).toBeCloseTo(1);
    });
  });

  describe('exponential easing', () => {
    it('should use exponential easing for content scale', () => {
      // Test that content scale increases faster near the end (exponential)
      const z75 = CONTENT_Z_TRANSITION_MIN + (CONTENT_Z_TRANSITION_MAX - CONTENT_Z_TRANSITION_MIN) * 0.25;
      const z25 = CONTENT_Z_TRANSITION_MIN + (CONTENT_Z_TRANSITION_MAX - CONTENT_Z_TRANSITION_MIN) * 0.75;

      const scales75 = calculateScales(z75); // t=0.25, invT=0.75
      const scales25 = calculateScales(z25); // t=0.75, invT=0.25

      // At t=0.75, contentScale = (0.25)^2 = 0.0625
      // At t=0.25, contentScale = (0.75)^2 = 0.5625
      expect(scales25.contentScale).toBeCloseTo(0.0625);
      expect(scales75.contentScale).toBeCloseTo(0.5625);

      // Verify exponential behavior: content nodes grow faster as you get closer
      expect(scales75.contentScale).toBeGreaterThan(scales25.contentScale * 5);
    });

    it('should keep keyword scale linear', () => {
      const z25 = CONTENT_Z_TRANSITION_MIN + (CONTENT_Z_TRANSITION_MAX - CONTENT_Z_TRANSITION_MIN) * 0.25;
      const z50 = CONTENT_Z_TRANSITION_MIN + (CONTENT_Z_TRANSITION_MAX - CONTENT_Z_TRANSITION_MIN) * 0.5;
      const z75 = CONTENT_Z_TRANSITION_MIN + (CONTENT_Z_TRANSITION_MAX - CONTENT_Z_TRANSITION_MIN) * 0.75;

      const scales25 = calculateScales(z25);
      const scales50 = calculateScales(z50);
      const scales75 = calculateScales(z75);

      // Linear interpolation from 0.3 to 1.0: keywordScale = 0.3 + t * 0.7
      expect(scales25.keywordScale).toBeCloseTo(0.475); // 0.3 + 0.25 * 0.7
      expect(scales50.keywordScale).toBeCloseTo(0.65);  // 0.3 + 0.5 * 0.7
      expect(scales75.keywordScale).toBeCloseTo(0.825); // 0.3 + 0.75 * 0.7
    });
  });

  describe('opacity values', () => {
    it('should match chunk scale for edges and labels', () => {
      const scales = calculateScales(5000); // arbitrary value

      expect(scales.contentEdgeOpacity).toBe(scales.contentScale);
      expect(scales.contentLabelOpacity).toBe(scales.contentScale);
    });

    it('should fade keyword label opacity based on zoom', () => {
      // keywordLabelOpacity goes from 0 (close) to 1 (far), independently of keywordScale
      const scalesClose = calculateScales(CONTENT_Z_TRANSITION_MIN);
      const scalesFar = calculateScales(CONTENT_Z_TRANSITION_MAX);

      expect(scalesClose.keywordLabelOpacity).toBeCloseTo(0);
      expect(scalesFar.keywordLabelOpacity).toBeCloseTo(1);
    });
  });

  describe('performance', () => {
    it('should calculate scales in under 1ms', () => {
      const iterations = 1000;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        const z = CONTENT_Z_TRANSITION_MIN + Math.random() * (CONTENT_Z_TRANSITION_MAX - CONTENT_Z_TRANSITION_MIN);
        calculateScales(z);
      }

      const end = performance.now();
      const avgTime = (end - start) / iterations;

      expect(avgTime).toBeLessThan(1); // Should be much faster, but 1ms is a safe upper bound
    });
  });
});
