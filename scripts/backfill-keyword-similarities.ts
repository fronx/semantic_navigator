/**
 * Backfill keyword_similarities table for existing article-level keywords.
 * Computes pairwise cosine similarities and stores pairs above 0.7 threshold.
 */
import { createServerClient } from "../src/lib/supabase";

const SIMILARITY_THRESHOLD = 0.5;
const BATCH_SIZE = 100; // Insert batch size

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

async function main() {
  const supabase = createServerClient();

  // Fetch all article-level keywords with embeddings (with pagination to avoid 1000-row limit)
  console.log("Fetching article-level keywords...");
  const FETCH_BATCH = 1000;
  const keywords: Array<{ id: string; keyword: string; embedding: unknown }> = [];
  let offset = 0;

  while (true) {
    const { data: batch, error } = await supabase
      .from("keywords")
      .select("id, keyword, embedding")
      .eq("node_type", "article")
      .not("embedding", "is", null)
      .range(offset, offset + FETCH_BATCH - 1);

    if (error) {
      console.error("Error fetching keywords:", error);
      process.exit(1);
    }

    if (!batch || batch.length === 0) break;

    keywords.push(...batch);
    console.log(`  Fetched ${keywords.length} keywords...`);

    if (batch.length < FETCH_BATCH) break;
    offset += FETCH_BATCH;
  }

  if (keywords.length === 0) {
    console.log("No article-level keywords found.");
    return;
  }

  console.log(`Found ${keywords.length} article-level keywords`);

  // Parse embeddings
  const keywordsWithParsedEmbeddings = keywords.map((k) => ({
    id: k.id,
    keyword: k.keyword,
    embedding:
      typeof k.embedding === "string" ? JSON.parse(k.embedding) : k.embedding,
  }));

  // Compute pairwise similarities
  console.log("Computing pairwise similarities...");
  const similarityPairs: Array<{
    keyword_a_id: string;
    keyword_b_id: string;
    similarity: number;
  }> = [];

  const n = keywordsWithParsedEmbeddings.length;
  let pairsChecked = 0;
  const totalPairs = (n * (n - 1)) / 2;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = keywordsWithParsedEmbeddings[i];
      const b = keywordsWithParsedEmbeddings[j];
      const similarity = cosineSimilarity(a.embedding, b.embedding);

      if (similarity >= SIMILARITY_THRESHOLD) {
        // Canonical ordering: smaller UUID first
        const [id1, id2] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
        similarityPairs.push({
          keyword_a_id: id1,
          keyword_b_id: id2,
          similarity,
        });
      }

      pairsChecked++;
      if (pairsChecked % 10000 === 0) {
        console.log(
          `  Checked ${pairsChecked}/${totalPairs} pairs, found ${similarityPairs.length} above threshold`
        );
      }
    }
  }

  console.log(
    `Found ${similarityPairs.length} pairs above ${SIMILARITY_THRESHOLD} threshold`
  );

  if (similarityPairs.length === 0) {
    console.log("No similar keyword pairs to insert.");
    return;
  }

  // Insert in batches
  console.log("Inserting similarity pairs...");
  for (let i = 0; i < similarityPairs.length; i += BATCH_SIZE) {
    const batch = similarityPairs.slice(i, i + BATCH_SIZE);
    const { error: insertError } = await supabase
      .from("keyword_similarities")
      .upsert(batch, { onConflict: "keyword_a_id,keyword_b_id" });

    if (insertError) {
      console.error("Error inserting batch:", insertError);
      process.exit(1);
    }

    console.log(
      `  Inserted ${Math.min(i + BATCH_SIZE, similarityPairs.length)}/${similarityPairs.length}`
    );
  }

  console.log("Done!");
}

main();
