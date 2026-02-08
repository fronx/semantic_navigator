/**
 * Compute node degrees (number of connections) for a graph.
 * Used for determining keyword label visibility.
 */
export function computeNodeDegrees<TLink extends { source: string | { id: string }; target: string | { id: string } }>(
  nodeIds: Iterable<string>,
  links: TLink[]
): Map<string, number> {
  const degrees = new Map<string, number>();

  // Initialize all nodes with degree 0
  for (const id of nodeIds) {
    degrees.set(id, 0);
  }

  // Count connections
  for (const link of links) {
    const sourceId = typeof link.source === "string" ? link.source : link.source.id;
    const targetId = typeof link.target === "string" ? link.target : link.target.id;
    degrees.set(sourceId, (degrees.get(sourceId) ?? 0) + 1);
    degrees.set(targetId, (degrees.get(targetId) ?? 0) + 1);
  }

  return degrees;
}
