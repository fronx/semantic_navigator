/**
 * Shared interaction handlers for keyword nodes and labels.
 * Ensures consistent behavior whether clicking/hovering dots or text.
 */

import type { SimNode } from "@/lib/map-renderer";

export interface KeywordClickContext {
  /** The clicked node */
  node: SimNode;
  /** Positions of focus-margin-pushed nodes */
  focusPositionsRef?: React.MutableRefObject<Map<string, { x: number; y: number }>>;
  /** Positions of pulled nodes (edge pulling) */
  pulledPositionsRef?: React.MutableRefObject<Map<string, { x: number; y: number; connectedPrimaryIds: string[] }>>;
  /** Camera flyTo function for animating to a position */
  flyToRef?: React.MutableRefObject<((x: number, y: number) => void) | null>;
  /** Base click handler (triggers focus mode switch) */
  onKeywordClick?: (keywordId: string) => void;
}

export interface KeywordHoverContext {
  /** The hovered node (null when hover ends) */
  node: SimNode | null;
  /** Base hover handler */
  onKeywordHover?: (keywordId: string | null) => void;
}

/**
 * Handle keyword click with consistent logic for:
 * - Pulled nodes (edge pulling): switch focus AND fly to center on keyword
 * - Focus margin nodes: switch focus AND fly to center on keyword
 * - Normal nodes: trigger focus mode
 *
 * Both pulled and margin keywords are at viewport edges, so clicking them
 * should recenter them in the safe primary zone.
 */
export function handleKeywordClick(context: KeywordClickContext): void {
  const { node, focusPositionsRef, pulledPositionsRef, flyToRef, onKeywordClick } = context;

  const isPulled = pulledPositionsRef?.current.has(node.id);
  const isFocusMargin = focusPositionsRef?.current.has(node.id);

  // Both pulled and margin nodes: switch focus AND center camera
  // This makes the clicked keyword "primary" (safely in viewport, not at edge)
  if (isPulled || isFocusMargin) {
    // First trigger focus switch (recalculates focus set with this keyword as center)
    onKeywordClick?.(node.id);

    // Then fly camera to center on this keyword's natural position
    // This ensures the keyword is in the safe primary zone (not cliff zone)
    if (flyToRef?.current) {
      const nodeX = node.x ?? 0;
      const nodeY = node.y ?? 0;
      flyToRef.current(nodeX, nodeY);
    }
    return;
  }

  // Normal node: fire click handler (triggers focus mode)
  onKeywordClick?.(node.id);
}

/**
 * Handle keyword hover with consistent logic.
 * Currently just forwards to the base handler, but extracted for consistency
 * and to allow future special handling (e.g., different hover behavior for pulled nodes).
 */
export function handleKeywordHover(context: KeywordHoverContext): void {
  const { node, onKeywordHover } = context;
  onKeywordHover?.(node?.id ?? null);
}
