import { describe, it, expect } from "vitest";
import { computeNodeDegrees } from "../three/label-overlays";

describe("computeNodeDegrees", () => {
  it("returns zero for all nodes when there are no links", () => {
    const degrees = computeNodeDegrees(["a", "b", "c"], []);
    expect(degrees.get("a")).toBe(0);
    expect(degrees.get("b")).toBe(0);
    expect(degrees.get("c")).toBe(0);
  });

  it("counts connections from string-based links", () => {
    const links = [
      { source: "a", target: "b" },
      { source: "a", target: "c" },
    ];
    const degrees = computeNodeDegrees(["a", "b", "c"], links);
    expect(degrees.get("a")).toBe(2);
    expect(degrees.get("b")).toBe(1);
    expect(degrees.get("c")).toBe(1);
  });

  it("counts connections from object-based links", () => {
    const links = [
      { source: { id: "a" }, target: { id: "b" } },
      { source: { id: "b" }, target: { id: "c" } },
    ];
    const degrees = computeNodeDegrees(["a", "b", "c"], links);
    expect(degrees.get("a")).toBe(1);
    expect(degrees.get("b")).toBe(2);
    expect(degrees.get("c")).toBe(1);
  });

  it("handles mixed string and object links", () => {
    const links = [
      { source: "a", target: { id: "b" } },
      { source: { id: "b" }, target: "c" },
    ];
    const degrees = computeNodeDegrees(["a", "b", "c"], links);
    expect(degrees.get("a")).toBe(1);
    expect(degrees.get("b")).toBe(2);
    expect(degrees.get("c")).toBe(1);
  });

  it("handles nodes not in the initial set (adds them with correct count)", () => {
    // Links reference "d" which is not in initial nodeIds
    const links = [{ source: "a", target: "d" }];
    const degrees = computeNodeDegrees(["a", "b"], links);
    expect(degrees.get("a")).toBe(1);
    expect(degrees.get("b")).toBe(0);
    expect(degrees.get("d")).toBe(1); // Added by link processing
  });

  it("handles self-loops (counts both source and target)", () => {
    const links = [{ source: "a", target: "a" }];
    const degrees = computeNodeDegrees(["a"], links);
    expect(degrees.get("a")).toBe(2); // Counted twice for self-loop
  });

  it("accepts Set as nodeIds input", () => {
    const nodeSet = new Set(["x", "y"]);
    const links = [{ source: "x", target: "y" }];
    const degrees = computeNodeDegrees(nodeSet, links);
    expect(degrees.get("x")).toBe(1);
    expect(degrees.get("y")).toBe(1);
  });

  it("accepts generator as nodeIds input", () => {
    function* nodeGenerator() {
      yield "p";
      yield "q";
    }
    const links = [{ source: "p", target: "q" }];
    const degrees = computeNodeDegrees(nodeGenerator(), links);
    expect(degrees.get("p")).toBe(1);
    expect(degrees.get("q")).toBe(1);
  });

  it("returns correct degree for hub node with many connections", () => {
    // Hub "center" connected to many spokes
    const links = [
      { source: "center", target: "spoke1" },
      { source: "center", target: "spoke2" },
      { source: "center", target: "spoke3" },
      { source: "center", target: "spoke4" },
    ];
    const degrees = computeNodeDegrees(
      ["center", "spoke1", "spoke2", "spoke3", "spoke4"],
      links
    );
    expect(degrees.get("center")).toBe(4);
    expect(degrees.get("spoke1")).toBe(1);
  });

  it("returns empty map when given empty nodeIds and links", () => {
    const degrees = computeNodeDegrees([], []);
    expect(degrees.size).toBe(0);
  });
});
