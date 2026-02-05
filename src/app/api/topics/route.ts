import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import {
  getKeywordBackbone,
  type KeywordNode,
  type SimilarityEdge,
} from "@/lib/graph-queries";

export interface TopicsData {
  nodes: KeywordNode[];
  edges: SimilarityEdge[];
}

/**
 * GET /api/topics
 *
 * Returns keyword backbone graph for the Topics view.
 * Keywords are connected by cross-article semantic similarity.
 * Articles are hidden - only the keyword connections are shown.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const maxEdgesPerArticle = parseInt(searchParams.get("maxEdges") || "10", 10);
  const minSimilarity = parseFloat(searchParams.get("minSimilarity") || "0.3");
  const level = parseInt(searchParams.get("level") || "3", 10);
  const nodeType = searchParams.get("nodeType") === "chunk" ? "chunk" : "article";

  const supabase = createServerClient();

  try {
    const result = await getKeywordBackbone(supabase, {
      maxEdgesPerArticle,
      minSimilarity,
      communityLevel: level,
      nodeType,
    });

    console.log(
      `[topics] Loaded ${result.nodes.length} ${nodeType} keywords,`,
      result.edges.length,
      "similarity edges"
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("[topics] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
