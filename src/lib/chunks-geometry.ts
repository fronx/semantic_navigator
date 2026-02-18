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
