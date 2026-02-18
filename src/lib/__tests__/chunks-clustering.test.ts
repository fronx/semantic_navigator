import { describe, it, expect } from "vitest";
import { clusterUmapGraph } from "@/lib/chunks-clustering";

describe("clusterUmapGraph", () => {
  it("assigns all nodes to clusters", () => {
    // Two cliques connected by one weak edge
    const edges = [
      { source: 0, target: 1, weight: 1.0 },
      { source: 1, target: 2, weight: 1.0 },
      { source: 0, target: 2, weight: 1.0 },
      { source: 3, target: 4, weight: 1.0 },
      { source: 4, target: 5, weight: 1.0 },
      { source: 3, target: 5, weight: 1.0 },
      { source: 2, target: 3, weight: 0.1 }, // weak bridge
    ];
    const nodeCount = 6;
    const result = clusterUmapGraph(edges, nodeCount, 1.0);

    // Every node gets a cluster
    expect(result.size).toBe(nodeCount);
    for (let i = 0; i < nodeCount; i++) {
      expect(result.has(i)).toBe(true);
    }
  });

  it("separates loosely-connected cliques at high resolution", () => {
    const edges = [
      { source: 0, target: 1, weight: 1.0 },
      { source: 1, target: 2, weight: 1.0 },
      { source: 0, target: 2, weight: 1.0 },
      { source: 3, target: 4, weight: 1.0 },
      { source: 4, target: 5, weight: 1.0 },
      { source: 3, target: 5, weight: 1.0 },
      { source: 2, target: 3, weight: 0.05 },
    ];
    const result = clusterUmapGraph(edges, 6, 2.0);

    // Nodes 0-2 should be in same cluster, 3-5 in another
    expect(result.get(0)).toBe(result.get(1));
    expect(result.get(1)).toBe(result.get(2));
    expect(result.get(3)).toBe(result.get(4));
    expect(result.get(4)).toBe(result.get(5));
    expect(result.get(0)).not.toBe(result.get(3));
  });
});
