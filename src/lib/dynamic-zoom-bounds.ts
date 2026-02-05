/**
 * Dynamic zoom bounds calculation for adaptive camera limits.
 * Calculates bounding box from positioned nodes and determines required camera Z to fit bounds.
 */

export interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const FOV_DEGREES = 10;
const FOV_RADIANS = FOV_DEGREES * (Math.PI / 180);
const MIN_CAMERA_Z = 500; // Minimum to prevent excessive zoom-in

/**
 * Calculate bounding box from nodes with positions.
 * Skips nodes at origin (0,0) or with undefined positions.
 */
export function calculateBoundingBox(
  nodes: Array<{ x?: number; y?: number }>
): BoundingBox | null {
  const validNodes = nodes.filter(
    (n) =>
      n.x !== undefined &&
      n.y !== undefined &&
      !(n.x === 0 && n.y === 0)
  );

  if (validNodes.length === 0) {
    return null;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const node of validNodes) {
    if (node.x !== undefined && node.y !== undefined) {
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      minY = Math.min(minY, node.y);
      maxY = Math.max(maxY, node.y);
    }
  }

  return { minX, maxX, minY, maxY };
}

/**
 * Calculate camera Z distance needed to fit bounding box in viewport.
 * Uses narrow FOV (10°) for orthogonal-like projection.
 *
 * @param bounds - Bounding box of nodes
 * @param viewport - Viewport dimensions { width, height }
 * @param margin - Multiplier for margin (e.g., 1.5 = 50% margin)
 * @returns Required camera Z distance
 */
export function calculateCameraZForBounds(
  bounds: BoundingBox,
  viewport: { width: number; height: number },
  margin: number
): number {
  const width = (bounds.maxX - bounds.minX) * margin;
  const height = (bounds.maxY - bounds.minY) * margin;

  // Handle single-point or tiny bounds
  if (width < 1 && height < 1) {
    return MIN_CAMERA_Z;
  }

  const aspect = viewport.width / viewport.height;

  // Calculate Z needed to fit width and height
  const zForWidth = width / (2 * Math.tan(FOV_RADIANS / 2) * aspect);
  const zForHeight = height / (2 * Math.tan(FOV_RADIANS / 2));

  // Use the larger Z (more zoomed out) to ensure both dimensions fit
  const requiredZ = Math.max(zForWidth, zForHeight);

  // Enforce minimum to prevent excessive zoom-in on tiny graphs
  return Math.max(requiredZ, MIN_CAMERA_Z);
}
