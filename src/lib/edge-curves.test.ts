import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import {
  computeOutwardDirection,
  computeCentroid,
  computeEdgeCurveDirections,
  type NodePosition,
} from "./edge-curves";
import { computeForceLayout } from "./map-layout";
import type { MapNode, MapEdge } from "@/app/api/map/route";

describe("computeOutwardDirection", () => {
  it("curves away from centroid for edge to the right of center", () => {
    // Centroid at origin, edge to the right
    const source = { id: "a", x: 100, y: -10 };
    const target = { id: "b", x: 100, y: 10 };
    const centroid = { x: 0, y: 0 };

    // Edge is vertical, centroid is to the left
    // "Outward" is to the right, perpendicular pointing left is direction 1
    // So we expect direction that makes arc bow right (away from centroid)
    const dir = computeOutwardDirection(source, target, centroid);

    // Verify by checking: the arc should bow away from centroid
    // Edge midpoint is (100, 0), centroid is (0, 0)
    // Outward direction is (100, 0) - pointing right
    // Edge direction is (0, 20), perpendicular is (-20, 0) - pointing left
    // Dot product: 100 * -20 + 0 * 0 = -2000 < 0, so direction = -1
    expect(dir).toBe(-1);
  });

  it("curves away from centroid for edge above center", () => {
    // Centroid at origin, edge above
    const source = { id: "a", x: -10, y: -100 };
    const target = { id: "b", x: 10, y: -100 };
    const centroid = { x: 0, y: 0 };

    const dir = computeOutwardDirection(source, target, centroid);

    // Edge midpoint is (0, -100), outward is (0, -100)
    // Edge direction is (20, 0), perpendicular is (0, 20)
    // Dot product: 0 * 0 + (-100) * 20 = -2000 < 0, so direction = -1
    expect(dir).toBe(-1);
  });

  it("returns consistent results for symmetric cases", () => {
    const centroid = { x: 0, y: 0 };

    // Four edges at cardinal directions, all horizontal
    const right = computeOutwardDirection(
      { id: "a", x: 100, y: -5 },
      { id: "b", x: 100, y: 5 },
      centroid
    );
    const left = computeOutwardDirection(
      { id: "a", x: -100, y: -5 },
      { id: "b", x: -100, y: 5 },
      centroid
    );

    // Both should curve away from center, but in opposite arc directions
    // due to the edge orientation relative to the centroid
    expect(right).toBe(-1); // bows right
    expect(left).toBe(1);   // bows left
  });
});

describe("computeCentroid", () => {
  it("computes average position", () => {
    const nodes = [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 10, y: 0 },
      { id: "c", x: 5, y: 10 },
    ];
    const c = computeCentroid(nodes);
    expect(c.x).toBe(5);
    expect(c.y).toBeCloseTo(3.33, 1);
  });

  it("handles empty array", () => {
    const c = computeCentroid([]);
    expect(c).toEqual({ x: 0, y: 0 });
  });
});

describe("computeEdgeCurveDirections with force layout", () => {
  // Create a simple cluster of nodes to test convex hull behavior
  function createTestGraph(): { nodes: MapNode[]; edges: MapEdge[] } {
    // A central hub with peripheral nodes
    const nodes: MapNode[] = [
      { id: "hub", type: "keyword", label: "hub" },
      { id: "n1", type: "article", label: "n1", size: 500 },
      { id: "n2", type: "article", label: "n2", size: 500 },
      { id: "n3", type: "article", label: "n3", size: 500 },
      { id: "n4", type: "article", label: "n4", size: 500 },
      { id: "n5", type: "article", label: "n5", size: 500 },
    ];

    // Connect all peripheral nodes to hub
    const edges: MapEdge[] = [
      { source: "hub", target: "n1", similarity: 0.8 },
      { source: "hub", target: "n2", similarity: 0.8 },
      { source: "hub", target: "n3", similarity: 0.8 },
      { source: "hub", target: "n4", similarity: 0.8 },
      { source: "hub", target: "n5", similarity: 0.8 },
      // Some peripheral connections
      { source: "n1", target: "n2", similarity: 0.6 },
      { source: "n2", target: "n3", similarity: 0.6 },
      { source: "n4", target: "n5", similarity: 0.6 },
    ];

    return { nodes, edges };
  }

  it("computes directions for all edges", () => {
    const { nodes, edges } = createTestGraph();

    // Run force layout to get positions
    const positions = computeForceLayout(nodes, edges, {
      width: 800,
      height: 800,
      maxTicks: 100,
    });

    // Convert to NodePosition format
    const nodePositions: NodePosition[] = positions.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
    }));

    const edgeRefs = edges.map((e) => ({ source: e.source, target: e.target }));

    const { directions, stats } = computeEdgeCurveDirections(nodePositions, edgeRefs);

    // Should have a direction for every edge
    expect(directions.size).toBe(edges.length);

    // All directions should be -1 or 1
    for (const dir of directions.values()) {
      expect(dir === -1 || dir === 1).toBe(true);
    }

    // Log stats for debugging
    console.log("Decision path stats:", stats);
  });

  it("analyzes decision paths with real map data", async () => {
    // Load real data from saved map JSON
    const dataPath = "/tmp/map-data.json";
    if (!fs.existsSync(dataPath)) {
      console.log("Skipping real data test - no map-data.json found");
      return;
    }

    const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    const nodes: MapNode[] = data.nodes;
    const edges: MapEdge[] = data.edges;

    console.log(`Loaded ${nodes.length} nodes and ${edges.length} edges`);

    // Run force layout
    const positions = computeForceLayout(nodes, edges, {
      width: 1200,
      height: 1200,
      maxTicks: 200,
    });

    const nodePositions: NodePosition[] = positions.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
    }));

    const edgeRefs = edges.map((e) => ({ source: e.source, target: e.target }));

    const { directions, stats } = computeEdgeCurveDirections(nodePositions, edgeRefs);

    console.log("Real data decision path stats:", stats);
    console.log("Percentages:", {
      noVotes: `${((stats.noVotes / edges.length) * 100).toFixed(1)}%`,
      singleVote: `${((stats.singleVote / edges.length) * 100).toFixed(1)}%`,
      agree: `${((stats.agree / edges.length) * 100).toFixed(1)}%`,
      hubWins: `${((stats.hubWins / edges.length) * 100).toFixed(1)}%`,
      outward: `${((stats.outward / edges.length) * 100).toFixed(1)}%`,
    });

    // Check how many edges curve outward vs inward
    const centroid = computeCentroid(nodePositions);
    let curvesOutward = 0;
    let curvesInward = 0;

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const source = nodePositions.find(p => p.id === edge.source);
      const target = nodePositions.find(p => p.id === edge.target);
      if (!source || !target) continue;

      const dir = directions.get(i)!;
      const outwardDir = computeOutwardDirection(source, target, centroid);

      if (dir === outwardDir) {
        curvesOutward++;
      } else {
        curvesInward++;
      }
    }

    console.log("Curve direction alignment:", {
      outward: curvesOutward,
      inward: curvesInward,
      outwardPct: `${((curvesOutward / edges.length) * 100).toFixed(1)}%`,
      inwardPct: `${((curvesInward / edges.length) * 100).toFixed(1)}%`,
    });

    expect(directions.size).toBe(edges.length);
  });

  it("peripheral edges should curve outward (away from centroid)", () => {
    const { nodes, edges } = createTestGraph();

    const positions = computeForceLayout(nodes, edges, {
      width: 800,
      height: 800,
      maxTicks: 200,
    });

    const posMap = new Map(positions.map((p) => [p.id, p]));
    const centroid = computeCentroid(positions);

    // Check the peripheral edges (n1-n2, n2-n3, n4-n5)
    const peripheralEdges = [
      { source: "n1", target: "n2" },
      { source: "n2", target: "n3" },
      { source: "n4", target: "n5" },
    ];

    for (const edge of peripheralEdges) {
      const source = posMap.get(edge.source)!;
      const target = posMap.get(edge.target)!;

      const dir = computeOutwardDirection(
        { id: source.id, x: source.x, y: source.y },
        { id: target.id, x: target.x, y: target.y },
        centroid
      );

      // Calculate the actual curve direction and verify it bows outward
      const midX = (source.x + target.x) / 2;
      const midY = (source.y + target.y) / 2;

      // Edge perpendicular
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const perpX = -dy / len;
      const perpY = dx / len;

      // The curve bows in the direction of (perpX, perpY) * dir
      // "Outward" means the curve apex should be farther from centroid than midpoint
      const curveOffsetX = perpX * dir * 10; // small offset in curve direction
      const curveOffsetY = perpY * dir * 10;

      const midDistToCentroid = Math.sqrt(
        (midX - centroid.x) ** 2 + (midY - centroid.y) ** 2
      );
      const curveApexDistToCentroid = Math.sqrt(
        (midX + curveOffsetX - centroid.x) ** 2 +
        (midY + curveOffsetY - centroid.y) ** 2
      );

      // The curve apex should be farther from centroid (outward)
      expect(curveApexDistToCentroid).toBeGreaterThan(midDistToCentroid);
    }
  });
});
