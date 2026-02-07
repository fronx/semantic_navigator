import { describe, it, expect } from 'vitest';
import { computeLabelFade, type LabelFadeRange } from '../label-fade-coordinator';

// Default range matching zoomPhaseConfig.keywordLabels
const DEFAULT_RANGE: LabelFadeRange = { start: 13961, full: 1200 };

describe('computeLabelFade', () => {
  describe('boundary values', () => {
    it('returns 1 when at close boundary (full)', () => {
      expect(computeLabelFade(1200, DEFAULT_RANGE)).toBe(1);
    });

    it('returns 0 when at far boundary (start)', () => {
      expect(computeLabelFade(13961, DEFAULT_RANGE)).toBe(0);
    });

    it('returns 1 when closer than close boundary', () => {
      expect(computeLabelFade(500, DEFAULT_RANGE)).toBe(1);
    });

    it('returns 0 when further than far boundary', () => {
      expect(computeLabelFade(20000, DEFAULT_RANGE)).toBe(0);
    });
  });

  describe('interpolation', () => {
    it('returns ~0.5 at midpoint (smoothstep has inflection at 0.5)', () => {
      const mid = (1200 + 13961) / 2;
      const result = computeLabelFade(mid, DEFAULT_RANGE);
      expect(result).toBeCloseTo(0.5, 1);
    });

    it('increases monotonically as cameraZ decreases', () => {
      const zValues = [13000, 10000, 7000, 4000, 2000];
      const results = zValues.map(z => computeLabelFade(z, DEFAULT_RANGE));

      for (let i = 1; i < results.length; i++) {
        expect(results[i]).toBeGreaterThan(results[i - 1]);
      }
    });

    it('uses smoothstep (not linear) interpolation', () => {
      // Smoothstep has slower ramp at edges, steeper in middle
      // At t=0.25 linear: smoothstep(0.25) = 0.15625
      // At t=0.75 linear: smoothstep(0.75) = 0.84375
      const span = 13961 - 1200;
      const z75 = 13961 - 0.25 * span; // t=0.25 from far end
      const z25 = 13961 - 0.75 * span; // t=0.75 from far end

      const result25 = computeLabelFade(z75, DEFAULT_RANGE);
      const result75 = computeLabelFade(z25, DEFAULT_RANGE);

      expect(result25).toBeCloseTo(0.15625, 2);
      expect(result75).toBeCloseTo(0.84375, 2);
    });
  });

  describe('range normalization', () => {
    it('handles start > full (normal order)', () => {
      const result = computeLabelFade(1200, { start: 13961, full: 1200 });
      expect(result).toBe(1);
    });

    it('handles start < full (swapped order)', () => {
      const result = computeLabelFade(1200, { start: 1200, full: 13961 });
      expect(result).toBe(1);
    });

    it('returns 1 when start === full (zero span)', () => {
      expect(computeLabelFade(5000, { start: 5000, full: 5000 })).toBe(1);
    });
  });

  describe('cross-fade property', () => {
    it('cluster and keyword opacities sum to ~1 across the range', () => {
      const zValues = [2000, 4000, 6000, 8000, 10000, 12000];
      for (const z of zValues) {
        const fadeT = computeLabelFade(z, DEFAULT_RANGE);
        const clusterOpacity = 1 - fadeT;
        const keywordOpacity = fadeT;
        expect(clusterOpacity + keywordOpacity).toBeCloseTo(1);
      }
    });
  });
});
