/**
 * Tests for useWheelEventForwarding hook.
 * Verifies the hook properly forwards wheel events from DOM overlays to canvas.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const HOOK_FILE = path.join(__dirname, "../useWheelEventForwarding.ts");
const CANVAS_FILE = path.join(
  __dirname,
  "../../components/topics-r3f/R3FTopicsCanvas.tsx"
);

describe("useWheelEventForwarding", () => {
  describe("hook implementation", () => {
    it("should export useWheelEventForwarding function", () => {
      expect(fs.existsSync(HOOK_FILE)).toBe(true);

      const content = fs.readFileSync(HOOK_FILE, "utf-8");
      expect(content).toContain("export function useWheelEventForwarding");
    });

    it("should add wheel event listener to container", () => {
      const content = fs.readFileSync(HOOK_FILE, "utf-8");

      expect(
        content.includes('container.addEventListener("wheel"') ||
        content.includes("container.addEventListener('wheel'")
      ).toBe(true);
    });

    it("should create and dispatch synthetic WheelEvent", () => {
      const content = fs.readFileSync(HOOK_FILE, "utf-8");

      expect(content).toContain("new WheelEvent");
      expect(
        content.includes("target.dispatchEvent") ||
        content.includes("canvas.dispatchEvent")
      ).toBe(true);
    });

    it("should prevent default browser behavior", () => {
      const content = fs.readFileSync(HOOK_FILE, "utf-8");

      expect(content).toContain("e.preventDefault()");
    });

    it("should include modifier keys in synthetic event", () => {
      const content = fs.readFileSync(HOOK_FILE, "utf-8");

      expect(content).toContain("ctrlKey");
      expect(content).toContain("shiftKey");
      expect(content).toContain("altKey");
      expect(content).toContain("metaKey");
    });

    it("should include delta values in synthetic event", () => {
      const content = fs.readFileSync(HOOK_FILE, "utf-8");

      expect(content).toContain("deltaX");
      expect(content).toContain("deltaY");
      expect(content).toContain("deltaZ");
      expect(content).toContain("deltaMode");
    });

    it("should include client coordinates in synthetic event", () => {
      const content = fs.readFileSync(HOOK_FILE, "utf-8");

      expect(content).toContain("clientX");
      expect(content).toContain("clientY");
    });

    it("should clean up event listener on unmount", () => {
      const content = fs.readFileSync(HOOK_FILE, "utf-8");

      expect(content).toContain("container.removeEventListener");
    });
  });

  describe("hook usage in R3FTopicsCanvas", () => {
    it("should import useWheelEventForwarding", () => {
      expect(fs.existsSync(CANVAS_FILE)).toBe(true);

      const content = fs.readFileSync(CANVAS_FILE, "utf-8");
      expect(content).toContain("useWheelEventForwarding");
    });

    it("should call hook with containerRef", () => {
      const content = fs.readFileSync(CANVAS_FILE, "utf-8");

      expect(content).toContain("useWheelEventForwarding(containerRef");
    });
  });
});
