import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

/**
 * GET /api/nodes/all
 *
 * Returns all nodes (chunks or articles) with content for offline caching.
 * Used by download-offline-data.ts script.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const nodeType = searchParams.get("nodeType") || "chunk"; // 'chunk' or 'article'

  const supabase = createServerClient();

  try {
    const PAGE_SIZE = 1000;
    const nodes: any[] = [];
    let from = 0;

    // Paginate to get all nodes
    while (true) {
      const { data, error } = await supabase
        .from("nodes")
        .select("id, content, summary, source_path, heading_context, chunk_type, node_type")
        .eq("node_type", nodeType)
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      nodes.push(...data);

      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    console.log(`[Nodes All] Returned ${nodes.length} ${nodeType} nodes`);

    return NextResponse.json({ nodes });
  } catch (error) {
    console.error("Error in nodes/all API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
