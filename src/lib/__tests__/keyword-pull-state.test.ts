import { describe, expect, it } from "vitest";
import type { SimNode } from "@/lib/map-renderer";
import { computeKeywordPullState } from "@/lib/keyword-pull-state";
import type { ViewportZones } from "@/lib/viewport-edge-magnets";

const mockZones = (overrides?: Partial<ViewportZones>): ViewportZones => ({
  viewport: { left: -5, right: 5, bottom: -5, top: 5, camX: 0, camY: 0 },
  pullBounds: { left: -4, right: 4, bottom: -4, top: 4 },
  extendedViewport: { left: -6, right: 6, bottom: -6, top: 6, camX: 0, camY: 0 },
  worldPerPx: 1 / 100,
  ...overrides,
});

const node = (id: string, x: number, y: number): SimNode => ({
  id,
  label: id,
  type: "keyword",
  x,
  y,
});

describe("computeKeywordPullState", () => {
  it("removes cliff nodes that lack anchors to interior primaries", () => {
    const simNodes = [node("cliff", 4.5, 0)];
    const result = computeKeywordPullState({
      simNodes,
      adjacencyMap: new Map(),
      zones: mockZones(),
    });

    expect(result.pulledMap.has("cliff")).toBe(false);
    expect(result.primarySet.has("cliff")).toBe(false);
  });

  it("removes chains of margin nodes that only connect to each other", () => {
    const simNodes = [node("anchor", 0, 0), node("cliffA", 4.5, 0), node("cliffB", -4.5, 0)];
    const adjacency = new Map<string, Array<{ id: string; similarity: number }>>([
      ["cliffA", [{ id: "cliffB", similarity: 1 }]],
      ["cliffB", [{ id: "cliffA", similarity: 1 }]],
      ["anchor", []],
    ]);

    const { pulledMap } = computeKeywordPullState({
      simNodes,
      adjacencyMap: adjacency,
      zones: mockZones(),
    });

    expect(pulledMap.has("cliffA")).toBe(false);
    expect(pulledMap.has("cliffB")).toBe(false);
  });

  it("keeps cliff nodes when they have interior anchors", () => {
    const simNodes = [node("anchor", 0, 0), node("cliff", 4.5, 0)];
    const adjacency = new Map<string, Array<{ id: string; similarity: number }>>([
      ["anchor", [{ id: "cliff", similarity: 1 }]],
      ["cliff", [{ id: "anchor", similarity: 1 }]],
    ]);

    const result = computeKeywordPullState({
      simNodes,
      adjacencyMap: adjacency,
      zones: mockZones(),
    });

    expect(result.pulledMap.get("cliff")?.connectedPrimaryIds).toEqual(["anchor"]);
    expect(result.primarySet.has("anchor")).toBe(true);
  });

  it("adds off-screen neighbors with connected primaries and clamps them", () => {
    const simNodes = [
      node("primary", 0, 0),
      node("off", 10, 0),
    ];
    const adjacency = new Map<string, Array<{ id: string; similarity: number }>>([
      ["primary", [{ id: "off", similarity: 1 }]],
      ["off", [{ id: "primary", similarity: 1 }]],
    ]);

    const { pulledMap } = computeKeywordPullState({
      simNodes,
      adjacencyMap: adjacency,
      zones: mockZones(),
    });

    const pulled = pulledMap.get("off");
    expect(pulled?.connectedPrimaryIds).toEqual(["primary"]);
    expect(pulled?.x).toBeCloseTo(4, 1);
  });

  it("caps off-screen neighbors by similarity ranking", () => {
    const primaries = [node("p", 0, 0)];
    const neighbors = Array.from({ length: 10 }, (_, i) => node(`n${i}`, 10 + i, 0));
    const simNodes = [...primaries, ...neighbors];
    const adjacency = new Map<string, Array<{ id: string; similarity: number }>>();
    adjacency.set(
      "p",
      neighbors.map((n, idx) => ({ id: n.id, similarity: 10 - idx }))
    );
    for (const n of neighbors) {
      adjacency.set(n.id, [{ id: "p", similarity: 1 }]);
    }

    const { pulledMap } = computeKeywordPullState({
      simNodes,
      adjacencyMap: adjacency,
      zones: mockZones(),
      maxPulled: 3,
    });

    // 3 off-screen + no cliff nodes (only p is primary)
    expect(Array.from(pulledMap.keys())).toHaveLength(3);
  });

  it("only treats nodes inside pull bounds as primaries", () => {
    const simNodes = [node("inner", 0, 0), node("cliff", -4.5, 0)];
    const { primarySet } = computeKeywordPullState({
      simNodes,
      adjacencyMap: new Map(),
      zones: mockZones(),
    });

    expect(primarySet.has("inner")).toBe(true);
    expect(primarySet.has("cliff")).toBe(false);
  });
});
