import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { generateEmbedding } from "@/lib/embeddings";

export async function POST(request: NextRequest) {
  const { query, nodeType, limit = 10 } = await request.json();

  if (!query) {
    return NextResponse.json({ error: "Query required" }, { status: 400 });
  }

  const supabase = createServerClient();

  console.log("[search] Query:", query, "limit:", limit, "nodeType:", nodeType);

  const queryEmbedding = await generateEmbedding(query);
  console.log("[search] Embedding generated, length:", queryEmbedding?.length);

  const { data, error } = await supabase.rpc("search_similar", {
    query_embedding: queryEmbedding,
    match_threshold: 0.1,
    match_count: limit,
    filter_node_type: nodeType || null,
  });

  console.log("[search] RPC result - error:", error, "data count:", data?.length);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ results: data });
}
