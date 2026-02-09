import { describe, it, expect } from "vitest";
import { createContentAwareFocusState } from "../focus-mode";
import type { ContentNode } from "../content-loader";

describe("createContentAwareFocusState", () => {
  it("should include the selected keyword in focused nodes", () => {
    const contentsByKeyword = new Map<string, ContentNode[]>();
    contentsByKeyword.set("keyword1", [
      { id: "chunk1", keywordId: "keyword1", content: "test" },
    ]);

    const state = createContentAwareFocusState(
      "keyword1",
      ["keyword1", "keyword2"],
      contentsByKeyword,
      3
    );

    expect(state.focusedKeywordId).toBe("keyword1");
    expect(state.focusedNodeIds.has("keyword1")).toBe(true);
  });

  it("should find 1-hop keywords through shared content", () => {
    // Setup: keyword1 → chunk1 ← keyword2 (they share chunk1)
    const contentsByKeyword = new Map<string, ContentNode[]>();
    contentsByKeyword.set("keyword1", [
      { id: "chunk1", keywordId: "keyword1", content: "test" },
    ]);
    contentsByKeyword.set("keyword2", [
      { id: "chunk1", keywordId: "keyword2", content: "test" },
    ]);

    const state = createContentAwareFocusState(
      "keyword1",
      ["keyword1", "keyword2"],
      contentsByKeyword,
      3
    );

    expect(state.focusedNodeIds.has("keyword1")).toBe(true);
    expect(state.focusedNodeIds.has("keyword2")).toBe(true);
    expect(state.keywordTiers.get("keyword1")).toBe("selected");
    expect(state.keywordTiers.get("keyword2")).toBe("neighbor-1");
  });

  it("should find 2-hop keywords through content chain", () => {
    // Setup: keyword1 → chunk1 ← keyword2 → chunk2 ← keyword3
    const contentsByKeyword = new Map<string, ContentNode[]>();
    contentsByKeyword.set("keyword1", [
      { id: "chunk1", keywordId: "keyword1", content: "test1" },
    ]);
    contentsByKeyword.set("keyword2", [
      { id: "chunk1", keywordId: "keyword2", content: "test1" },
      { id: "chunk2", keywordId: "keyword2", content: "test2" },
    ]);
    contentsByKeyword.set("keyword3", [
      { id: "chunk2", keywordId: "keyword3", content: "test2" },
    ]);

    const state = createContentAwareFocusState(
      "keyword1",
      ["keyword1", "keyword2", "keyword3"],
      contentsByKeyword,
      3
    );

    expect(state.focusedNodeIds.has("keyword1")).toBe(true);
    expect(state.focusedNodeIds.has("keyword2")).toBe(true);
    expect(state.focusedNodeIds.has("keyword3")).toBe(true);
    expect(state.keywordTiers.get("keyword1")).toBe("selected");
    expect(state.keywordTiers.get("keyword2")).toBe("neighbor-1");
    expect(state.keywordTiers.get("keyword3")).toBe("neighbor-2");
  });

  it("should not include isolated keywords with no shared content", () => {
    const contentsByKeyword = new Map<string, ContentNode[]>();
    contentsByKeyword.set("keyword1", [
      { id: "chunk1", keywordId: "keyword1", content: "test1" },
    ]);
    contentsByKeyword.set("keyword2", [
      { id: "chunk2", keywordId: "keyword2", content: "test2" },
    ]);

    const state = createContentAwareFocusState(
      "keyword1",
      ["keyword1", "keyword2"],
      contentsByKeyword,
      3
    );

    expect(state.focusedNodeIds.has("keyword1")).toBe(true);
    expect(state.focusedNodeIds.has("keyword2")).toBe(false);
    expect(state.marginNodeIds.has("keyword2")).toBe(true);
  });

  it("should handle keywords with no content", () => {
    const contentsByKeyword = new Map<string, ContentNode[]>();

    const state = createContentAwareFocusState(
      "keyword1",
      ["keyword1", "keyword2"],
      contentsByKeyword,
      3
    );

    // Only the selected keyword should be focused (no hops possible without content)
    expect(state.focusedNodeIds.has("keyword1")).toBe(true);
    expect(state.focusedNodeIds.has("keyword2")).toBe(false);
  });

  it("should respect maxHops parameter", () => {
    // Setup: keyword1 → chunk1 ← keyword2 → chunk2 ← keyword3 → chunk3 ← keyword4
    const contentsByKeyword = new Map<string, ContentNode[]>();
    contentsByKeyword.set("keyword1", [
      { id: "chunk1", keywordId: "keyword1", content: "test1" },
    ]);
    contentsByKeyword.set("keyword2", [
      { id: "chunk1", keywordId: "keyword2", content: "test1" },
      { id: "chunk2", keywordId: "keyword2", content: "test2" },
    ]);
    contentsByKeyword.set("keyword3", [
      { id: "chunk2", keywordId: "keyword3", content: "test2" },
      { id: "chunk3", keywordId: "keyword3", content: "test3" },
    ]);
    contentsByKeyword.set("keyword4", [
      { id: "chunk3", keywordId: "keyword4", content: "test3" },
    ]);

    // With maxHops=2, should only reach keyword3
    const state = createContentAwareFocusState(
      "keyword1",
      ["keyword1", "keyword2", "keyword3", "keyword4"],
      contentsByKeyword,
      2 // maxHops
    );

    expect(state.focusedNodeIds.has("keyword1")).toBe(true);
    expect(state.focusedNodeIds.has("keyword2")).toBe(true);
    expect(state.focusedNodeIds.has("keyword3")).toBe(true);
    expect(state.focusedNodeIds.has("keyword4")).toBe(false);
  });
});
