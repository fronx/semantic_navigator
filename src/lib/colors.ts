import chroma from "chroma-js";

/**
 * Centralized color constants with semantic names.
 * Use these throughout the app for consistent theming.
 */

/**
 * Blend two hex colors (50-50 mix) with optional desaturation.
 * @param color1 First hex color (e.g., "#ff0000")
 * @param color2 Second hex color (e.g., "#00ff00")
 * @param desaturation Amount to reduce saturation (0-1, default 0.2)
 * @returns Blended hex color string
 */
export function blendColors(color1: string, color2: string, desaturation = 0.2): string {
  return chroma.mix(color1, color2, 0.5, "lab").desaturate(desaturation).hex();
}

/**
 * Dim a color by mixing it with a background color.
 * @param color Hex color to dim
 * @param amount 0 = original color, 1 = pure background
 * @param background Background color to mix toward (default white)
 * @returns Dimmed hex color string
 */
export function dimColor(color: string, amount: number, background = "#ffffff"): string {
  return chroma.mix(color, background, amount, "lab").hex();
}

/**
 * Adjust a color's lightness toward a target for text readability.
 * Dark theme: pushes toward brighter (for black text on colored background).
 * Light theme: pushes toward darker (for white text on colored background).
 * @param hex Source hex color
 * @param amount 0 = no change, 1 = full shift to target lightness
 * @param isDark Whether dark theme is active
 */
export function adjustContrast(hex: string, amount: number, isDark: boolean): string {
  const [h, s, l] = chroma(hex).hsl();
  const target = isDark ? 0.7 : 0.3;
  return chroma.hsl(h, s, l + (target - l) * amount).hex();
}

export const colors = {
  // Page backgrounds (for theme-aware dimming)
  background: {
    light: "#ffffff",
    dark: "#18181b", // zinc-900
  },

  // Node types in visualizations
  node: {
    article: "#3b82f6", // blue-500
    chunk: "#8b5cf6", // violet-500
    keyword: "#10b981", // emerald-500
  },

  // Overlay/tooltip styling - works on both light and dark backgrounds
  overlay: {
    background: "rgba(39, 39, 42, 0.92)", // zinc-800 with transparency
    text: "#ffffff",
    border: "rgba(255, 255, 255, 0.1)",
  },

  // Graph edges
  edge: {
    default: "#999999",
  },
};
