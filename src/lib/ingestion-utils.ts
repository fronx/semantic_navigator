/**
 * Pure ingestion helper functions.
 * These functions take data and dependencies as parameters and return results.
 * No side effects, no console.logs - just data transformations.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { Chunk } from "./chunker";
import { generateEmbeddingsBatched, truncateEmbedding } from "./embeddings";

/**
 * Query database for already-processed article content hashes.
 * Pure function: takes supabase client, returns Set of hashes.
 */
export async function getAlreadyProcessedHashes(
  supabase: SupabaseClient
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("nodes")
    .select("content_hash")
    .eq("node_type", "article");

  if (error) throw error;

  return new Set(data?.map((r) => r.content_hash) || []);
}

/**
 * Prepare keyword records for database insertion.
 * Generates embeddings (1536 and 256 dimensions) for all final keywords.
 */
export async function prepareKeywordRecords(
  finalKeywords: string[]
): Promise<
  Array<{
    keyword: string;
    embedding: number[];
    embedding_256: number[];
  }>
> {
  console.log(`\nPreparing ${finalKeywords.length} keyword records...`);

  // Generate embeddings for all final keywords
  const embeddings1536 = await generateEmbeddingsBatched(
    finalKeywords,
    (completed, total) => {
      if (completed % 100 === 0 || completed === total) {
        console.log(`  [${completed}/${total}] embeddings generated`);
      }
    }
  );

  // Truncate to 256 dimensions
  console.log("  Truncating embeddings to 256 dimensions...");
  const embeddings256 = embeddings1536.map((emb) =>
    truncateEmbedding(emb, 256)
  );

  // Build keyword records
  const records = finalKeywords.map((keyword, i) => ({
    keyword,
    embedding: embeddings1536[i],
    embedding_256: embeddings256[i],
  }));

  console.log(`✓ Prepared ${records.length} keyword records\n`);
  return records;
}

/**
 * Prepare keyword occurrences (which keywords appear in which chunks).
 * Returns array of {keyword, file_path, chunk_position}
 */
export function prepareKeywordOccurrences(
  chunksMap: Map<string, Chunk[]>
): Array<{
  keyword: string;
  file_path: string;
  chunk_position: number;
}> {
  const occurrences: Array<{
    keyword: string;
    file_path: string;
    chunk_position: number;
  }> = [];

  for (const [filePath, chunks] of chunksMap) {
    for (const chunk of chunks) {
      for (const keyword of chunk.keywords) {
        occurrences.push({
          keyword,
          file_path: filePath,
          chunk_position: chunk.position,
        });
      }
    }
  }

  console.log(`✓ Prepared ${occurrences.length} keyword occurrences\n`);
  return occurrences;
}
