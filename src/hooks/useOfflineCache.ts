/**
 * Reusable hook for offline data caching with localStorage fallback.
 * Automatically stores successful fetches and falls back to cache when offline.
 */

import { useEffect, useState } from "react";

export interface OfflineCacheOptions<T> {
  /** Unique cache key for localStorage */
  cacheKey: string;
  /** Function that fetches the data (returns Promise) */
  fetcher: () => Promise<T>;
  /** Dependencies that trigger refetch (like useEffect deps) */
  deps?: unknown[];
}

export interface OfflineCacheResult<T> {
  /** The data (from network or cache) */
  data: T | null;
  /** Loading state (only true during initial fetch) */
  loading: boolean;
  /** Error message if fetch failed and no cache available */
  error: string | null;
  /** Whether data is from stale cache (offline) */
  isStale: boolean;
  /** Manually trigger a refetch */
  refetch: () => Promise<void>;
  /** Clear the cache */
  clearCache: () => void;
}

export function useOfflineCache<T>({
  cacheKey,
  fetcher,
  deps = [],
}: OfflineCacheOptions<T>): OfflineCacheResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  async function fetchData() {
    setLoading(true);
    setIsStale(false);

    try {
      const result = await fetcher();

      // Save to cache
      try {
        localStorage.setItem(cacheKey, JSON.stringify(result));
      } catch (cacheError) {
        console.warn(`Failed to cache data for ${cacheKey}:`, cacheError);
      }

      setData(result);
      setError(null);
    } catch (err) {
      // Try to load from cache on error
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          setData(JSON.parse(cached));
          setIsStale(true);
          setError(null);
          console.info(`Using cached data for ${cacheKey} (offline mode)`);
        } else {
          throw err; // No cache available, propagate error
        }
      } catch (parseError) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  }

  function clearCache() {
    localStorage.removeItem(cacheKey);
    setData(null);
    setIsStale(false);
  }

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return {
    data,
    loading,
    error,
    isStale,
    refetch: fetchData,
    clearCache,
  };
}
