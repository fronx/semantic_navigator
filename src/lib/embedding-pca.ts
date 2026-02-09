/**
 * PCA computation for stable semantic cluster coloring.
 *
 * Projects keyword embeddings (256-dim) to 2D for color mapping.
 * Used by both the REPL ingestion script and the maintenance script.
 *
 * Output format: { transform: number[][], meta: { numEmbeddings, embeddingDim, computedAt } }
 */

import { PCA } from "ml-pca";
import { createServerClient } from "./supabase";

export interface PCAOutput {
  transform: number[][];
  meta: {
    numEmbeddings: number;
    embeddingDim: number;
    computedAt: string;
  };
}

/**
 * Fetch all keyword embedding_256 vectors from Supabase.
 * Handles pagination (1000-row default limit).
 */
export async function fetchAllKeywordEmbeddings(
  supabase?: ReturnType<typeof createServerClient>
): Promise<number[][]> {
  const client = supabase ?? createServerClient();
  const allEmbeddings: number[][] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await client
      .from("keywords")
      .select("embedding_256")
      .not("embedding_256", "is", null)
      .range(offset, offset + 999);

    if (error) throw new Error(`Error fetching embeddings: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (row.embedding_256) {
        const emb =
          typeof row.embedding_256 === "string"
            ? JSON.parse(row.embedding_256)
            : row.embedding_256;
        allEmbeddings.push(emb as number[]);
      }
    }

    if (data.length < 1000) break;
    offset += 1000;
  }

  return allEmbeddings;
}

/**
 * Compute PCA transform from all keyword embeddings in the database.
 * Uses ml-pca (SVD-based) for numerical stability.
 * Returns the top 2 principal components as row vectors.
 */
export async function computeEmbeddingPCA(
  supabase?: ReturnType<typeof createServerClient>
): Promise<PCAOutput> {
  console.log("Fetching keyword embeddings...");
  const embeddings = await fetchAllKeywordEmbeddings(supabase);

  if (embeddings.length === 0) {
    throw new Error("No keyword embeddings found in database");
  }

  console.log(
    `${embeddings.length} embeddings (dim=${embeddings[0].length}), computing PCA...`
  );

  const pca = new PCA(embeddings, { center: true, scale: false });
  // getLoadings() rows = principal components; take top 2
  const loadings = pca.getLoadings().to2DArray();
  const transform = loadings.slice(0, 2);

  const variance = pca.getExplainedVariance();
  console.log(
    `Explained variance: PC1=${(variance[0] * 100).toFixed(1)}%, PC2=${(variance[1] * 100).toFixed(1)}%`
  );

  return {
    transform,
    meta: {
      numEmbeddings: embeddings.length,
      embeddingDim: embeddings[0].length,
      computedAt: new Date().toISOString(),
    },
  };
}
