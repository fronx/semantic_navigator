export interface MatchedKeyword {
  keyword: string;
  similarity: number;
}

export interface SearchResult {
  id: string;
  content: string;
  summary: string;
  node_type: string;
  source_path: string;
  similarity: number;
  matched_keywords: MatchedKeyword[];
}

export interface SearchOptions {
  limit?: number;
  nodeType?: string;
}

export async function performSearch(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const { limit = 10, nodeType } = options;

  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit, nodeType }),
  });

  if (!res.ok) {
    throw new Error(`Search failed: ${res.statusText}`);
  }

  const data = await res.json();
  return data.results || [];
}
