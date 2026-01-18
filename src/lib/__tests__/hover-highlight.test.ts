import { describe, it, expect } from "vitest";
import { computeHoverHighlight } from "../hover-highlight";

function createTestInput(overrides: Partial<Parameters<typeof computeHoverHighlight>[0]> = {}) {
  return {
    nodes: [
      { id: "kw:a", x: 100, y: 100 },
      { id: "kw:b", x: 150, y: 100 },
      { id: "proj:1", x: 120, y: 100 },
    ],
    screenCenter: { x: 100, y: 100 },
    screenRadius: 100,
    transform: { k: 1, x: 0, y: 0 },
    similarityThreshold: 0.7,
    embeddings: new Map([
      ["kw:a", [1, 0, 0]],
      ["kw:b", [0.9, 0.1, 0]],
    ]),
    adjacency: new Map([
      ["kw:a", new Set(["kw:b"])],
      ["kw:b", new Set(["kw:a"])],
    ]),
    ...overrides,
  };
}

describe("computeHoverHighlight", () => {
  it("returns isEmptySpace true when no spatial nodes found", () => {
    const input = createTestInput({
      nodes: [{ id: "kw:a", x: 1000, y: 1000 }],
    });
    const result = computeHoverHighlight(input);
    expect(result.isEmptySpace).toBe(true);
    expect(result.keywordHighlightedIds.size).toBe(0);
  });

  it("excludes project nodes from highlighted IDs", () => {
    const input = createTestInput();
    const result = computeHoverHighlight(input);
    expect(result.keywordHighlightedIds.has("proj:1")).toBe(false);
  });

  it("includes keyword nodes in spatial radius", () => {
    const input = createTestInput();
    const result = computeHoverHighlight(input);
    // kw:a is directly at center, kw:b is within radius
    expect(result.keywordHighlightedIds.has("kw:a")).toBe(true);
  });

  it("returns isEmptySpace false when spatial nodes exist", () => {
    const input = createTestInput();
    const result = computeHoverHighlight(input);
    expect(result.isEmptySpace).toBe(false);
  });

  it("respects transform scale when computing radius", () => {
    // With k=2, screen coords (200,200) map to world (100,100)
    // World radius = screenRadius / k = 100 / 2 = 50
    // kw:a at (100,100) is at center, kw:b at (150,100) is 50 units away
    const input = createTestInput({
      screenCenter: { x: 200, y: 200 }, // Maps to world (100, 100)
      transform: { k: 2, x: 0, y: 0 },
    });
    const result = computeHoverHighlight(input);
    expect(result.keywordHighlightedIds.has("kw:a")).toBe(true);
    expect(result.keywordHighlightedIds.has("kw:b")).toBe(true);
  });

  it("uses custom screenToWorld if provided", () => {
    const input = createTestInput({
      screenToWorld: () => ({ x: 1000, y: 1000 }), // Far from any nodes
    });
    const result = computeHoverHighlight(input);
    expect(result.isEmptySpace).toBe(true);
  });

  it("includes debug info when available", () => {
    const input = createTestInput();
    const result = computeHoverHighlight(input);
    expect(result.debug).toBeDefined();
    expect(result.debug?.spatialCount).toBeGreaterThan(0);
  });
});
