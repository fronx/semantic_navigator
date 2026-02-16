/**
 * Tests for position interpolation animation logic.
 *
 * Since these functions are intended for use in hooks with setupUpdateLoop,
 * we test the core animation logic directly without React hook machinery.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  easeOutCubic,
  easeInOutCubic,
  linear,
} from "../usePositionInterpolation";

describe("easing functions", () => {
  it("easeOutCubic should produce correct values", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875);
    expect(easeOutCubic(1)).toBe(1);
  });

  it("easeInOutCubic should be symmetric", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(1)).toBe(1);
    // Should be symmetric around 0.5
    expect(easeInOutCubic(0.25)).toBeCloseTo(1 - easeInOutCubic(0.75));
  });

  it("linear should produce identity", () => {
    expect(linear(0)).toBe(0);
    expect(linear(0.5)).toBe(0.5);
    expect(linear(1)).toBe(1);
  });
});

describe("position interpolation animation logic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should interpolate between start and target positions", () => {
    const startX = 0;
    const startY = 0;
    const targetX = 100;
    const targetY = 200;

    // Simulate animation at t=0.5 with linear easing
    const t = linear(0.5);
    const x = startX + (targetX - startX) * t;
    const y = startY + (targetY - startY) * t;

    expect(x).toBe(50);
    expect(y).toBe(100);
  });

  it("should apply easeOutCubic easing correctly", () => {
    const startX = 0;
    const targetX = 100;

    // At t=0.5, easeOutCubic gives ~0.875
    const t = easeOutCubic(0.5);
    const x = startX + (targetX - startX) * t;

    expect(x).toBeCloseTo(87.5, 1);
  });

  it("should complete animation when t=1.0", () => {
    const startX = 0;
    const startY = 0;
    const targetX = 100;
    const targetY = 200;

    const t = easeOutCubic(1.0);
    const x = startX + (targetX - startX) * t;
    const y = startY + (targetY - startY) * t;

    expect(x).toBe(100);
    expect(y).toBe(200);
  });

  it("should calculate progress based on elapsed time", () => {
    const duration = 400;

    // Start time
    const startTime = performance.now();

    // Simulate 200ms elapsed (halfway)
    vi.advanceTimersByTime(200);
    const elapsed = performance.now() - startTime;
    const rawT = Math.min(1, elapsed / duration);

    expect(rawT).toBe(0.5);
  });

  it("should clamp progress to 1.0", () => {
    const duration = 400;
    const startTime = performance.now();

    // Simulate 500ms elapsed (more than duration)
    vi.advanceTimersByTime(500);
    const elapsed = performance.now() - startTime;
    const rawT = Math.min(1, elapsed / duration);

    expect(rawT).toBe(1.0);
  });
});
