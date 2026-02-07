import { describe, expect, it } from "vitest";
import { computeViewportZones, PULL_LINE_PX, UI_PROXIMITY_PX, VIEWPORT_OVERSCAN_PX } from "@/lib/viewport-edge-magnets";

const mockCamera = (positionZ = 1000) => ({
  position: { x: 0, y: 0, z: positionZ },
  fov: 50,
});

describe("computeViewportZones", () => {
  it("positions pull bounds strictly inside the viewport", () => {
    const zones = computeViewportZones(mockCamera() as any, 1000, 1000);
    expect(zones.pullBounds.left).toBeGreaterThan(zones.viewport.left);
    expect(zones.pullBounds.right).toBeLessThan(zones.viewport.right);
    expect(zones.pullBounds.top).toBeLessThan(zones.viewport.top);
    expect(zones.pullBounds.bottom).toBeGreaterThan(zones.viewport.bottom);
  });

  it("offsets pull bounds by margin + UI padding", () => {
    const zones = computeViewportZones(mockCamera() as any, 1000, 1000);
    const worldMargin = PULL_LINE_PX * zones.worldPerPx;
    const uiPadWorld = zones.worldPerPx * UI_PROXIMITY_PX;
    expect(zones.pullBounds.left).toBeCloseTo(zones.viewport.left + worldMargin + uiPadWorld);
    expect(zones.pullBounds.right).toBeCloseTo(zones.viewport.right - worldMargin);
  });

  it("extends extendedViewport by overscan amount", () => {
    const zones = computeViewportZones(mockCamera() as any, 1000, 500);
    const worldPerPx = zones.worldPerPx;
    const overscanWorld = VIEWPORT_OVERSCAN_PX * worldPerPx;
    expect(zones.extendedViewport.left).toBeCloseTo(zones.viewport.left - overscanWorld);
    expect(zones.extendedViewport.right).toBeCloseTo(zones.viewport.right + overscanWorld);
  });
});
