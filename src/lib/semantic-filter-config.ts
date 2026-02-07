/**
 * Visual configuration for semantic filtering.
 */

import type { KeywordTier } from "./topics-filter";

/** Scale multipliers for each keyword tier */
export const KEYWORD_TIER_SCALES: Record<KeywordTier, number> = {
  selected: 1.5,
  "neighbor-1": 1.0,
  "neighbor-2": 0.7,
  "neighbor-3": 0.5,
};

/** Opacity multipliers for dimming distant keywords */
export const KEYWORD_TIER_OPACITY: Record<KeywordTier, number> = {
  selected: 1.0,
  "neighbor-1": 1.0,
  "neighbor-2": 0.6,
  "neighbor-3": 0.45,
};
