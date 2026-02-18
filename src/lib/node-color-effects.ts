/**
 * Shared per-node color effects for useFrame render loops.
 * Pure functions that mutate THREE.Color in place (zero allocation).
 * Used by KeywordNodes, KeywordLabels3D, ContentNodes (TopicsView) and ChunksScene (ChunksView).
 */
import * as THREE from "three";

// --- Glow blend factors ---
/** Focused node glow: lerp toward theme highlight */
export const FOCUS_GLOW_FACTOR = 0.5;
/** Hovered (not focused) node glow */
export const HOVER_GLOW_FACTOR = 0.35;
/** Hovered + focused node: additional hover lerp (stacks with focus) */
export const HOVER_FOCUSED_GLOW_FACTOR = 0.105;

// --- Dim factors ---
/** Multiplier for margin / pulled nodes (reduces brightness) */
export const MARGIN_DIM = 0.4;

/**
 * Set glow target color based on dark/light mode.
 * Call once per frame before the per-node loop.
 * @param isDark - pass isDarkMode() result (avoids repeated media queries)
 */
export function initGlowTarget(glowTarget: THREE.Color, isDark: boolean): void {
  glowTarget.set(isDark ? 0xffffff : 0x000000);
}

/**
 * Apply focus and/or hover glow to a color via lerp toward glowTarget.
 * Mutates `color` in place. No-op if neither focused nor hovered.
 */
export function applyFocusGlow(
  color: THREE.Color,
  glowTarget: THREE.Color,
  focused: boolean,
  hovered: boolean,
): void {
  if (!focused && !hovered) return;
  if (focused) color.lerp(glowTarget, FOCUS_GLOW_FACTOR);
  if (hovered) color.lerp(glowTarget, focused ? HOVER_FOCUSED_GLOW_FACTOR : HOVER_GLOW_FACTOR);
}
