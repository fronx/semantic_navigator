export interface PulledNodeData {
  connectedPrimaryIds?: string[];
}

/**
 * Determines whether an edge should be hidden when both endpoints are pulled nodes.
 * Only hide the edge when neither endpoint is a primary node (no inward connections).
 */
export function shouldHideEdgeForPulledEndpoints(
  sourcePulled?: PulledNodeData | null,
  targetPulled?: PulledNodeData | null,
): boolean {
  if (!sourcePulled || !targetPulled) return false;
  const sourceHasPrimary = (sourcePulled.connectedPrimaryIds?.length ?? 0) > 0;
  const targetHasPrimary = (targetPulled.connectedPrimaryIds?.length ?? 0) > 0;
  return !sourceHasPrimary && !targetHasPrimary;
}
