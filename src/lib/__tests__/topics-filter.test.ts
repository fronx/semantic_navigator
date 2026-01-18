import { describe, it, expect } from "vitest";
import { computeEffectiveFilter, filterNodes, filterEdges } from "../topics-filter";
import type { SimilarityEdge } from "@/lib/graph-queries";

describe("computeEffectiveFilter", () => {
  it("returns null when both filters are null", () => {
    expect(computeEffectiveFilter(null, null)).toBeNull();
  });

  it("returns null when external is undefined and internal is null", () => {
    expect(computeEffectiveFilter(undefined, null)).toBeNull();
  });

  it("returns externalFilter when filteredNodeIds is null", () => {
    const external = new Set(["a", "b"]);
    expect(computeEffectiveFilter(external, null)).toEqual(external);
  });

  it("returns filteredNodeIds when externalFilter is null", () => {
    const internal = new Set(["c", "d"]);
    expect(computeEffectiveFilter(null, internal)).toEqual(internal);
  });

  it("returns filteredNodeIds when externalFilter is undefined", () => {
    const internal = new Set(["c", "d"]);
    expect(computeEffectiveFilter(undefined, internal)).toEqual(internal);
  });

  it("returns intersection when both filters are provided", () => {
    const external = new Set(["a", "b", "c"]);
    const internal = new Set(["b", "c", "d"]);
    const result = computeEffectiveFilter(external, internal);
    expect(result).toEqual(new Set(["b", "c"]));
  });

  it("returns empty set when filters have no overlap", () => {
    const external = new Set(["a", "b"]);
    const internal = new Set(["c", "d"]);
    const result = computeEffectiveFilter(external, internal);
    expect(result?.size).toBe(0);
  });
});

describe("filterNodes", () => {
  const nodes = [
    { id: "kw:a", label: "a" },
    { id: "kw:b", label: "b" },
    { id: "kw:c", label: "c" },
  ];

  it("returns all nodes when filter is null", () => {
    expect(filterNodes(nodes, null)).toEqual(nodes);
  });

  it("returns only nodes in filter set", () => {
    const result = filterNodes(nodes, new Set(["kw:a", "kw:c"]));
    expect(result).toHaveLength(2);
    expect(result.map((n) => n.id)).toEqual(["kw:a", "kw:c"]);
  });

  it("returns empty array when filter is empty", () => {
    expect(filterNodes(nodes, new Set())).toEqual([]);
  });

  it("preserves node order", () => {
    const result = filterNodes(nodes, new Set(["kw:c", "kw:a"]));
    expect(result.map((n) => n.id)).toEqual(["kw:a", "kw:c"]);
  });

  it("ignores filter IDs that don't exist in nodes", () => {
    const result = filterNodes(nodes, new Set(["kw:a", "kw:nonexistent"]));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("kw:a");
  });
});

describe("filterEdges", () => {
  const edges: SimilarityEdge[] = [
    { source: "kw:a", target: "kw:b", similarity: 0.8 },
    { source: "kw:b", target: "kw:c", similarity: 0.7 },
    { source: "kw:a", target: "kw:c", similarity: 0.6 },
  ];

  it("returns all edges when filter is null", () => {
    expect(filterEdges(edges, null)).toEqual(edges);
  });

  it("returns only edges where both endpoints are in filter", () => {
    const result = filterEdges(edges, new Set(["kw:a", "kw:b"]));
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("kw:a");
    expect(result[0].target).toBe("kw:b");
  });

  it("excludes edges where only source is in filter", () => {
    const result = filterEdges(edges, new Set(["kw:a"]));
    expect(result).toHaveLength(0);
  });

  it("excludes edges where only target is in filter", () => {
    const result = filterEdges(edges, new Set(["kw:c"]));
    expect(result).toHaveLength(0);
  });

  it("returns empty array when filter is empty", () => {
    expect(filterEdges(edges, new Set())).toEqual([]);
  });

  it("returns all edges when all nodes are in filter", () => {
    const result = filterEdges(edges, new Set(["kw:a", "kw:b", "kw:c"]));
    expect(result).toEqual(edges);
  });
});
