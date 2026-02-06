/**
 * Content node types and loading utilities
 * Content nodes are visual nodes that display article/chunk content in the graph
 */

export interface ContentNode {
  id: string;           // Paragraph node UUID
  keywordId: string;    // Parent keyword UUID
  content: string;      // Paragraph text
  summary?: string;     // Optional summary for long paragraphs
  embedding?: number[]; // 256-dim for semantic operations
  sourcePath?: string;  // Source file path (for articles)
}

/**
 * Fetch chunks (or articles) for a set of keywords
 * Note: Function name refers to DB chunks; returns ContentNode for rendering
 */
export async function fetchChunksForKeywords(
  keywordIds: string[],
  nodeType: 'article' | 'chunk' = 'chunk'
): Promise<ContentNode[]> {
  if (keywordIds.length === 0) {
    return [];
  }

  const nodeTypeLabel = nodeType === 'article' ? 'articles' : 'chunks';
  console.log(`[Content Loader] Fetching ${nodeTypeLabel} for ${keywordIds.length} keywords`);

  const response = await fetch('/api/topics/chunks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywordIds, nodeType }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${nodeTypeLabel}: ${response.statusText}`);
  }

  const { chunks } = await response.json();
  console.log(`[Content Loader] Received ${chunks.length} ${nodeTypeLabel}`);
  return chunks;
}
