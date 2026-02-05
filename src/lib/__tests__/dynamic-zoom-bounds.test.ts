import { describe, test, expect } from 'vitest';
import { calculateBoundingBox, calculateCameraZForBounds } from '../dynamic-zoom-bounds';

describe('calculateBoundingBox', () => {
  test('calculates bounds from positioned nodes', () => {
    const nodes = [
      { x: 10, y: 20 },
      { x: 100, y: 50 },
      { x: -50, y: 100 },
    ];

    const bounds = calculateBoundingBox(nodes);

    expect(bounds).toEqual({
      minX: -50,
      maxX: 100,
      minY: 20,
      maxY: 100,
    });
  });

  test('returns null when no nodes provided', () => {
    const bounds = calculateBoundingBox([]);

    expect(bounds).toBeNull();
  });

  test('skips nodes with undefined positions', () => {
    const nodes = [
      { x: undefined, y: undefined },
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ];

    const bounds = calculateBoundingBox(nodes);

    expect(bounds).toEqual({
      minX: 10,
      maxX: 30,
      minY: 20,
      maxY: 40,
    });
  });

  test('skips nodes at origin (0, 0)', () => {
    const nodes = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
    ];

    const bounds = calculateBoundingBox(nodes);

    expect(bounds).toEqual({
      minX: 10,
      maxX: 10,
      minY: 20,
      maxY: 20,
    });
  });

  test('returns null when all nodes are at origin or undefined', () => {
    const nodes = [
      { x: 0, y: 0 },
      { x: undefined, y: undefined },
    ];

    const bounds = calculateBoundingBox(nodes);

    expect(bounds).toBeNull();
  });

  test('handles single positioned node', () => {
    const nodes = [
      { x: 50, y: 75 },
    ];

    const bounds = calculateBoundingBox(nodes);

    expect(bounds).toEqual({
      minX: 50,
      maxX: 50,
      minY: 75,
      maxY: 75,
    });
  });
});

describe('calculateCameraZForBounds', () => {
  const FOV_DEGREES = 10;
  const FOV_RADIANS = FOV_DEGREES * (Math.PI / 180);

  test('calculates camera Z to fit bounds with margin', () => {
    const bounds = {
      minX: -100,
      maxX: 100,
      minY: -50,
      maxY: 50,
    };
    const viewport = { width: 1920, height: 1080 };
    const margin = 1.5; // 50% margin

    const cameraZ = calculateCameraZForBounds(bounds, viewport, margin);

    // Bounds: 200 wide, 100 tall
    // With 1.5x margin: 300 wide, 150 tall
    // Aspect ratio: 1920/1080 = 1.778
    // Required Z should fit the limiting dimension
    const expectedWidth = 200 * margin;
    const expectedHeight = 100 * margin;
    const aspect = viewport.width / viewport.height;

    const zForWidth = expectedWidth / (2 * Math.tan(FOV_RADIANS / 2) * aspect);
    const zForHeight = expectedHeight / (2 * Math.tan(FOV_RADIANS / 2));
    const expectedZ = Math.max(zForWidth, zForHeight);

    expect(cameraZ).toBeCloseTo(expectedZ, 1);
  });

  test('handles tall narrow bounds (height-limited)', () => {
    const bounds = {
      minX: -10,
      maxX: 10,
      minY: -200,
      maxY: 200,
    };
    const viewport = { width: 1920, height: 1080 };
    const margin = 1.5;

    const cameraZ = calculateCameraZForBounds(bounds, viewport, margin);

    // Height (400 * 1.5 = 600) should be limiting factor
    const expectedHeight = 400 * margin;
    const expectedZ = expectedHeight / (2 * Math.tan(FOV_RADIANS / 2));

    expect(cameraZ).toBeCloseTo(expectedZ, 1);
  });

  test('handles wide flat bounds (width-limited)', () => {
    const bounds = {
      minX: -300,
      maxX: 300,
      minY: -10,
      maxY: 10,
    };
    const viewport = { width: 1920, height: 1080 };
    const margin = 1.5;

    const cameraZ = calculateCameraZForBounds(bounds, viewport, margin);

    // Width (600 * 1.5 = 900) should be limiting factor when considering aspect
    const expectedWidth = 600 * margin;
    const aspect = viewport.width / viewport.height;
    const expectedZ = expectedWidth / (2 * Math.tan(FOV_RADIANS / 2) * aspect);

    expect(cameraZ).toBeCloseTo(expectedZ, 1);
  });

  test('enforces minimum camera Z for tiny bounds', () => {
    const bounds = {
      minX: -1,
      maxX: 1,
      minY: -1,
      maxY: 1,
    };
    const viewport = { width: 1920, height: 1080 };
    const margin = 1.5;

    const cameraZ = calculateCameraZForBounds(bounds, viewport, margin);

    // Should enforce minimum (e.g., 500) to prevent excessive zoom-in
    expect(cameraZ).toBeGreaterThanOrEqual(500);
  });

  test('handles single-point bounds (zero width/height)', () => {
    const bounds = {
      minX: 50,
      maxX: 50,
      minY: 75,
      maxY: 75,
    };
    const viewport = { width: 1920, height: 1080 };
    const margin = 1.5;

    const cameraZ = calculateCameraZForBounds(bounds, viewport, margin);

    // Should use minimum default radius
    expect(cameraZ).toBeGreaterThanOrEqual(500);
  });
});
