import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { adaptToContentNode } from "@/lib/node-adapters";
import { loadOfflineJSON } from "@/lib/offline-data";

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

    let data: any = null;
    let error: any = null;

    // Try offline cache first (server-side only)
    if (typeof window === 'undefined') {
      try {
        const offlineAssociations = await loadOfflineJSON<{ associations: Array<{ keywordId: string; keyword: string; nodeId: string; nodeType: string }> }>(
          `keyword-associations-${nodeType}.json`
        );
        const offlineNodes = await loadOfflineJSON<{ nodes: any[] }>(
          `nodes-${nodeType}.json`
        );

        if (offlineAssociations && offlineNodes) {
          console.log('[Chunks API] Using offline cache');

          // Filter associations by requested keywords
          const relevantAssocs = offlineAssociations.associations.filter(
            assoc => keywordLabels.includes(assoc.keyword)
          );

          // Build node lookup
          const nodeLookup = new Map<string, any>();
          for (const node of offlineNodes.nodes) {
            nodeLookup.set(node.id, node);
          }

          // Build response structure matching database format
          const keywordMap = new Map<string, any>();
          for (const assoc of relevantAssocs) {
            const node = nodeLookup.get(assoc.nodeId);
            if (!node) continue;

            if (!keywordMap.has(assoc.keyword)) {
              keywordMap.set(assoc.keyword, {
                id: assoc.keywordId,
                keyword: assoc.keyword,
                keyword_occurrences: []
              });
            }

            keywordMap.get(assoc.keyword).keyword_occurrences.push({
              node_id: assoc.nodeId,
              node_type: assoc.nodeType,
              nodes: {
                id: node.id,
                content: node.content,
                summary: node.summary || null,
                source_path: node.sourcePath || node.source_path || null,
                node_type: assoc.nodeType
              }
            });
          }

          data = Array.from(keywordMap.values());
        }
      } catch (offlineError) {
        console.log('[Chunks API] Offline cache unavailable, using database');
      }
    }

    // Fall back to database query if offline cache not available
    if (!data) {
      const result = await supabase
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

      data = result.data;
      error = result.error;
    }

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
