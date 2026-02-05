/**
 * Chunk node types and loading utilities
 */

export interface ChunkNode {
  id: string;           // Paragraph node UUID
  keywordId: string;    // Parent keyword UUID
  content: string;      // Paragraph text
  summary?: string;     // Optional summary for long paragraphs
  embedding?: number[]; // 256-dim for semantic operations
}

/**
 * Fetch chunks (or articles) for a set of keywords
 */
export async function fetchChunksForKeywords(
  keywordIds: string[],
  nodeType: 'article' | 'chunk' = 'chunk'
): Promise<ChunkNode[]> {
  if (keywordIds.length === 0) {
    return [];
  }

  const nodeTypeLabel = nodeType === 'article' ? 'articles' : 'chunks';
  console.log(`[Chunk Loader] Fetching ${nodeTypeLabel} for ${keywordIds.length} keywords`);

  const response = await fetch('/api/topics/chunks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywordIds, nodeType }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${nodeTypeLabel}: ${response.statusText}`);
  }

  const { chunks } = await response.json();
  console.log(`[Chunk Loader] Received ${chunks.length} ${nodeTypeLabel}`);
  return chunks;
}
