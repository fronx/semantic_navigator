import { useState, useEffect, useRef } from 'react';
import { fetchChunksForKeywords, ChunkNode } from '@/lib/chunk-loader';

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

export interface UseChunkLoadingOptions {
  visibleKeywordIds: Set<string>;
  enabled: boolean;
}

export interface UseChunkLoadingResult {
  chunksByKeyword: Map<string, ChunkNode[]>;
  isLoading: boolean;
}

/**
 * Lazily load chunks for visible keywords with caching and batching.
 *
 * Features:
 * - Debounced fetching (200ms) to batch rapid visibility changes
 * - Persistent cache across renders to avoid refetching
 * - Single batched request for all uncached keywords
 * - Groups chunks by keywordId for easy consumption
 */
export function useChunkLoading({
  visibleKeywordIds,
  enabled,
}: UseChunkLoadingOptions): UseChunkLoadingResult {
  const [chunksByKeyword, setChunksByKeyword] = useState(
    () => new Map<string, ChunkNode[]>()
  );
  const [isLoading, setIsLoading] = useState(false);

  // Persistent cache across renders
  const chunkCacheRef = useRef<Map<string, ChunkNode[]>>(new Map());
  const debounceTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  // Track the previous result to avoid unnecessary updates
  const previousResultRef = useRef<Map<string, ChunkNode[]>>(new Map());

  useEffect(() => {
    console.log('[Chunk Loading] Effect triggered. Enabled:', enabled, 'Keywords:', visibleKeywordIds.size);

    if (!enabled) {
      console.log('[Chunk Loading] Disabled, returning early');
      return;
    }

    // Clear existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Debounce the fetch by 200ms
    debounceTimerRef.current = setTimeout(async () => {
      console.log('[Chunk Loading] Checking', visibleKeywordIds.size, 'visible keywords');
      console.log('[Chunk Loading] Cache size:', chunkCacheRef.current.size);

      // Identify uncached keywords
      const uncachedKeywordIds = Array.from(visibleKeywordIds).filter(
        (id) => !chunkCacheRef.current.has(id)
      );

      console.log('[Chunk Loading] Uncached keywords:', uncachedKeywordIds.length);

      if (uncachedKeywordIds.length === 0) {
        console.log('[Chunk Loading] All keywords cached, skipping fetch');
        // All visible keywords are cached, check if result changed
        const resultMap = new Map<string, ChunkNode[]>();
        visibleKeywordIds.forEach((id) => {
          const cached = chunkCacheRef.current.get(id);
          if (cached) {
            resultMap.set(id, cached);
          }
        });

        // Only update if the map content actually changed
        if (!mapsEqual(resultMap, previousResultRef.current)) {
          previousResultRef.current = resultMap;
          setChunksByKeyword(resultMap);
        }
        return;
      }

      // Fetch uncached chunks in single batched request
      setIsLoading(true);
      try {
        const chunks = await fetchChunksForKeywords(uncachedKeywordIds);

        // Group chunks by keywordId
        const chunksByKeywordId = new Map<string, ChunkNode[]>();
        chunks.forEach((chunk) => {
          const existing = chunksByKeywordId.get(chunk.keywordId) || [];
          chunksByKeywordId.set(chunk.keywordId, [...existing, chunk]);
        });

        // Update cache for newly fetched keywords
        chunksByKeywordId.forEach((chunks, keywordId) => {
          chunkCacheRef.current.set(keywordId, chunks);
        });

        // Build result map from all visible keywords (cached + newly fetched)
        const resultMap = new Map<string, ChunkNode[]>();
        visibleKeywordIds.forEach((id) => {
          const cached = chunkCacheRef.current.get(id);
          if (cached) {
            resultMap.set(id, cached);
          }
        });

        // Only update if the map content actually changed
        if (!mapsEqual(resultMap, previousResultRef.current)) {
          previousResultRef.current = resultMap;
          setChunksByKeyword(resultMap);
        }
      } catch (error) {
        console.error('Failed to fetch chunks:', error);
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
  }, [visibleKeywordIds, enabled]);

  return {
    chunksByKeyword,
    isLoading,
  };
}
