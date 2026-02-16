/**
 * Theme utilities shared across renderers.
 * Provides consistent theme detection and color values.
 */

import { colors } from "./colors";

/**
 * Detect if dark mode is currently active.
 * Uses prefers-color-scheme media query.
 */
export function isDarkMode(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Get the current background color based on theme.
 * Returns light or dark background color from centralized color config.
 */
export function getBackgroundColor(): string {
  return isDarkMode() ? colors.background.dark : colors.background.light;
}

/**
 * Listen for theme changes and call callback when theme switches.
 * Returns cleanup function to remove listener.
 */
export function watchThemeChanges(callback: (isDark: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = (e: MediaQueryListEvent) => callback(e.matches);

  mediaQuery.addEventListener("change", handler);

  return () => mediaQuery.removeEventListener("change", handler);
}
