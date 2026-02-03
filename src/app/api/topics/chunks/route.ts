import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const { keywordIds } = await request.json();

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

    console.log('[Chunks API] Querying for', keywordLabels.length, 'keyword labels');
    console.log('[Chunks API] First 5 labels:', keywordLabels.slice(0, 5));

    // Query keywords table to get node_id (chunk UUID) for each keyword
    // Join with nodes table to get content/summary
    // Filter for node_type = 'chunk'
    const { data, error } = await supabase
      .from('keywords')
      .select(`
        id,
        keyword,
        node_id,
        nodes!inner (
          id,
          content,
          summary
        )
      `)
      .in('keyword', keywordLabels)
      .eq('nodes.node_type', 'chunk');

    console.log('[Chunks API] Query returned', data?.length ?? 0, 'results');
    if (error) {
      console.error('[Chunks API] Database error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch chunks' },
        { status: 500 }
      );
    }

    // Transform to ChunkNode format
    const chunks = (data || []).map((kw: any) => ({
      id: kw.nodes.id,
      keywordId: `kw:${kw.keyword}`, // Use "kw:label" format to match SimNode IDs
      content: kw.nodes.content || '',
      summary: kw.nodes.summary,
      // embedding not included (not needed for initial implementation)
    }));

    return NextResponse.json({ chunks });
  } catch (error) {
    console.error('Error in chunks API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
