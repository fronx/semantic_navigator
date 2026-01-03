import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

interface SimilarKeyword {
  keyword: string;
  similarity: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const similarK = parseInt(searchParams.get("similarK") || "1", 10);

  const supabase = createServerClient();

  // Get the node
  const { data: node, error: nodeError } = await supabase
    .from("nodes")
    .select("*")
    .eq("id", id)
    .single();

  if (nodeError) {
    return NextResponse.json({ error: nodeError.message }, { status: 404 });
  }

  // Get children via containment edges
  const { data: childEdges } = await supabase
    .from("containment_edges")
    .select("child_id, position")
    .eq("parent_id", id)
    .order("position");

  let children = null;
  if (childEdges && childEdges.length > 0) {
    const childIds = childEdges.map((e) => e.child_id);
    const { data: childNodes } = await supabase
      .from("nodes")
      .select("*")
      .in("id", childIds);

    // Fetch keywords for all children
    const { data: childKeywords } = await supabase
      .from("keywords")
      .select("node_id, keyword")
      .in("node_id", childIds);

    // Group keywords by node_id
    const keywordsByNode = new Map<string, string[]>();
    for (const kw of childKeywords || []) {
      if (!keywordsByNode.has(kw.node_id)) {
        keywordsByNode.set(kw.node_id, []);
      }
      keywordsByNode.get(kw.node_id)!.push(kw.keyword);
    }

    // Sort by position
    const positionMap = new Map(childEdges.map((e) => [e.child_id, e.position]));
    const sortedChildren = childNodes?.sort(
      (a, b) => (positionMap.get(a.id) || 0) - (positionMap.get(b.id) || 0)
    );

    // Find similar keywords for each child based on embedding similarity
    const similarKeywordsByNode = new Map<string, SimilarKeyword[]>();
    if (similarK > 0 && sortedChildren) {
      // Process in parallel for efficiency
      const similarityPromises = sortedChildren.map(async (child) => {
        if (!child.embedding) return { nodeId: child.id, similar: [] };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.rpc as any)(
          "find_similar_keywords_for_node",
          {
            node_embedding: child.embedding,
            match_count: similarK,
            min_similarity: 0.3,
          }
        );

        if (error) {
          console.error(`Error finding similar keywords for ${child.id}:`, error);
          return { nodeId: child.id, similar: [] };
        }

        return {
          nodeId: child.id,
          similar: (data || []) as SimilarKeyword[],
        };
      });

      const results = await Promise.all(similarityPromises);
      for (const { nodeId, similar } of results) {
        similarKeywordsByNode.set(nodeId, similar);
      }
    }

    // Attach keywords and similarKeywords to each child
    children = sortedChildren?.map((node) => ({
      ...node,
      keywords: keywordsByNode.get(node.id) || [],
      similarKeywords: similarKeywordsByNode.get(node.id) || [],
    }));
  }

  // Get parent
  const { data: parentEdge } = await supabase
    .from("containment_edges")
    .select("parent_id")
    .eq("child_id", id)
    .single();

  let parent = null;
  if (parentEdge) {
    const { data: parentNode } = await supabase
      .from("nodes")
      .select("id, node_type, summary, source_path")
      .eq("id", parentEdge.parent_id)
      .single();
    parent = parentNode;
  }

  // Get backlinks (nodes that link to this one)
  const { data: incomingLinks } = await supabase
    .from("backlink_edges")
    .select("source_id, link_text")
    .eq("target_id", id);

  let backlinks = null;
  if (incomingLinks && incomingLinks.length > 0) {
    const sourceIds = incomingLinks.map((l) => l.source_id);
    const { data: sourceNodes } = await supabase
      .from("nodes")
      .select("id, node_type, summary, source_path")
      .in("id", sourceIds);
    backlinks = sourceNodes;
  }

  return NextResponse.json({ node, children, parent, backlinks });
}
