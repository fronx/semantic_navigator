/**
 * Simple data fetching hook.
 * No client-side caching - relies on server-side file-based cache when offline mode is enabled.
 */

import { useEffect, useState } from "react";

export interface OfflineCacheOptions<T> {
  /** Function that fetches the data (returns Promise) */
  fetcher: () => Promise<T>;
  /** Dependencies that trigger refetch (like useEffect deps) */
  deps?: unknown[];
}

export interface OfflineCacheResult<T> {
  /** The data (from API) */
  data: T | null;
  /** Loading state */
  loading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Whether server is using offline file cache (from header) */
  isStale: boolean;
  /** Manually trigger a refetch */
  refetch: () => Promise<void>;
}

export function useOfflineCache<T>({
  fetcher,
  deps = [],
}: OfflineCacheOptions<T>): OfflineCacheResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  async function fetchData() {
    setLoading(true);
    setError(null);

    try {
      const result = await fetcher();
      setData(result);
      setError(null);
      // Server can set X-Offline-Cache header to indicate it's serving from files
      setIsStale(false); // Will be updated by response inspection if needed
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setData(null);
      setIsStale(false);
    } finally {
      setLoading(false);
    }
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
  };
}
