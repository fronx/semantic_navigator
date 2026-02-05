import { useMemo } from "react";
import type { KeywordNode } from "@/lib/graph-queries";
import type { KeywordSimilarityMap } from "./useTopicsSearch";

const MIN_OPACITY = 0.1;

interface UseTopicsSearchOpacityParams {
  keywordNodes: KeywordNode[];
  keywordSimilarities: KeywordSimilarityMap | null;
  enabled: boolean;
}

interface UseTopicsSearchOpacityResult {
  nodeOpacities: Map<string, number>;  // node id -> opacity
}

export function useTopicsSearchOpacity({
  keywordNodes,
  keywordSimilarities,
  enabled,
}: UseTopicsSearchOpacityParams): UseTopicsSearchOpacityResult {
  const nodeOpacities = useMemo(() => {
    const opacities = new Map<string, number>();

    // If search disabled or no results, return empty map (all nodes use default opacity)
    if (!enabled || !keywordSimilarities) {
      return opacities;
    }

    // Build opacity map for each keyword node
    for (const node of keywordNodes) {
      const similarity = keywordSimilarities.get(node.label);
      if (similarity !== undefined) {
        // Matched keyword - use similarity as opacity
        opacities.set(node.id, similarity);
      } else {
        // Non-matching keyword - dim it
        opacities.set(node.id, MIN_OPACITY);
      }
    }

    return opacities;
  }, [keywordNodes, keywordSimilarities, enabled]);

  return { nodeOpacities };
}
