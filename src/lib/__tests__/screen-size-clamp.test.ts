import { describe, it, expect } from "vitest";
import { perspectiveUnitsPerPixel, maxScaleForScreenSize } from "@/lib/screen-size-clamp";

describe("perspectiveUnitsPerPixel", () => {
  // 90-degree FOV at distance 1000, viewport 500px tall
  // visible height = 2 * tan(45deg) * 1000 = 2000
  // units per pixel = 2000 / 500 = 4
  it("computes correct value for 90deg FOV", () => {
    const fov = Math.PI / 2; // 90 degrees
    const result = perspectiveUnitsPerPixel(fov, 1000, 500);
    expect(result).toBeCloseTo(4);
  });

  it("scales linearly with distance", () => {
    const fov = Math.PI / 4; // 45 degrees
    const at100 = perspectiveUnitsPerPixel(fov, 100, 800);
    const at200 = perspectiveUnitsPerPixel(fov, 200, 800);
    expect(at200).toBeCloseTo(at100 * 2);
  });

  it("scales inversely with viewport height", () => {
    const fov = Math.PI / 4;
    const at500 = perspectiveUnitsPerPixel(fov, 1000, 500);
    const at1000 = perspectiveUnitsPerPixel(fov, 1000, 1000);
    expect(at500).toBeCloseTo(at1000 * 2);
  });
});

describe("maxScaleForScreenSize", () => {
  it("returns 1 when object already matches max screen size", () => {
    // Object is 10 world units, max is 50px, 1 unit = 5px → 10 units = 50px
    const unitsPerPixel = 0.2; // 1 px = 0.2 world units → 1 unit = 5px
    const result = maxScaleForScreenSize(10, 50, unitsPerPixel);
    expect(result).toBeCloseTo(1);
  });

  it("returns < 1 when object would exceed max screen size", () => {
    // Object is 20 world units, max is 50px, 1 unit = 5px → 20 units = 100px (too big)
    const unitsPerPixel = 0.2;
    const result = maxScaleForScreenSize(20, 50, unitsPerPixel);
    expect(result).toBeCloseTo(0.5);
  });

  it("returns > 1 when object is smaller than max screen size", () => {
    // Object is 5 world units, max is 50px, 1 unit = 5px → 5 units = 25px (room to grow)
    const unitsPerPixel = 0.2;
    const result = maxScaleForScreenSize(5, 50, unitsPerPixel);
    expect(result).toBeCloseTo(2);
  });

  it("produces correct screen pixel size when applied", () => {
    const worldSize = 8;
    const maxPx = 40;
    const unitsPerPixel = 0.1; // 1 unit = 10px → 8 units = 80px unclamped
    const scale = maxScaleForScreenSize(worldSize, maxPx, unitsPerPixel);
    // Resulting screen size: worldSize * scale / unitsPerPixel
    const screenPx = (worldSize * scale) / unitsPerPixel;
    expect(screenPx).toBeCloseTo(maxPx);
  });
});
