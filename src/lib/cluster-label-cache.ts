/**
 * Client-side cache for cluster labels with semantic similarity matching.
 *
 * Uses localStorage to persist labels across sessions.
 * Matches clusters by embedding centroid similarity rather than exact keyword match,
 * allowing cache hits even when cluster membership changes slightly.
 */
import { cosineSimilarity, normalize } from "./math-utils";

export interface CachedClusterLabel {
  /** Keywords in this cluster (sorted for canonical form) */
  keywords: string[];
  /** Centroid embedding (average of keyword embeddings, normalized) */
  centroid: number[];
  /** Generated label */
  label: string;
  /** Timestamp for LRU eviction */
  timestamp: number;
}

export interface ClusterLabelCache {
  /** Version for cache invalidation on schema changes */
  version: number;
  entries: CachedClusterLabel[];
}

export interface CacheMatch {
  entry: CachedClusterLabel;
  similarity: number;
}

const CACHE_KEY = "cluster-label-cache";
const CACHE_VERSION = 1;
const MAX_CACHE_ENTRIES = 500;

/**
 * Load cache from localStorage.
 * Returns empty cache if not found or version mismatch.
 */
export function loadCache(): ClusterLabelCache {
  if (typeof window === "undefined") {
    return { version: CACHE_VERSION, entries: [] };
  }

  try {
    const stored = localStorage.getItem(CACHE_KEY);
    if (!stored) {
      return { version: CACHE_VERSION, entries: [] };
    }

    const parsed = JSON.parse(stored) as ClusterLabelCache;

    // Version check - invalidate on schema changes
    if (parsed.version !== CACHE_VERSION) {
      console.log("[cluster-cache] Version mismatch, clearing cache");
      return { version: CACHE_VERSION, entries: [] };
    }

    return parsed;
  } catch {
    return { version: CACHE_VERSION, entries: [] };
  }
}

/**
 * Save cache to localStorage with LRU eviction.
 */
export function saveCache(cache: ClusterLabelCache): void {
  if (typeof window === "undefined") return;

  // LRU eviction - keep most recently used entries
  if (cache.entries.length > MAX_CACHE_ENTRIES) {
    cache.entries.sort((a, b) => b.timestamp - a.timestamp);
    cache.entries = cache.entries.slice(0, MAX_CACHE_ENTRIES);
  }

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    // localStorage full - clear and retry
    console.warn("[cluster-cache] Storage full, clearing cache");
    localStorage.removeItem(CACHE_KEY);
  }
}

/**
 * Compute centroid (average embedding) from a list of embeddings.
 * Returns normalized vector for consistent cosine similarity.
 */
export function computeCentroid(embeddings: number[][]): number[] {
  if (embeddings.length === 0) {
    throw new Error("Cannot compute centroid of empty embedding list");
  }

  const dim = embeddings[0].length;
  const sum = new Array(dim).fill(0);

  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      sum[i] += emb[i];
    }
  }

  // Average
  for (let i = 0; i < dim; i++) {
    sum[i] /= embeddings.length;
  }

  return normalize(sum);
}

/**
 * Find best matching cached entry by centroid similarity.
 *
 * @param centroid - Normalized centroid of the query cluster
 * @param cache - Cache to search
 * @param threshold - Minimum similarity to consider a match (default 0.85)
 * @returns Best match above threshold, or null if none found
 */
export function findBestMatch(
  centroid: number[],
  cache: ClusterLabelCache,
  threshold: number = 0.85
): CacheMatch | null {
  let bestMatch: CacheMatch | null = null;

  for (const entry of cache.entries) {
    const similarity = cosineSimilarity(centroid, entry.centroid);

    if (similarity >= threshold) {
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { entry, similarity };
      }
    }
  }

  return bestMatch;
}

/**
 * Add or update an entry in the cache.
 * Updates timestamp if entry with same centroid exists (within threshold).
 */
export function addToCache(
  cache: ClusterLabelCache,
  entry: Omit<CachedClusterLabel, "timestamp">
): void {
  const now = Date.now();

  // Check if similar entry already exists
  const existing = findBestMatch(entry.centroid, cache, 0.95);

  if (existing) {
    // Update existing entry
    existing.entry.label = entry.label;
    existing.entry.keywords = entry.keywords;
    existing.entry.timestamp = now;
  } else {
    // Add new entry
    cache.entries.push({
      ...entry,
      timestamp: now,
    });
  }
}

/**
 * Update timestamp on a cache entry (marks as recently used for LRU).
 */
export function touchCacheEntry(entry: CachedClusterLabel): void {
  entry.timestamp = Date.now();
}
