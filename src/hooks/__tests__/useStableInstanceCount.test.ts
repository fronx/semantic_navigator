import { describe, it, expect } from "vitest";
import { computeStableCount } from "../useStableInstanceCount";

describe("computeStableCount", () => {
  const DEFAULT_BUFFER = 1.5;

  describe("initial allocation", () => {
    it("applies buffer ratio to first count", () => {
      const result = computeStableCount(100, 0, DEFAULT_BUFFER);
      expect(result.stableCount).toBe(150); // ceil(100 * 1.5)
      expect(result.reallocated).toBe(true);
    });

    it("applies custom buffer ratio", () => {
      const result = computeStableCount(100, 0, 2.0);
      expect(result.stableCount).toBe(200);
      expect(result.reallocated).toBe(true);
    });
  });

  describe("growth within buffer", () => {
    it("keeps stableCount when count stays within buffer", () => {
      // Previous allocation: 150 (from count=100, buffer=1.5)
      const r1 = computeStableCount(120, 150, DEFAULT_BUFFER);
      expect(r1.stableCount).toBe(150);
      expect(r1.reallocated).toBe(false);

      const r2 = computeStableCount(140, 150, DEFAULT_BUFFER);
      expect(r2.stableCount).toBe(150);
      expect(r2.reallocated).toBe(false);
    });

    it("keeps stableCount at exact boundary", () => {
      const result = computeStableCount(150, 150, DEFAULT_BUFFER);
      expect(result.stableCount).toBe(150);
      expect(result.reallocated).toBe(false);
    });
  });

  describe("reallocation on overflow", () => {
    it("reallocates when count exceeds stableCount", () => {
      const result = computeStableCount(200, 150, DEFAULT_BUFFER);
      expect(result.stableCount).toBe(300); // ceil(200 * 1.5)
      expect(result.reallocated).toBe(true);
    });

    it("reallocates when count exceeds by 1", () => {
      const result = computeStableCount(151, 150, DEFAULT_BUFFER);
      expect(result.stableCount).toBe(227); // ceil(151 * 1.5)
      expect(result.reallocated).toBe(true);
    });
  });

  describe("shrinking count", () => {
    it("never shrinks stableCount", () => {
      const result = computeStableCount(50, 150, DEFAULT_BUFFER);
      expect(result.stableCount).toBe(150);
      expect(result.reallocated).toBe(false);
    });

    it("never shrinks even to zero", () => {
      const result = computeStableCount(0, 150, DEFAULT_BUFFER);
      expect(result.stableCount).toBe(150);
      expect(result.reallocated).toBe(false);
    });
  });

  describe("zero count", () => {
    it("handles initial zero count", () => {
      const result = computeStableCount(0, 0, DEFAULT_BUFFER);
      expect(result.stableCount).toBe(0);
      expect(result.reallocated).toBe(false);
    });
  });

  describe("ceil behavior", () => {
    it("ceils fractional buffer results", () => {
      // 7 * 1.5 = 10.5 -> ceil = 11
      const result = computeStableCount(7, 0, DEFAULT_BUFFER);
      expect(result.stableCount).toBe(11);
      expect(result.reallocated).toBe(true);
    });
  });
});
