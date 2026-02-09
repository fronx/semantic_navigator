/**
 * Generic utilities for keyword similarity analysis and clustering.
 * These are domain-agnostic and reusable across different contexts.
 */

import { cosineSimilarity } from "./math-utils";

/**
 * Build a pairwise similarity matrix for keywords using their embeddings.
 */
export function buildSimilarityMatrix(
  keywords: string[],
  embeddings: number[][]
): Map<string, Map<string, number>> {
  const matrix = new Map<string, Map<string, number>>();

  for (let i = 0; i < keywords.length; i++) {
    const similarities = new Map<string, number>();
    for (let j = 0; j < keywords.length; j++) {
      if (i !== j) {
        const similarity = cosineSimilarity(embeddings[i], embeddings[j]);
        similarities.set(keywords[j], similarity);
      }
    }
    matrix.set(keywords[i], similarities);
  }

  return matrix;
}

/**
 * Filter and sort similarity entries above a threshold.
 */
export function filterAndSort(
  entries: Map<string, number>,
  minThreshold: number
): Array<[string, number]> {
  return Array.from(entries)
    .filter(([_, score]) => score >= minThreshold)
    .sort((a, b) => b[1] - a[1]);
}

/**
 * Select top N entries, always including items above highThreshold.
 * This ensures high-priority matches are never dropped even if topN is small.
 */
export function selectTopN(
  items: Array<[string, number]>,
  topN: number,
  highThreshold: number
): Array<[string, number]> {
  const high = items.filter(([_, score]) => score >= highThreshold);
  const regular = items.filter(([_, score]) => score < highThreshold);
  return [...high, ...regular.slice(0, topN)].sort((a, b) => b[1] - a[1]);
}

/**
 * Get top N most similar keywords for each keyword, with threshold filtering.
 * Always includes high-priority matches (>= highThreshold) even if they exceed topN.
 */
export function getTopSimilar(
  matrix: Map<string, Map<string, number>>,
  options: {
    minThreshold?: number;
    highThreshold?: number;
    topN?: number;
  } = {}
): Map<string, Array<[string, number]>> {
  const { minThreshold = 0.7, highThreshold = 0.9, topN = 5 } = options;

  return new Map(
    Array.from(matrix).map(([keyword, similarities]) => [
      keyword,
      selectTopN(filterAndSort(similarities, minThreshold), topN, highThreshold),
    ])
  );
}

/**
 * Cluster keywords by similarity threshold using a greedy algorithm.
 * Once a keyword is assigned to a cluster, it's not considered for other clusters.
 */
export function clusterByThreshold(
  matrix: Map<string, Map<string, number>>,
  threshold: number
): string[][] {
  const visited = new Set<string>();
  const clusters: string[][] = [];

  for (const [keyword, similarities] of matrix) {
    if (visited.has(keyword)) continue;

    const cluster = [keyword];
    visited.add(keyword);

    for (const [other, score] of similarities) {
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
 * Pick a representative keyword from a cluster using a scoring function.
 * Common patterns: most frequent, shortest, or a combination.
 */
export function pickRepresentativeBy(
  cluster: string[],
  scoreFn: (keyword: string) => number
): string {
  return cluster.reduce((best, item) => (scoreFn(item) > scoreFn(best) ? item : best));
}

/**
 * Pick representative keyword preferring frequent + short forms.
 */
export function pickRepresentative(
  cluster: string[],
  keywordCounts: Map<string, number>
): string {
  return pickRepresentativeBy(cluster, (keyword) => {
    const count = keywordCounts.get(keyword) || 0;
    // Use count * 1000 - length to prefer frequent + short
    return count * 1000 - keyword.length;
  });
}

/**
 * Build a deduplication mapping from clusters to their representatives.
 */
export function deduplicateKeywords(
  clusters: string[][],
  keywordCounts: Map<string, number>
): Map<string, string> {
  const mapping = new Map<string, string>();

  for (const cluster of clusters) {
    const rep = pickRepresentative(cluster, keywordCounts);
    for (const keyword of cluster) {
      mapping.set(keyword, rep);
    }
  }

  return mapping;
}

/**
 * Count keyword occurrences in an array.
 */
export function countKeywords(keywords: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const keyword of keywords) {
    counts.set(keyword, (counts.get(keyword) || 0) + 1);
  }
  return counts;
}
