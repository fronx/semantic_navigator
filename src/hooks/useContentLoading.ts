import { useState, useEffect, useRef } from 'react';
import { fetchChunksForKeywords, ContentNode } from '@/lib/content-loader';

/**
 * Compare two Maps for equality (same keys and values)
 */
function mapsEqual<K, V>(map1: Map<K, V>, map2: Map<K, V>): boolean {
  if (map1.size !== map2.size) return false;
  for (const [key, value] of map1) {
    if (!map2.has(key) || map2.get(key) !== value) {
      return false;
    }
  }
  return true;
}

export interface UseContentLoadingOptions {
  visibleKeywordIds: Set<string>;
  enabled: boolean;
  nodeType: 'article' | 'chunk';
}

export interface UseContentLoadingResult {
  contentsByKeyword: Map<string, ContentNode[]>;
  isLoading: boolean;
}

/**
 * Lazily load content nodes for visible keywords with caching and batching.
 *
 * Features:
 * - Debounced fetching (200ms) to batch rapid visibility changes
 * - Persistent cache across renders to avoid refetching
 * - Single batched request for all uncached keywords
 * - Groups content nodes by keywordId for easy consumption
 */
export function useContentLoading({
  visibleKeywordIds,
  enabled,
  nodeType,
}: UseContentLoadingOptions): UseContentLoadingResult {
  const [contentsByKeyword, setContentsByKeyword] = useState(
    () => new Map<string, ContentNode[]>()
  );
  const [isLoading, setIsLoading] = useState(false);

  // Persistent cache across renders
  const contentCacheRef = useRef<Map<string, ContentNode[]>>(new Map());
  const debounceTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  // Track the previous result to avoid unnecessary updates
  const previousResultRef = useRef<Map<string, ContentNode[]>>(new Map());

  useEffect(() => {
    console.log('[Content Loading] Effect triggered. Enabled:', enabled, 'Keywords:', visibleKeywordIds.size);

    if (!enabled) {
      console.log('[Content Loading] Disabled, returning early');
      return;
    }

    // Clear existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Debounce the fetch by 200ms
    debounceTimerRef.current = setTimeout(async () => {
      console.log('[Content Loading] Checking', visibleKeywordIds.size, 'visible keywords');
      console.log('[Content Loading] Cache size:', contentCacheRef.current.size);

      // Identify uncached keywords
      const uncachedKeywordIds = Array.from(visibleKeywordIds).filter(
        (id) => !contentCacheRef.current.has(id)
      );

      console.log('[Content Loading] Uncached keywords:', uncachedKeywordIds.length);

      if (uncachedKeywordIds.length === 0) {
        console.log('[Content Loading] All keywords cached, skipping fetch');
        // All visible keywords are cached, check if result changed
        const resultMap = new Map<string, ContentNode[]>();
        visibleKeywordIds.forEach((id) => {
          const cached = contentCacheRef.current.get(id);
          if (cached) {
            resultMap.set(id, cached);
          }
        });

        // Only update if the map content actually changed
        if (!mapsEqual(resultMap, previousResultRef.current)) {
          previousResultRef.current = resultMap;
          setContentsByKeyword(resultMap);
        }
        return;
      }

      // Fetch uncached content nodes in single batched request
      setIsLoading(true);
      try {
        const contentNodes = await fetchChunksForKeywords(uncachedKeywordIds, nodeType);

        // Group content nodes by keywordId
        const contentsByKeywordId = new Map<string, ContentNode[]>();
        contentNodes.forEach((node) => {
          const existing = contentsByKeywordId.get(node.keywordId) || [];
          contentsByKeywordId.set(node.keywordId, [...existing, node]);
        });

        // Update cache for newly fetched keywords
        contentsByKeywordId.forEach((nodes, keywordId) => {
          contentCacheRef.current.set(keywordId, nodes);
        });

        // Build result map from all visible keywords (cached + newly fetched)
        const resultMap = new Map<string, ContentNode[]>();
        visibleKeywordIds.forEach((id) => {
          const cached = contentCacheRef.current.get(id);
          if (cached) {
            resultMap.set(id, cached);
          }
        });

        // Only update if the map content actually changed
        if (!mapsEqual(resultMap, previousResultRef.current)) {
          previousResultRef.current = resultMap;
          setContentsByKeyword(resultMap);
        }
      } catch (error) {
        console.error('Failed to fetch content nodes:', error);
      } finally {
        setIsLoading(false);
      }
    }, 200);

    // Cleanup debounce timer
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [visibleKeywordIds, enabled, nodeType]);

  // Clear cache when nodeType changes
  useEffect(() => {
    contentCacheRef.current.clear();
    previousResultRef.current.clear();
    setContentsByKeyword(new Map());
  }, [nodeType]);

  return {
    contentsByKeyword,
    isLoading,
  };
}
