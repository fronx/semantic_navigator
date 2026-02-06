/**
 * Adapters for mapping database node rows to ContentNode interface.
 * Configuration-based approach for easy extension with new node types or display modes.
 */

import type { ContentNode } from '@/lib/content-loader';

/**
 * Database row structure from Supabase query
 */
interface NodeRow {
  id: string;
  content: string | null;
  summary: string | null;
  source_path: string | null;
}

export interface KeywordWithNode {
  id: string;
  keyword: string;
  node_id: string;
  nodes: NodeRow;
}

type ContentMode = 'full' | 'summary';
type NodeType = 'article' | 'chunk';

/**
 * Configuration mapping: node type → mode → content extraction function
 */
const CONTENT_EXTRACTORS: Record<NodeType, Record<ContentMode, (nodes: NodeRow) => string>> = {
  article: {
    // Articles only have summary (no full content field)
    full: (nodes) => nodes.summary || '',
    summary: (nodes) => nodes.summary || '',
  },
  chunk: {
    // Chunks have full content and optional summary
    full: (nodes) => nodes.content || '',
    summary: (nodes) => nodes.summary || nodes.content?.slice(0, 200) || '',
  },
};

/**
 * Adapt a database row to ContentNode format.
 * Uses configuration to determine which field provides content for each node type.
 */
export function adaptToContentNode(
  row: KeywordWithNode,
  nodeType: NodeType,
  mode: ContentMode = 'full'
): ContentNode {
  const getContent = CONTENT_EXTRACTORS[nodeType][mode];

  return {
    id: row.nodes.id,
    keywordId: `kw:${row.keyword}`,
    content: getContent(row.nodes),
    summary: row.nodes.summary ?? undefined,
    sourcePath: row.nodes.source_path ?? undefined,
  };
}
