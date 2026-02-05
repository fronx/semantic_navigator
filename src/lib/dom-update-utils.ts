/**
 * Utilities for efficient DOM updates with change detection.
 * Prevents layout thrashing from unnecessary style recalculations.
 */

/**
 * Style update configuration
 */
export interface StyleUpdate {
  /** CSS property name (e.g., "left", "fontSize") */
  prop: keyof CSSStyleDeclaration;
  /** Dataset key to store last value (e.g., "lastLeft") */
  key: string;
  /** New numeric value */
  value: number;
  /** Minimum change to trigger update (only used in conditional mode) */
  threshold: number;
  /** CSS unit suffix (default "px") */
  unit?: string;
}

/**
 * Update multiple style properties with automatic change detection.
 * On first show (or after hide), sets all values unconditionally.
 * Otherwise, only updates properties that exceed their threshold.
 *
 * @param element - The DOM element to update
 * @param updates - Array of style updates to apply
 * @returns true if this was a first show (unconditional update)
 */
export function updateLabelStyles(
  element: HTMLElement,
  updates: StyleUpdate[]
): boolean {
  // Check if element was hidden or is being shown for first time
  const wasHidden = element.style.display === "none";
  const firstShow = wasHidden || !element.dataset[updates[0].key];

  if (firstShow) {
    // Set all properties unconditionally
    for (const { prop, key, value, unit = "px" } of updates) {
      (element.style as any)[prop] = `${value}${unit}`;
      element.dataset[key] = String(value);
    }
  } else {
    // Only update if change exceeds threshold
    for (const { prop, key, value, threshold, unit = "px" } of updates) {
      const lastValue = parseFloat(element.dataset[key] ?? "0");
      if (Math.abs(value - lastValue) > threshold) {
        (element.style as any)[prop] = `${value}${unit}`;
        element.dataset[key] = String(value);
      }
    }
  }

  return firstShow;
}
