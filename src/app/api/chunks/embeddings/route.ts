import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { truncateEmbedding } from "@/lib/embeddings";

export interface ChunkEmbeddingData {
  id: string;
  content: string;
  summary: string | null;
  sourcePath: string;
  headingContext: string[] | null;
  chunkType: string | null;
  embedding: number[]; // 256-dim (first 256 of 1536 Matryoshka truncation)
}

const PAGE_SIZE = 1000;
const TRUNCATED_DIMS = 256;

/**
 * GET /api/chunks/embeddings
 *
 * Returns all chunks with their embeddings truncated to 256 dimensions.
 * Used for UMAP dimensionality reduction on the client.
 */
export async function GET() {
  const supabase = createServerClient();

  try {
    const chunks: ChunkEmbeddingData[] = [];
    let from = 0;

    // Paginate past Supabase's default 1000-row limit
    while (true) {
      const { data, error } = await supabase
        .from("nodes")
        .select("id, content, summary, source_path, heading_context, chunk_type, embedding")
        .eq("node_type", "chunk")
        .not("embedding", "is", null)
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      for (const row of data) {
        const fullEmbedding =
          typeof row.embedding === "string"
            ? JSON.parse(row.embedding)
            : row.embedding;

        chunks.push({
          id: row.id,
          content: row.content ?? "",
          summary: row.summary ?? null,
          sourcePath: row.source_path ?? "",
          headingContext: row.heading_context ?? null,
          chunkType: row.chunk_type ?? null,
          embedding: truncateEmbedding(fullEmbedding, TRUNCATED_DIMS),
        });
      }

      // If we got fewer rows than PAGE_SIZE, we've reached the end
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    console.log(`[chunks/embeddings] Loaded ${chunks.length} chunks with ${TRUNCATED_DIMS}-dim embeddings`);

    return NextResponse.json(chunks);
  } catch (error) {
    console.error("[chunks/embeddings] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
