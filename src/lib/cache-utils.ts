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

/**
 * Generate SHA256 hash of content (first 16 characters).
 * Used for change detection in ingestion pipeline.
 */
export function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Save Map to JSON file (converts Map to object).
 */
export async function saveMapCache<K extends string, V>(
  map: Map<K, V>,
  filePath: string
): Promise<void> {
  const obj = Object.fromEntries(map);
  await fs.writeFile(filePath, JSON.stringify(obj, null, 2));
}

/**
 * Load Map from JSON file (converts object back to Map).
 */
export async function loadMapCache<K extends string, V>(
  filePath: string
): Promise<Map<K, V>> {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    const obj = JSON.parse(data);
    return new Map(Object.entries(obj)) as Map<K, V>;
  } catch {
    return new Map();
  }
}

/**
 * Save prepared keyword data for database insertion.
 */
export async function savePreparedKeywordData(
  keywordRecords: Array<{
    keyword: string;
    embedding: number[];
    embedding_256: number[];
  }>,
  keywordOccurrences: Array<{
    keyword: string;
    file_path: string;
    chunk_position: number;
  }>,
  filePath = "./data/keywords-prepared.json"
): Promise<void> {
  await fs.writeFile(
    filePath,
    JSON.stringify({ keywordRecords, keywordOccurrences }, null, 2)
  );
}

/**
 * Load prepared keyword data from file.
 */
export async function loadPreparedKeywordData(
  filePath = "./data/keywords-prepared.json"
): Promise<{
  keywordRecords: Array<{
    keyword: string;
    embedding: number[];
    embedding_256: number[];
  }>;
  keywordOccurrences: Array<{
    keyword: string;
    file_path: string;
    chunk_position: number;
  }>;
}> {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch {
    return { keywordRecords: [], keywordOccurrences: [] };
  }
}
