import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { adaptToContentNode } from "@/lib/node-adapters";

export async function POST(request: Request) {
  try {
    const { keywordIds, nodeType = 'chunk' } = await request.json();

    if (!Array.isArray(keywordIds) || keywordIds.length === 0) {
      return NextResponse.json({ chunks: [] });
    }

    // Extract keyword labels from "kw:label" format
    const keywordLabels = keywordIds.map(id => {
      if (typeof id === 'string' && id.startsWith('kw:')) {
        return id.substring(3); // Remove "kw:" prefix
      }
      return id;
    });

    const supabase = createServerClient();

    const nodeTypeLabel = nodeType === 'article' ? 'articles' : 'chunks';
    console.log(`[Chunks API] Querying for ${keywordLabels.length} keyword labels (${nodeTypeLabel})`);
    console.log('[Chunks API] First 5 labels:', keywordLabels.slice(0, 5));

    // Query keywords table, join through keyword_occurrences to get nodes
    // Filter by nodeType (article or chunk) via keyword_occurrences.node_type
    // Note: Using 'any' cast because Supabase types don't include the new schema yet
    const { data, error } = await supabase
      .from('keywords')
      .select(`
        id,
        keyword,
        keyword_occurrences!inner (
          node_id,
          node_type,
          nodes!inner (
            id,
            content,
            summary,
            source_path,
            node_type
          )
        )
      `)
      .in('keyword', keywordLabels)
      .eq('keyword_occurrences.node_type', nodeType) as any;

    if (error) {
      console.error('[Chunks API] Database error:', error);
      return NextResponse.json(
        { error: `Failed to fetch ${nodeTypeLabel}` },
        { status: 500 }
      );
    }

    // Flatten keyword_occurrences array (keyword can have multiple nodes)
    // Transform to format expected by adapter
    interface KeywordWithOccurrences {
      id: string;
      keyword: string;
      keyword_occurrences: Array<{
        node_id: string;
        node_type: string;
        nodes: {
          id: string;
          content: string | null;
          summary: string | null;
          source_path: string | null;
          node_type: string;
        };
      }>;
    }

    const flatRows = ((data || []) as KeywordWithOccurrences[]).flatMap(kwRow =>
      kwRow.keyword_occurrences.map(occ => ({
        id: kwRow.id,
        keyword: kwRow.keyword,
        node_id: occ.node_id,
        nodes: occ.nodes
      }))
    );

    console.log(`[Chunks API] Query returned ${flatRows.length} ${nodeTypeLabel}`);

    // Transform to ChunkNode format using adapter
    const chunks = flatRows.map(row => adaptToContentNode(row, nodeType));

    return NextResponse.json({ chunks });
  } catch (error) {
    console.error('Error in chunks API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
