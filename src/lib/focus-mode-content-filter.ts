import type { FocusState } from './focus-mode';
import type { KeywordNode } from './graph-queries';
import type { ContentSimNode } from './content-layout';

/**
 * Compute visible keyword IDs excluding margin keywords when focus is active
 */
export function computeVisibleKeywordIds(
  activeNodes: KeywordNode[],
  chunkKeywordIds: Set<string> | null,
  focusState: FocusState | null
): Set<string> {
  // If semantic filter active, use that
  if (chunkKeywordIds) {
    return new Set(chunkKeywordIds);
  }

  // Filter out margin keywords when focus mode is active
  if (focusState) {
    return new Set(
      activeNodes
        .filter(n => !focusState.marginNodeIds.has(n.id))
        .map(n => n.id)
    );
  }

  // Default: all active nodes
  return new Set(activeNodes.map(n => n.id));
}

/**
 * Identify content nodes whose ALL parents are focus-pushed (margin)
 */
export function identifyAllMarginParents(
  contentNodes: ContentSimNode[],
  focusPositions: Map<string, any> | null
): Set<string> {
  const result = new Set<string>();

  if (!focusPositions) {
    return result; // No focus mode, no filtering
  }

  for (const node of contentNodes) {
    const allParentsPushed = node.parentIds.every(pid => focusPositions.has(pid));
    if (allParentsPushed) {
      result.add(node.id);
    }
  }

  return result;
}
