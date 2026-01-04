/**
 * Edge curve direction computation for Lombardi-style curved edges.
 *
 * Extracted for testability - used by map-renderer.ts and tests.
 */

export interface NodePosition {
  id: string;
  x: number;
  y: number;
}

export interface EdgeRef {
  source: string;
  target: string;
}

/**
 * Compute the direction a curved edge should bow.
 *
 * Given a global centroid (center of mass of all nodes), curves away from it
 * so edges on the periphery bow outward (convex appearance).
 *
 * @param source - Source node position
 * @param target - Target node position
 * @param centroid - Global centroid of all nodes
 * @returns 1 or -1, indicating which side the arc should bow toward
 */
export function computeOutwardDirection(
  source: NodePosition,
  target: NodePosition,
  centroid: { x: number; y: number }
): number {
  // Edge midpoint
  const mx = (source.x + target.x) / 2;
  const my = (source.y + target.y) / 2;

  // Direction from global centroid to edge midpoint (outward)
  const outwardX = mx - centroid.x;
  const outwardY = my - centroid.y;

  // Edge perpendicular (90 degrees rotated from edge direction)
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  // Perpendicular: (-dy, dx) points "left" of edge direction (source -> target)
  const perpX = -dy;
  const perpY = dx;

  // Dot product: positive means outward is on the "left" side (direction = 1)
  const dot = outwardX * perpX + outwardY * perpY;
  return dot >= 0 ? 1 : -1;
}

/**
 * Compute global centroid of node positions.
 */
export function computeCentroid(nodes: NodePosition[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 0, y: 0 };

  let cx = 0, cy = 0;
  for (const node of nodes) {
    cx += node.x;
    cy += node.y;
  }
  return { x: cx / nodes.length, y: cy / nodes.length };
}

export interface CurveDirectionOptions {
  /** Degree ratio threshold for "clear hub" detection (default: 2) */
  hubThreshold?: number;
}

export interface CurveDirectionStats {
  noVotes: number;
  singleVote: number;
  agree: number;
  hubWins: number;
  outward: number;
}

export interface CurveDirectionResult {
  directions: Map<number, number>;
  stats: CurveDirectionStats;
}

/**
 * @returns Object with directions map and stats about decision paths
 */
export function computeEdgeCurveDirections(
  nodes: NodePosition[],
  edges: EdgeRef[],
  options: CurveDirectionOptions = {}
): CurveDirectionResult {
  const { hubThreshold = 2 } = options;

  // Build node lookup
  const nodeById = new Map<string, NodePosition>();
  for (const node of nodes) {
    nodeById.set(node.id, node);
  }

  // Build adjacency for degree calculation
  const degree = new Map<string, number>();
  for (const node of nodes) {
    degree.set(node.id, 0);
  }
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  // For angular resolution: sort edges by angle around each node
  const adjacency = new Map<string, Array<{ edgeIndex: number; other: string; angle: number }>>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }

  edges.forEach((edge, i) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) return;

    const angleFromSource = Math.atan2(target.y - source.y, target.x - source.x);
    const angleFromTarget = Math.atan2(source.y - target.y, source.x - target.x);

    adjacency.get(edge.source)?.push({ edgeIndex: i, other: edge.target, angle: angleFromSource });
    adjacency.get(edge.target)?.push({ edgeIndex: i, other: edge.source, angle: angleFromTarget });
  });

  // Sort each node's edges by angle and assign alternating votes
  const edgeVotes = new Map<number, { votes: number[]; degrees: number[] }>();
  for (let i = 0; i < edges.length; i++) {
    edgeVotes.set(i, { votes: [], degrees: [] });
  }

  for (const [nodeId, nodeEdges] of adjacency) {
    if (nodeEdges.length === 0) continue;

    // Sort by angle
    nodeEdges.sort((a, b) => a.angle - b.angle);

    // Alternate directions
    nodeEdges.forEach(({ edgeIndex }, i) => {
      const vote = edgeVotes.get(edgeIndex)!;
      vote.votes.push((i % 2 === 0) ? 1 : -1);
      vote.degrees.push(nodeEdges.length);
    });
  }

  // Compute global centroid for outward direction
  const centroid = computeCentroid(nodes);

  // Resolve votes
  const directions = new Map<number, number>();
  const stats = { noVotes: 0, singleVote: 0, agree: 0, hubWins: 0, outward: 0 };

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);

    if (!source || !target) {
      directions.set(i, 1);
      continue;
    }

    const { votes, degrees } = edgeVotes.get(i)!;

    // Always use outward direction for convex appearance
    stats.outward++;
    directions.set(i, computeOutwardDirection(source, target, centroid));
  }

  return { directions, stats };
}
