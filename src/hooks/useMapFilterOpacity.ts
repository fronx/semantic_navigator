import { useEffect, RefObject } from "react";
import * as d3 from "d3";
import type { ArticleSimilarityMap, KeywordSimilarityMap } from "./useMapSearch";

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  type: "keyword" | "article";
  label: string;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  source: SimNode | string;
  target: SimNode | string;
}

type NodeSelection = d3.Selection<SVGGElement, SimNode, SVGGElement, unknown>;
type LinkSelection = d3.Selection<SVGLineElement, SimLink, SVGGElement, unknown>;

const MIN_OPACITY = 0.1;

export function useMapFilterOpacity(
  nodeSelectionRef: RefObject<NodeSelection | null>,
  linkSelectionRef: RefObject<LinkSelection | null>,
  articleSimilarities: ArticleSimilarityMap | null,
  keywordSimilarities: KeywordSimilarityMap | null
) {
  useEffect(() => {
    const nodeSelection = nodeSelectionRef.current;
    const linkSelection = linkSelectionRef.current;
    if (!nodeSelection || !linkSelection) return;

    if (!articleSimilarities) {
      // No search - show all at full opacity
      nodeSelection.attr("opacity", 1);
      linkSelection.attr("opacity", 1);
      return;
    }

    // Apply opacity based on similarity score
    nodeSelection.attr("opacity", (d) => {
      if (d.type === "article") {
        const similarity = articleSimilarities.get(d.label);
        if (similarity === undefined) return MIN_OPACITY;
        return similarity;
      } else {
        // Keyword node - check if it has a direct match
        const similarity = keywordSimilarities?.get(d.label);
        if (similarity !== undefined) return similarity;
        // No direct keyword match - dim it
        return MIN_OPACITY;
      }
    });

    linkSelection.attr("opacity", (d) => {
      const source = d.source as SimNode;
      const target = d.target as SimNode;

      // Get opacity for each endpoint
      const sourceOpacity = getNodeOpacity(source, articleSimilarities, keywordSimilarities);
      const targetOpacity = getNodeOpacity(target, articleSimilarities, keywordSimilarities);

      // Link opacity is the minimum of its endpoints
      return Math.min(sourceOpacity, targetOpacity);
    });
  }, [nodeSelectionRef, linkSelectionRef, articleSimilarities, keywordSimilarities]);
}

function getNodeOpacity(
  node: SimNode,
  articleSimilarities: ArticleSimilarityMap | null,
  keywordSimilarities: KeywordSimilarityMap | null
): number {
  if (node.type === "article") {
    return articleSimilarities?.get(node.label) ?? MIN_OPACITY;
  } else {
    return keywordSimilarities?.get(node.label) ?? MIN_OPACITY;
  }
}
