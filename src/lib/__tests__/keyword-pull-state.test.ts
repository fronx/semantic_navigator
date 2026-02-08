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

  describe("content-driven keyword pulling", () => {
    // Zone positions for mockZones:
    //   primary zone:  |x| < 4  (inside pullBounds)
    //   cliff zone:    4 < |x| < 6  (between pullBounds and extendedViewport)
    //   off-screen:    |x| > 6  (outside extendedViewport)
    const positions = {
      primary: { x: 0, y: 0 },
      cliff: { x: 4.5, y: 0 },
      offScreen: { x: 20, y: 0 },
    } as const;

    type Zone = keyof typeof positions;

    function runWithContentDriven(zone: Zone, opts?: {
      adjacencyMap?: Map<string, Array<{ id: string; similarity: number }>>;
      extraNodes?: SimNode[];
      maxPulled?: number;
    }) {
      const { x, y } = positions[zone];
      const kw = node("kw", x, y);
      const simNodes = [node("anchor", 0, 0), kw, ...(opts?.extraNodes ?? [])];
      return computeKeywordPullState({
        simNodes,
        adjacencyMap: opts?.adjacencyMap ?? new Map(),
        zones: mockZones(),
        maxPulled: opts?.maxPulled,
        contentDrivenKeywordIds: new Set(["kw"]),
      });
    }

    // INVARIANT 1: A content-driven keyword is always visible.
    // If primary → in primarySet. Otherwise → in pulledMap.
    describe("invariant: content-driven keyword is always visible", () => {
      it.each<Zone>(["primary", "cliff", "offScreen"])("zone=%s", (zone) => {
        const { pulledMap, primarySet } = runWithContentDriven(zone);
        const isVisible = primarySet.has("kw") || pulledMap.has("kw");
        expect(isVisible).toBe(true);
      });
    });

    // INVARIANT 2: Anchor validation never removes a content-driven keyword.
    // Even with no adjacency neighbors, content-driven keywords survive.
    describe("invariant: anchor validation never removes content-driven keyword", () => {
      it.each<Zone>(["cliff", "offScreen"])("zone=%s, no adjacency", (zone) => {
        const { pulledMap } = runWithContentDriven(zone, {
          adjacencyMap: new Map(),
        });
        expect(pulledMap.has("kw")).toBe(true);
      });
    });

    // INVARIANT 3: A primary keyword stays primary — content-driven doesn't demote it.
    it("primary keyword stays in primarySet, not pulledMap", () => {
      const { pulledMap, primarySet } = runWithContentDriven("primary");
      expect(primarySet.has("kw")).toBe(true);
      expect(pulledMap.has("kw")).toBe(false);
    });

    // INVARIANT 4: Content-driven keywords get priority over adjacency candidates.
    // With N content-driven + M adjacency candidates and maxPulled < N+M,
    // all N content-driven must be present; adjacency fills remaining slots.
    it("content-driven keywords reserve slots before adjacency", () => {
      const adjNeighbors = Array.from({ length: 5 }, (_, i) =>
        node(`adj${i}`, 10 + i, 0)
      );
      const adjacency = new Map<string, Array<{ id: string; similarity: number }>>();
      adjacency.set("anchor", adjNeighbors.map((n, i) => ({ id: n.id, similarity: 10 - i })));
      for (const n of adjNeighbors) {
        adjacency.set(n.id, [{ id: "anchor", similarity: 1 }]);
      }

      const { pulledMap } = runWithContentDriven("offScreen", {
        adjacencyMap: adjacency,
        extraNodes: adjNeighbors,
        maxPulled: 3,
      });

      // Content-driven keyword must be pulled
      expect(pulledMap.has("kw")).toBe(true);
      // Adjacency fills remaining 2 slots
      const adjPulled = adjNeighbors.filter(n => pulledMap.has(n.id));
      expect(adjPulled.length).toBe(2);
    });

    // INVARIANT 5: Pulled position is clamped to pullBounds.
    describe("invariant: pulled position is clamped to pullBounds", () => {
      it.each<Zone>(["cliff", "offScreen"])("zone=%s", (zone) => {
        const { pulledMap } = runWithContentDriven(zone);
        const pulled = pulledMap.get("kw")!;
        const bounds = mockZones().pullBounds;
        expect(pulled.x).toBeGreaterThanOrEqual(bounds.left);
        expect(pulled.x).toBeLessThanOrEqual(bounds.right);
        expect(pulled.y).toBeGreaterThanOrEqual(bounds.bottom);
        expect(pulled.y).toBeLessThanOrEqual(bounds.top);
      });
    });

    // INVARIANT 6: realX/realY preserves the original simulation position.
    describe("invariant: realX/realY preserves original position", () => {
      it.each<Zone>(["cliff", "offScreen"])("zone=%s", (zone) => {
        const { pulledMap } = runWithContentDriven(zone);
        const pulled = pulledMap.get("kw")!;
        const { x, y } = positions[zone];
        expect(pulled.realX).toBe(x);
        expect(pulled.realY).toBe(y);
      });
    });
  });
});
