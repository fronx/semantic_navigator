import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { generateEmbedding } from "@/lib/embeddings";

export async function POST(request: NextRequest) {
  const startTotal = performance.now();
  const { query, nodeType, limit = 10 } = await request.json();

  if (!query) {
    return NextResponse.json({ error: "Query required" }, { status: 400 });
  }

  const supabase = createServerClient();

  console.log("[search] Query:", query, "limit:", limit, "nodeType:", nodeType);

  const startEmbed = performance.now();
  const queryEmbedding = await generateEmbedding(query);
  const embedTime = performance.now() - startEmbed;
  console.log(`[search] Embedding: ${embedTime.toFixed(0)}ms`);

  const startRpc = performance.now();
  // Only include filter_node_type if provided - passing null explicitly causes slower query plans
  const rpcParams: Record<string, unknown> = {
    query_embedding: queryEmbedding,
    match_threshold: 0.1,
    match_count: limit,
  };
  if (nodeType) {
    rpcParams.filter_node_type = nodeType;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("search_similar", rpcParams);
  const rpcTime = performance.now() - startRpc;
  const totalTime = performance.now() - startTotal;

  console.log(`[search] Embed: ${embedTime.toFixed(0)}ms, RPC: ${rpcTime.toFixed(0)}ms, Total: ${totalTime.toFixed(0)}ms, results: ${(data as unknown[])?.length}`);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ results: data });
}
