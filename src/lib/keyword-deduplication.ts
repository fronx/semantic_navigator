/**
 * LLM-based keyword deduplication for handling singular/plural variations
 * and semantically similar terms that embedding-based clustering misses.
 */

import { anthropic } from "./llm";
import { extractJsonFromResponse } from "./llm";
import { Chunk } from "./chunker";

export interface KeywordPair {
  keyword1: string;
  keyword2: string;
  score: number;
}

export interface ChunkContext {
  content: string;
  file: string;
}

interface DeduplicationResult {
  action: "merge" | "keep-separate";
  canonical?: string;
}

/**
 * Extract unique keyword pairs from a similarity map (top-N similar keywords per keyword).
 * Handles reciprocal pairs only once (e.g., if "role" lists "roles" and vice versa, only one pair is returned).
 */
export function extractPairs(
  topSimilar: Map<string, Array<[string, number]>>,
  minScore = 0.7
): KeywordPair[] {
  const pairs: KeywordPair[] = [];
  const seen = new Set<string>();

  for (const [keyword, similars] of topSimilar) {
    for (const [similar, score] of similars) {
      if (score >= minScore) {
        const pairKey = [keyword, similar].sort().join("::");
        if (!seen.has(pairKey)) {
          pairs.push({ keyword1: keyword, keyword2: similar, score });
          seen.add(pairKey);
        }
      }
    }
  }

  return pairs;
}

/**
 * Get chunks that use a specific keyword, with truncated content for context.
 */
export function getChunksForKeyword(
  keyword: string,
  chunksMap: Map<string, Chunk[]>
): ChunkContext[] {
  const chunks: ChunkContext[] = [];
  for (const [path, fileChunks] of chunksMap) {
    for (const chunk of fileChunks) {
      if (chunk.keywords.includes(keyword)) {
        chunks.push({
          content: chunk.content.slice(0, 200), // truncate for context
          file: path.split("/").pop() || path, // just filename
        });
      }
    }
  }
  return chunks;
}

/**
 * Ask Haiku to decide if two keywords should be merged into one.
 * Provides chunk context to help Haiku make informed decisions.
 */
export async function deduplicatePair(
  keyword1: string,
  keyword2: string,
  chunks1: ChunkContext[],
  chunks2: ChunkContext[]
): Promise<DeduplicationResult> {
  const prompt = `You are helping deduplicate keywords in a knowledge base. Two keywords have high semantic similarity and may be duplicates.

Your task: Decide if these keywords should be merged into one, or kept as distinct concepts.

KEYWORD 1: "${keyword1}"
Used in ${chunks1.length} chunks:
${chunks1.slice(0, 3).map((c) => `- "${c.content}..." (${c.file})`).join("\n")}

KEYWORD 2: "${keyword2}"
Used in ${chunks2.length} chunks:
${chunks2.slice(0, 3).map((c) => `- "${c.content}..." (${c.file})`).join("\n")}

Guidelines:
- Merge if they're essentially the same concept (singular/plural, synonyms with no meaningful distinction)
- Keep separate if there's a meaningful semantic distinction in how they're used
- When merging, prefer:
  - Shorter forms over longer
  - Singular over plural (unless plural is standard usage)
  - More common/frequent usage

Return ONLY a JSON object:
{"action": "merge", "canonical": "keyword1"}
OR
{"action": "keep-separate"}

Choose either "${keyword1}" or "${keyword2}" as the canonical form if merging.`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return { action: "keep-separate" };
  }

  try {
    const jsonText = extractJsonFromResponse(textBlock.text);
    return JSON.parse(jsonText) as DeduplicationResult;
  } catch {
    console.error("Failed to parse dedup response:", textBlock.text);
    return { action: "keep-separate" };
  }
}

/**
 * Process all keyword pairs and build a canonical mapping.
 * For each pair with similarity >= minScore, asks Haiku to decide whether to merge.
 *
 * @returns Map from original keyword to canonical keyword (only includes merged keywords)
 */
export async function deduplicateAllPairs(
  topSimilar: Map<string, Array<[string, number]>>,
  chunksMap: Map<string, Chunk[]>,
  minScore = 0.7,
  onProgress?: (current: number, total: number, keyword1: string, keyword2: string, action: string) => void
): Promise<Map<string, string>> {
  const pairs = extractPairs(topSimilar, minScore);
  const mapping = new Map<string, string>(); // keyword -> canonical

  console.log(`[Deduplication] Processing ${pairs.length} keyword pairs...`);

  for (let i = 0; i < pairs.length; i++) {
    const { keyword1, keyword2, score } = pairs[i];
    const chunks1 = getChunksForKeyword(keyword1, chunksMap);
    const chunks2 = getChunksForKeyword(keyword2, chunksMap);

    console.log(
      `[${i + 1}/${pairs.length}] "${keyword1}" vs "${keyword2}" (${score.toFixed(3)})`
    );
    console.log(`  ${chunks1.length} chunks vs ${chunks2.length} chunks`);

    const result = await deduplicatePair(keyword1, keyword2, chunks1, chunks2);

    if (result.action === "merge" && result.canonical) {
      console.log(`  → MERGE to "${result.canonical}"`);
      // Map both to canonical (in case canonical is keyword2)
      mapping.set(keyword1, result.canonical);
      mapping.set(keyword2, result.canonical);
      onProgress?.(i + 1, pairs.length, keyword1, keyword2, `merge → ${result.canonical}`);
    } else {
      console.log(`  → KEEP SEPARATE`);
      onProgress?.(i + 1, pairs.length, keyword1, keyword2, "keep-separate");
    }
  }

  console.log(`[Deduplication] Complete: ${mapping.size} keywords mapped`);
  return mapping;
}

/**
 * Apply a deduplication mapping to chunks, replacing keywords with their canonical forms.
 */
export function applyDeduplication(
  chunksMap: Map<string, Chunk[]>,
  mapping: Map<string, string>
): Map<string, Chunk[]> {
  const updated = new Map<string, Chunk[]>();

  for (const [path, chunks] of chunksMap) {
    const updatedChunks = chunks.map((chunk) => ({
      ...chunk,
      keywords: chunk.keywords.map((kw) => mapping.get(kw) || kw),
    }));
    updated.set(path, updatedChunks);
  }

  return updated;
}

/**
 * Get unique final keywords from chunks (after deduplication).
 */
export function getUniqueKeywords(chunksMap: Map<string, Chunk[]>): string[] {
  const keywords = new Set<string>();
  for (const chunks of chunksMap.values()) {
    for (const chunk of chunks) {
      for (const kw of chunk.keywords) {
        keywords.add(kw);
      }
    }
  }
  return Array.from(keywords).sort();
}
