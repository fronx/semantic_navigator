import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { applyFocusGlow, initGlowTarget, FOCUS_GLOW_FACTOR, HOVER_GLOW_FACTOR, HOVER_FOCUSED_GLOW_FACTOR, MARGIN_DIM } from "../node-color-effects";

describe("node-color-effects", () => {
  describe("initGlowTarget", () => {
    it("sets white for dark mode", () => {
      const target = new THREE.Color();
      initGlowTarget(target, true);
      expect(target.getHex()).toBe(0xffffff);
    });

    it("sets black for light mode", () => {
      const target = new THREE.Color();
      initGlowTarget(target, false);
      expect(target.getHex()).toBe(0x000000);
    });
  });

  describe("applyFocusGlow", () => {
    it("does nothing when neither focused nor hovered", () => {
      const color = new THREE.Color(0.5, 0.5, 0.5);
      const original = color.clone();
      const glowTarget = new THREE.Color(1, 1, 1);
      applyFocusGlow(color, glowTarget, false, false);
      expect(color.equals(original)).toBe(true);
    });

    it("applies focus glow when focused", () => {
      const color = new THREE.Color(0.5, 0.5, 0.5);
      const glowTarget = new THREE.Color(1, 1, 1);
      applyFocusGlow(color, glowTarget, true, false);
      const expected = new THREE.Color(0.5, 0.5, 0.5).lerp(new THREE.Color(1, 1, 1), FOCUS_GLOW_FACTOR);
      expect(color.r).toBeCloseTo(expected.r, 4);
    });

    it("applies hover glow when hovered (not focused)", () => {
      const color = new THREE.Color(0.5, 0.5, 0.5);
      const glowTarget = new THREE.Color(1, 1, 1);
      applyFocusGlow(color, glowTarget, false, true);
      const expected = new THREE.Color(0.5, 0.5, 0.5).lerp(new THREE.Color(1, 1, 1), HOVER_GLOW_FACTOR);
      expect(color.r).toBeCloseTo(expected.r, 4);
    });

    it("applies both glows when focused and hovered", () => {
      const color = new THREE.Color(0.5, 0.5, 0.5);
      const glowTarget = new THREE.Color(1, 1, 1);
      applyFocusGlow(color, glowTarget, true, true);
      const expected = new THREE.Color(0.5, 0.5, 0.5);
      expected.lerp(new THREE.Color(1, 1, 1), FOCUS_GLOW_FACTOR);
      expected.lerp(new THREE.Color(1, 1, 1), HOVER_FOCUSED_GLOW_FACTOR);
      expect(color.r).toBeCloseTo(expected.r, 4);
    });
  });

  describe("constants", () => {
    it("exports expected values", () => {
      expect(FOCUS_GLOW_FACTOR).toBe(0.245);
      expect(HOVER_GLOW_FACTOR).toBe(0.35);
      expect(HOVER_FOCUSED_GLOW_FACTOR).toBe(0.105);
      expect(MARGIN_DIM).toBe(0.4);
    });
  });
});
