-- Rollback optimization experiments (old 031-034).
-- Drops experimental functions/tables and restores get_keyword_graph to its
-- original definition from migration 029.

-- Undo 034: keyword_backbone_cache
DROP TRIGGER IF EXISTS keyword_backbone_cache_dirty_trigger ON keywords;
DROP FUNCTION IF EXISTS mark_keyword_backbone_cache_dirty();
DROP FUNCTION IF EXISTS get_keyword_backbone_source_stats(text);
DROP TABLE IF EXISTS keyword_backbone_cache;

-- Undo 034's paginated rewrites
DROP FUNCTION IF EXISTS get_keyword_graph(text, int, float, int, int);
DROP FUNCTION IF EXISTS get_keyword_graph_lean(text, int, float, int, int);
DROP FUNCTION IF EXISTS get_keyword_metadata(text, int, int, int);

-- Undo 033: lean keyword graph
DROP FUNCTION IF EXISTS get_keyword_graph_lean(text, int, float);

-- Undo 031/032: keyword metadata + chunk HNSW index
DROP FUNCTION IF EXISTS get_keyword_metadata(text, int);
DROP INDEX IF EXISTS idx_keywords_chunk_embedding;

-- Restore get_keyword_graph from migration 029 (in case 034 replaced it)
DROP FUNCTION IF EXISTS get_keyword_graph(text, int, float);

CREATE OR REPLACE FUNCTION get_keyword_graph(
  filter_node_type text default 'article',
  max_edges_per_node int default 5,
  min_similarity float default 0.3
)
RETURNS TABLE (
  keyword_id uuid,
  keyword_text text,
  node_id uuid,
  node_path text,
  node_size int,
  similar_keyword_id uuid,
  similar_keyword_text text,
  similar_node_id uuid,
  similar_node_path text,
  similar_node_size int,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  WITH filtered_keywords AS (
    SELECT
      k.id AS keyword_id,
      k.keyword,
      k.embedding,
      k.node_id,
      n.source_path,
      coalesce(char_length(n.summary), char_length(n.content), 0) AS size
    FROM keywords k
    JOIN nodes n ON n.id = k.node_id
    WHERE k.node_type = filter_node_type
      AND k.embedding IS NOT NULL
  )
  SELECT
    fk.keyword_id,
    fk.keyword AS keyword_text,
    fk.node_id,
    fk.source_path AS node_path,
    fk.size AS node_size,
    neighbors.keyword_id AS similar_keyword_id,
    neighbors.keyword AS similar_keyword_text,
    neighbors.node_id AS similar_node_id,
    neighbors.source_path AS similar_node_path,
    neighbors.size AS similar_node_size,
    1 - (fk.embedding <=> neighbors.embedding) AS similarity
  FROM filtered_keywords fk
  CROSS JOIN LATERAL (
    SELECT
      k2.id AS keyword_id,
      k2.keyword,
      k2.node_id,
      n2.source_path,
      coalesce(char_length(n2.summary), char_length(n2.content), 0) AS size,
      k2.embedding
    FROM keywords k2
    JOIN nodes n2 ON n2.id = k2.node_id
    WHERE k2.node_type = filter_node_type
      AND k2.embedding IS NOT NULL
      AND k2.node_id != fk.node_id
    ORDER BY fk.embedding <=> k2.embedding
    LIMIT max_edges_per_node
  ) neighbors
  WHERE 1 - (fk.embedding <=> neighbors.embedding) >= min_similarity;
$$;
