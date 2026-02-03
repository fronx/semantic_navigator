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
 * Fetch chunks for a set of keywords
 */
export async function fetchChunksForKeywords(
  keywordIds: string[]
): Promise<ChunkNode[]> {
  if (keywordIds.length === 0) {
    return [];
  }

  console.log('[Chunk Loader] Fetching chunks for', keywordIds.length, 'keywords');

  const response = await fetch('/api/topics/chunks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywordIds }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch chunks: ${response.statusText}`);
  }

  const { chunks } = await response.json();
  console.log('[Chunk Loader] Received', chunks.length, 'chunks');
  return chunks;
}
