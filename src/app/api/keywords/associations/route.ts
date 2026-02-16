import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export interface KeywordAssociation {
  keywordId: string;
  keyword: string;
  nodeId: string;
  nodeType: string;
}

/**
 * GET /api/keywords/associations
 *
 * Returns all keyword-node associations (keyword_occurrences table).
 * Used for offline caching to enable keyword-based content loading.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const nodeType = searchParams.get("nodeType"); // Optional filter: 'chunk' or 'article'

  const supabase = createServerClient();

  try {
    let query = supabase
      .from("keyword_occurrences")
      .select(`
        keyword_id,
        node_id,
        node_type,
        keywords!inner(keyword)
      `);

    if (nodeType) {
      query = query.eq("node_type", nodeType);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[Keywords Associations] Database error:", error);
      return NextResponse.json(
        { error: "Failed to fetch keyword associations" },
        { status: 500 }
      );
    }

    // Flatten the structure
    const associations: KeywordAssociation[] = (data || []).map((row: any) => ({
      keywordId: row.keyword_id,
      keyword: row.keywords.keyword,
      nodeId: row.node_id,
      nodeType: row.node_type,
    }));

    console.log(`[Keywords Associations] Returned ${associations.length} associations`);

    return NextResponse.json({ associations });
  } catch (error) {
    console.error("Error in keywords associations API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
