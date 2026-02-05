import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { adaptToChunkNode } from "@/lib/node-adapters";

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

    // Query keywords table to get node_id for each keyword
    // Join with nodes table to get content/summary
    // Filter by nodeType (article or chunk)
    const { data, error } = await supabase
      .from('keywords')
      .select(`
        id,
        keyword,
        node_id,
        nodes!inner (
          id,
          content,
          summary,
          source_path
        )
      `)
      .in('keyword', keywordLabels)
      .eq('nodes.node_type', nodeType);

    console.log(`[Chunks API] Query returned ${data?.length ?? 0} ${nodeTypeLabel}`);
    if (error) {
      console.error('[Chunks API] Database error:', error);
      return NextResponse.json(
        { error: `Failed to fetch ${nodeTypeLabel}` },
        { status: 500 }
      );
    }

    // Transform to ChunkNode format using adapter
    const chunks = (data || []).map(row => adaptToChunkNode(row, nodeType));

    return NextResponse.json({ chunks });
  } catch (error) {
    console.error('Error in chunks API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
