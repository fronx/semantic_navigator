import { describe, expect, it } from "vitest";
import { createFocusState } from "../focus-mode";
import type { SimilarityEdge } from "../graph-queries";

describe("createFocusState", () => {
  const edges: SimilarityEdge[] = [
    { source: "a", target: "b", similarity: 0.9 },
    { source: "b", target: "c", similarity: 0.8 },
    { source: "c", target: "d", similarity: 0.7 },
  ];

  it("sets the selected keyword as the focus center", () => {
    const state = createFocusState("b", ["a", "b", "c", "d"], edges);
    expect(state.focusedKeywordId).toBe("b");
  });

  it("includes the focused keyword in focusedNodeIds", () => {
    const state = createFocusState("b", ["a", "b", "c", "d"], edges);
    expect(state.focusedNodeIds.has("b")).toBe(true);
  });

  it("excludes the focused keyword from marginNodeIds", () => {
    const state = createFocusState("b", ["a", "b", "c", "d"], edges);
    expect(state.marginNodeIds.has("b")).toBe(false);
  });

  it("includes neighbors in focusedNodeIds", () => {
    const state = createFocusState("b", ["a", "b", "c", "d"], edges);
    // b's neighbors: a (1-hop), c (1-hop)
    expect(state.focusedNodeIds.has("a")).toBe(true);
    expect(state.focusedNodeIds.has("c")).toBe(true);
  });

  it("puts non-neighbors in marginNodeIds", () => {
    const state = createFocusState("a", ["a", "b", "c", "d", "e"], edges);
    // a's neighbors: b (1-hop), c (2-hop)
    // d is 3-hop, e is isolated
    expect(state.focusedNodeIds.has("a")).toBe(true);
    expect(state.focusedNodeIds.has("b")).toBe(true);
    expect(state.focusedNodeIds.has("c")).toBe(true);
    expect(state.focusedNodeIds.has("d")).toBe(true);
    expect(state.marginNodeIds.has("e")).toBe(true);
  });

  describe("invariant: focusedNodeIds and marginNodeIds are disjoint", () => {
    it("ensures no keyword is in both sets", () => {
      const allNodes = ["a", "b", "c", "d", "e"];
      const state = createFocusState("b", allNodes, edges);

      for (const nodeId of allNodes) {
        const inFocused = state.focusedNodeIds.has(nodeId);
        const inMargin = state.marginNodeIds.has(nodeId);
        // A keyword must be in exactly one set (not both, not neither)
        expect(inFocused !== inMargin).toBe(true);
      }
    });
  });

  describe("clicking a margin keyword", () => {
    it("moves the keyword from margin to focus set", () => {
      const allNodes = ["a", "b", "c", "d", "e"];

      // Initial state: "b" is focused
      const state1 = createFocusState("b", allNodes, edges);
      // "e" is isolated, so it's in margin
      expect(state1.marginNodeIds.has("e")).toBe(true);
      expect(state1.focusedNodeIds.has("e")).toBe(false);

      // User clicks "e" → new focus state with "e" as center
      const state2 = createFocusState("e", allNodes, edges);
      // "e" should now be in focused set, not margin
      expect(state2.focusedNodeIds.has("e")).toBe(true);
      expect(state2.marginNodeIds.has("e")).toBe(false);

      // IMPORTANT: When this transition happens, KeywordNodes.tsx must remove "e"
      // from focusPositionsRef to allow it to render at its natural position
      // (which the camera then pans to center).
    });
  });
});
