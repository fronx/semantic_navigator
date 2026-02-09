/**
 * Generic file-based caching utilities for REPL-driven development.
 * Enables progressive development with cache layers.
 */

import fs from "fs/promises";
import { createHash } from "crypto";

/**
 * Load JSON cache from file, returning empty object if file doesn't exist.
 */
export async function loadCache<T = Record<string, unknown>>(
  cachePath: string
): Promise<T> {
  try {
    const data = await fs.readFile(cachePath, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return {} as T;
  }
}

/**
 * Save data to JSON cache file with pretty formatting.
 */
export async function saveCache<T>(cachePath: string, data: T): Promise<void> {
  await fs.writeFile(cachePath, JSON.stringify(data, null, 2));
}

/**
 * Generic get-or-compute pattern with file-based caching.
 *
 * For each item, checks cache by key. If cached, uses cached value.
 * If not cached, computes new value, saves to cache, and returns it.
 *
 * @param items - Array of items to process
 * @param cachePath - Path to cache file
 * @param keyFn - Function to extract cache key from item
 * @param computeFn - Async function to compute value for item
 * @param options - Optional configuration
 * @returns Map of keys to computed/cached values
 */
export async function getOrCompute<TItem, TValue>(
  items: TItem[],
  cachePath: string,
  keyFn: (item: TItem) => string,
  computeFn: (item: TItem) => Promise<TValue>,
  options?: {
    onCached?: (key: string, index: number, total: number) => void;
    onCompute?: (key: string, index: number, total: number) => void;
    onComplete?: (cached: number, computed: number) => void;
  }
): Promise<Map<string, TValue>> {
  const cache = await loadCache<Record<string, TValue>>(cachePath);
  const results = new Map<string, TValue>();

  let cached = 0;
  let computed = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const key = keyFn(item);

    if (cache[key]) {
      options?.onCached?.(key, i + 1, items.length);
      results.set(key, cache[key]);
      cached++;
    } else {
      options?.onCompute?.(key, i + 1, items.length);
      const value = await computeFn(item);
      results.set(key, value);
      cache[key] = value;
      computed++;
    }
  }

  await saveCache(cachePath, cache);
  options?.onComplete?.(cached, computed);

  return results;
}
