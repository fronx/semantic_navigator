import { describe, expect, it } from "vitest";
import { applyFisheyeCompression } from "@/lib/edge-pulling";

describe("applyFisheyeCompression", () => {
  const compressionStartRadius = 291.2;
  const maxRadius = 331.2;
  const camX = 0;
  const camY = 0;

  it("does not compress keywords within compression start radius", () => {
    // Use 250 which is < compressionStartRadius (291.2)
    const result = applyFisheyeCompression(250, 0, camX, camY, compressionStartRadius, maxRadius);
    expect(result.x).toBe(250);
    expect(result.y).toBe(0);
  });

  it("compresses keywords beyond compression start radius", () => {
    const result = applyFisheyeCompression(600, 0, camX, camY, compressionStartRadius, maxRadius);
    const distance = Math.sqrt(result.x ** 2 + result.y ** 2);

    // Should be compressed from 600 to within maxRadius
    expect(distance).toBeLessThan(600);
    expect(distance).toBeLessThanOrEqual(maxRadius + 0.1); // Allow small floating point error
  });

  it("compresses far off-screen keywords to near maxRadius", () => {
    const result = applyFisheyeCompression(1500, 0, camX, camY, compressionStartRadius, maxRadius);
    const distance = Math.sqrt(result.x ** 2 + result.y ** 2);

    // Should be heavily compressed to near maxRadius
    expect(distance).toBeLessThanOrEqual(maxRadius + 0.1);
    expect(distance).toBeGreaterThan(maxRadius - 10); // Should be close to maxRadius
  });

  it("asymptotically approaches maxRadius for extremely distant keywords", () => {
    const result = applyFisheyeCompression(10000, 0, camX, camY, compressionStartRadius, maxRadius);
    const distance = Math.sqrt(result.x ** 2 + result.y ** 2);

    // Should approach but never exceed maxRadius
    expect(distance).toBeLessThanOrEqual(maxRadius + 0.1);
    expect(Math.abs(distance - maxRadius)).toBeLessThan(1); // Very close to maxRadius
  });

  it("preserves direction while compressing distance", () => {
    const result = applyFisheyeCompression(600, 300, camX, camY, compressionStartRadius, maxRadius);

    // Direction (angle) should be preserved
    const originalAngle = Math.atan2(300, 600);
    const compressedAngle = Math.atan2(result.y, result.x);
    expect(compressedAngle).toBeCloseTo(originalAngle, 5);

    // But distance should be compressed
    const originalDistance = Math.sqrt(600 ** 2 + 300 ** 2);
    const compressedDistance = Math.sqrt(result.x ** 2 + result.y ** 2);
    expect(compressedDistance).toBeLessThan(originalDistance);
    expect(compressedDistance).toBeLessThanOrEqual(maxRadius + 0.1);
  });

  it("handles keywords exactly at compression start radius", () => {
    const result = applyFisheyeCompression(
      compressionStartRadius,
      0,
      camX,
      camY,
      compressionStartRadius,
      maxRadius
    );
    expect(result.x).toBe(compressionStartRadius);
    expect(result.y).toBe(0);
  });

  it("handles negative coordinates correctly", () => {
    const result = applyFisheyeCompression(-600, -300, camX, camY, compressionStartRadius, maxRadius);
    const distance = Math.sqrt(result.x ** 2 + result.y ** 2);

    expect(result.x).toBeLessThan(0); // Should stay negative
    expect(result.y).toBeLessThan(0);
    expect(distance).toBeLessThanOrEqual(maxRadius + 0.1);
  });
});
