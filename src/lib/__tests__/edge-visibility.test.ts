import { describe, expect, it } from "vitest";
import { shouldHideEdgeForPulledEndpoints } from "@/lib/edge-visibility";

const pulled = (connectedPrimaryIds: string[] = []) => ({ connectedPrimaryIds });

describe("shouldHideEdgeForPulledEndpoints", () => {
  it("hides edge when both endpoints are non-primary pulled nodes", () => {
    expect(shouldHideEdgeForPulledEndpoints(pulled(), pulled())).toBe(true);
  });

  it("keeps edge when at least one endpoint is primary", () => {
    expect(shouldHideEdgeForPulledEndpoints(pulled(["a"]), pulled())).toBe(false);
    expect(shouldHideEdgeForPulledEndpoints(pulled(), pulled(["b"]))).toBe(false);
  });

  it("keeps edge when either endpoint is not pulled", () => {
    expect(shouldHideEdgeForPulledEndpoints(undefined, pulled(["a"]))).toBe(false);
    expect(shouldHideEdgeForPulledEndpoints(null, null)).toBe(false);
  });
});
