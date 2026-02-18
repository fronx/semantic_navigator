/**
 * Geometry-related utilities for chunks visualization.
 */

import * as THREE from "three";

export const CARD_WIDTH = 30;
export const CARD_HEIGHT = 20;
export const CORNER_RATIO = 0.08;

/** Constant world-space scale applied to all chunk cards. */
export const CARD_SCALE = 0.3;

/** Half-diagonal of a card in world units — used as collision radius in d3 force. */
export const CARD_COLLISION_RADIUS = Math.max(CARD_WIDTH, CARD_HEIGHT) / 2 * CARD_SCALE;

// --- Height ratio computation ---

/**
 * Vertical margin ratio used by CardTextLabels for top+bottom padding.
 * Single source of truth shared with CardTextLabels.tsx and ChunksScene.tsx.
 */
export const CARD_V_MARGIN_RATIO = 0.08;

/** Source Code Pro (monospace) at textMaxWidth = CARD_WIDTH * 0.76 = 22.8 units.
 *  Char width ≈ fontSize * 0.6 = 1.2 * 0.6 = 0.72 → chars/line ≈ 22.8 / 0.72 ≈ 31 */
const CHARS_PER_LINE = 31;
/** baseFontSize (1.2) × lineHeight (1.3) in geometry units */
const LINE_HEIGHT_GEOM = 1.56;
/**
 * Fraction of card height available for text after top+bottom margins.
 * Derived from CARD_V_MARGIN_RATIO: 1 - 2 * CARD_V_MARGIN_RATIO.
 */
const USABLE_HEIGHT_FRACTION = 1 - 2 * CARD_V_MARGIN_RATIO;
export const MIN_HEIGHT_RATIO = 0.5;
export const MAX_HEIGHT_RATIO = 10;

/**
 * Estimate the card height ratio needed to display `content` without clipping.
 * Used as an initial prediction before actual text geometry is measured.
 */
export function computeHeightRatio(content: string): number {
  const textHeight = (content.length / CHARS_PER_LINE) * LINE_HEIGHT_GEOM;
  return Math.max(MIN_HEIGHT_RATIO, Math.min(MAX_HEIGHT_RATIO, textHeight / (CARD_HEIGHT * USABLE_HEIGHT_FRACTION)));
}

/**
 * Compute the exact height ratio from the measured text geometry height (planeBounds.max.y - min.y).
 * Pass `vMarginRatio` matching the value used in CardTextLabels (DEFAULT_V_MARGIN_RATIO).
 */
export function heightRatioFromGeomHeight(textGeomHeight: number, vMarginRatio: number): number {
  return Math.max(MIN_HEIGHT_RATIO, Math.min(MAX_HEIGHT_RATIO, textGeomHeight / (CARD_HEIGHT * (1 - 2 * vMarginRatio))));
}

/**
 * Create a rounded rectangle ShapeGeometry for chunk cards.
 */
export function createCardGeometry(): THREE.ShapeGeometry {
  const radius = Math.min(CARD_WIDTH, CARD_HEIGHT) * CORNER_RATIO;
  const hw = CARD_WIDTH / 2;
  const hh = CARD_HEIGHT / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-hw + radius, -hh);
  shape.lineTo(hw - radius, -hh);
  shape.quadraticCurveTo(hw, -hh, hw, -hh + radius);
  shape.lineTo(hw, hh - radius);
  shape.quadraticCurveTo(hw, hh, hw - radius, hh);
  shape.lineTo(-hw + radius, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, hh - radius);
  shape.lineTo(-hw, -hh + radius);
  shape.quadraticCurveTo(-hw, -hh, -hw + radius, -hh);
  return new THREE.ShapeGeometry(shape);
}

/**
 * Create a plain rectangle PlaneGeometry for chunk cards.
 * Used with a ShaderMaterial that defines the visible shape via SDF.
 */
export function createCardPlaneGeometry(): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(CARD_WIDTH, CARD_HEIGHT);
}
