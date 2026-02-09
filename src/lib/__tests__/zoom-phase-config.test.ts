import { describe, it, expect } from 'vitest';
import {
  calculateZoomBasedDesaturation,
  calculateClusterLabelDesaturation,
  DEFAULT_ZOOM_PHASE_CONFIG,
} from '../zoom-phase-config';

describe('calculateZoomBasedDesaturation', () => {
  const config = DEFAULT_ZOOM_PHASE_CONFIG;
  const clusterLevel = config.keywordLabels.start; // ~13961
  const keywordLevel = config.chunkCrossfade.far; // ~3736
  const detailLevel = config.chunkCrossfade.near; // ~2052

  it('returns 0% desaturation when zoomed out to cluster level', () => {
    const desaturation = calculateZoomBasedDesaturation(clusterLevel, config);
    expect(desaturation).toBeCloseTo(0, 2);
  });

  it('returns 30% desaturation at keyword level', () => {
    const desaturation = calculateZoomBasedDesaturation(keywordLevel, config);
    expect(desaturation).toBeCloseTo(0.3, 2);
  });

  it('returns 65% desaturation at detail level', () => {
    const desaturation = calculateZoomBasedDesaturation(detailLevel, config);
    expect(desaturation).toBeCloseTo(0.65, 2);
  });

  it('interpolates correctly between cluster and keyword levels', () => {
    // Halfway between cluster and keyword should be 15%
    const midpoint = (clusterLevel + keywordLevel) / 2;
    const desaturation = calculateZoomBasedDesaturation(midpoint, config);
    expect(desaturation).toBeCloseTo(0.15, 2);
  });

  it('interpolates correctly between keyword and detail levels', () => {
    // Halfway between keyword and detail should be 47.5% (30% + 35%/2)
    const midpoint = (keywordLevel + detailLevel) / 2;
    const desaturation = calculateZoomBasedDesaturation(midpoint, config);
    expect(desaturation).toBeCloseTo(0.475, 2);
  });

  it('clamps values above cluster level to 0%', () => {
    const desaturation = calculateZoomBasedDesaturation(clusterLevel + 1000, config);
    expect(desaturation).toBeCloseTo(0, 2);
  });

  it('clamps values below detail level to 65%', () => {
    const desaturation = calculateZoomBasedDesaturation(detailLevel - 1000, config);
    expect(desaturation).toBeCloseTo(0.65, 2);
  });

  it('returns values in valid range [0, 1]', () => {
    const testValues = [
      clusterLevel * 2,
      clusterLevel,
      (clusterLevel + keywordLevel) / 2,
      keywordLevel,
      (keywordLevel + detailLevel) / 2,
      detailLevel,
      detailLevel / 2,
    ];

    testValues.forEach((z) => {
      const desaturation = calculateZoomBasedDesaturation(z, config);
      expect(desaturation).toBeGreaterThanOrEqual(0);
      expect(desaturation).toBeLessThanOrEqual(1);
    });
  });
});

describe('calculateClusterLabelDesaturation', () => {
  const config = DEFAULT_ZOOM_PHASE_CONFIG;
  const clusterLevel = config.keywordLabels.start; // ~13961
  const keywordLevel = config.keywordLabels.full; // ~1200

  it('returns 100% desaturation when zoomed out to cluster level (grayscale)', () => {
    const desaturation = calculateClusterLabelDesaturation(clusterLevel, config);
    expect(desaturation).toBeCloseTo(1.0, 2);
  });

  it('returns 0% desaturation when zoomed in to keyword level (saturated)', () => {
    const desaturation = calculateClusterLabelDesaturation(keywordLevel, config);
    expect(desaturation).toBeCloseTo(0, 2);
  });

  it('returns 50% desaturation at midpoint', () => {
    const midpoint = (clusterLevel + keywordLevel) / 2;
    const desaturation = calculateClusterLabelDesaturation(midpoint, config);
    expect(desaturation).toBeCloseTo(0.5, 2);
  });

  it('interpolates linearly', () => {
    // At 25% from cluster level toward keyword level
    const quarterPoint = clusterLevel - (clusterLevel - keywordLevel) * 0.25;
    const desaturation = calculateClusterLabelDesaturation(quarterPoint, config);
    expect(desaturation).toBeCloseTo(0.75, 2); // 75% desaturated (still mostly gray)
  });

  it('clamps values above cluster level to 100%', () => {
    const desaturation = calculateClusterLabelDesaturation(clusterLevel + 1000, config);
    expect(desaturation).toBeCloseTo(1.0, 2);
  });

  it('clamps values below keyword level to 0%', () => {
    const desaturation = calculateClusterLabelDesaturation(keywordLevel - 1000, config);
    expect(desaturation).toBeCloseTo(0, 2);
  });

  it('returns values in valid range [0, 1]', () => {
    const testValues = [
      clusterLevel * 2,
      clusterLevel,
      (clusterLevel + keywordLevel) / 2,
      keywordLevel,
      keywordLevel / 2,
    ];

    testValues.forEach((z) => {
      const desaturation = calculateClusterLabelDesaturation(z, config);
      expect(desaturation).toBeGreaterThanOrEqual(0);
      expect(desaturation).toBeLessThanOrEqual(1);
    });
  });

  it('has inverse behavior from keyword desaturation', () => {
    // When zoomed out: cluster labels desaturated (gray), keywords not desaturated yet
    const farZ = clusterLevel;
    const clusterDesat = calculateClusterLabelDesaturation(farZ, config);
    const keywordDesat = calculateZoomBasedDesaturation(farZ, config);

    expect(clusterDesat).toBeCloseTo(1.0, 2); // Cluster desaturated (gray)
    expect(keywordDesat).toBeCloseTo(0, 2); // Keywords saturated

    // When zoomed in: cluster labels saturated (colorful), keywords desaturated
    const nearZ = keywordLevel;
    const clusterDesatNear = calculateClusterLabelDesaturation(nearZ, config);

    expect(clusterDesatNear).toBeCloseTo(0, 2); // Cluster saturated (colorful)
  });
});
