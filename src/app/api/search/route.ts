import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { generateEmbedding } from "@/lib/embeddings";

export async function POST(request: NextRequest) {
  const { query, nodeType, limit = 10 } = await request.json();

  if (!query) {
    return NextResponse.json({ error: "Query required" }, { status: 400 });
  }

  const supabase = createServerClient();
  const queryEmbedding = await generateEmbedding(query);

  const { data, error } = await supabase.rpc("search_similar", {
    query_embedding: queryEmbedding,
    match_threshold: 0.5,
    match_count: limit,
    filter_node_type: nodeType || null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ results: data });
}
