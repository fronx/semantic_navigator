import { describe, expect, it } from "vitest";
import { computeContentPullState } from "@/lib/content-pull-state";
import type { ViewportZones } from "@/lib/viewport-edge-magnets";
import type { SimNode } from "@/lib/map-renderer";

const mockZones = (): ViewportZones => ({
  viewport: { left: -5, right: 5, bottom: -5, top: 5, camX: 0, camY: 0 },
  pullBounds: { left: -4, right: 4, bottom: -4, top: 4 },
  extendedViewport: { left: -6, right: 6, bottom: -6, top: 6, camX: 0, camY: 0 },
  worldPerPx: 1 / 100,
});

const content = (id: string, x: number, y: number, parents: string[]): SimNode => ({
  id,
  label: id,
  type: "chunk",
  x,
  y,
  parentIds: parents,
});

describe("computeContentPullState", () => {
  it("clamps cliff content nodes", () => {
    const nodes = [
      content("c1", 4.6, 0, ["p1"]),
      content("c2", 0, 0, ["p1"]),
    ];
    const pulled = computeContentPullState({
      contentNodes: nodes,
      primaryKeywordIds: new Set(["p1"]),
      zones: mockZones(),
    });
    expect(pulled.get("c1")).toBeDefined();
    expect(pulled.get("c2")).toBeUndefined();
  });

  it("skips nodes with no visible parents", () => {
    const nodes = [content("c1", 10, 0, ["hidden"])];
    const pulled = computeContentPullState({
      contentNodes: nodes,
      primaryKeywordIds: new Set(["p1"]),
      zones: mockZones(),
    });
    expect(pulled.size).toBe(0);
  });

  it("caps off-screen content nodes", () => {
    const nodes = Array.from({ length: 10 }, (_, i) => content(`c${i}`, 10 + i, 0, ["p1"]));
    const pulled = computeContentPullState({
      contentNodes: nodes,
      primaryKeywordIds: new Set(["p1"]),
      zones: mockZones(),
      maxPulled: 3,
    });
    expect(pulled.size).toBe(3);
  });
});
