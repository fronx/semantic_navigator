/**
 * Generic array and collection utilities.
 * Domain-agnostic helpers for common operations on arrays, maps, and sets.
 */

/**
 * Count occurrences of items in an array.
 * Returns a Map where keys are unique items and values are counts.
 */
export function countOccurrences<T>(items: T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  return counts;
}

/**
 * Get top N entries from a Map, sorted by value descending.
 * Useful for finding most frequent items, highest scores, etc.
 */
export function topEntries<K, V>(
  map: Map<K, V>,
  n = 20
): Array<[K, V]> {
  return Array.from(map.entries())
    .sort((a, b) => {
      const aVal = a[1] as number;
      const bVal = b[1] as number;
      return bVal - aVal;
    })
    .slice(0, n);
}

/**
 * Filter entries above threshold and sort by score descending.
 */
export function filterAndSort<T>(
  entries: Map<T, number>,
  minThreshold: number
): Array<[T, number]> {
  return Array.from(entries)
    .filter(([_, score]) => score >= minThreshold)
    .sort((a, b) => b[1] - a[1]);
}

/**
 * Select top N entries, always including items above highThreshold.
 * This ensures high-priority matches are never dropped even if topN is small.
 */
export function selectTopN<T>(
  items: Array<[T, number]>,
  topN: number,
  highThreshold: number
): Array<[T, number]> {
  const high = items.filter(([_, score]) => score >= highThreshold);
  const regular = items.filter(([_, score]) => score < highThreshold);
  return [...high, ...regular.slice(0, topN)].sort((a, b) => b[1] - a[1]);
}

/**
 * Build pairwise comparison matrix using a comparison function.
 * For N items, creates N×N matrix where matrix[i][j] = compareFn(items[i], items[j]).
 */
export function buildComparisonMatrix<T>(
  items: T[],
  compareFn: (a: T, b: T, indexA: number, indexB: number) => number
): Map<T, Map<T, number>> {
  const matrix = new Map<T, Map<T, number>>();

  for (let i = 0; i < items.length; i++) {
    const comparisons = new Map<T, number>();
    for (let j = 0; j < items.length; j++) {
      if (i !== j) {
        comparisons.set(items[j], compareFn(items[i], items[j], i, j));
      }
    }
    matrix.set(items[i], comparisons);
  }

  return matrix;
}

/**
 * Cluster items by threshold using greedy algorithm.
 * Once an item is assigned to a cluster, it's not considered for other clusters.
 */
export function clusterByThreshold<T>(
  matrix: Map<T, Map<T, number>>,
  threshold: number
): T[][] {
  const visited = new Set<T>();
  const clusters: T[][] = [];

  for (const [item, comparisons] of matrix) {
    if (visited.has(item)) continue;

    const cluster = [item];
    visited.add(item);

    for (const [other, score] of comparisons) {
      if (!visited.has(other) && score >= threshold) {
        cluster.push(other);
        visited.add(other);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

/**
 * Pick a representative item from a cluster using a scoring function.
 * Common patterns: most frequent, shortest, or a combination.
 */
export function pickRepresentativeBy<T>(
  cluster: T[],
  scoreFn: (item: T) => number
): T {
  return cluster.reduce((best, item) =>
    scoreFn(item) > scoreFn(best) ? item : best
  );
}

/**
 * Split array into batches of specified size.
 * Pure function: array → batched array.
 */
export function batch<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}
