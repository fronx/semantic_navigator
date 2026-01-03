/**
 * Centralized color constants with semantic names.
 * Use these throughout the app for consistent theming.
 */

export const colors = {
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
