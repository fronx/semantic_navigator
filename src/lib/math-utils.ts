/**
 * Shared math utilities for semantic operations.
 */

/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Apply symmetric S-curve contrast around 0.5.
 * At contrast=1: linear (no change)
 * At contrast>1: weak values become weaker, strong become stronger
 *
 * Examples at contrast=3:
 *   0.3 → 0.11, 0.5 → 0.5, 0.7 → 0.89, 0.9 → 0.996
 */
export function applyContrast(value: number, contrast: number): number {
  if (contrast === 1) return value;
  if (value <= 0.5) {
    return 0.5 * Math.pow(2 * value, contrast);
  }
  return 1 - 0.5 * Math.pow(2 * (1 - value), contrast);
}

/**
 * Normalize a vector to unit length.
 */
export function normalize(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) {
    norm += v * v;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}
