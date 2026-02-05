-- Add node_type column to support both article and chunk clusters
-- This enables the granularity mode switcher between article-level and chunk-level views

-- Add node_type column with default 'article' for existing rows
ALTER TABLE precomputed_topic_clusters
  ADD COLUMN node_type text DEFAULT 'article' NOT NULL
  CHECK (node_type IN ('article', 'chunk'));

-- Update primary key to include node_type (articles and chunks can share keyword IDs)
ALTER TABLE precomputed_topic_clusters
  DROP CONSTRAINT precomputed_topic_clusters_pkey;

ALTER TABLE precomputed_topic_clusters
  ADD PRIMARY KEY (resolution, node_id, node_type);

-- Update indexes to include node_type for efficient filtering
DROP INDEX IF EXISTS idx_precomputed_clusters_resolution;
DROP INDEX IF EXISTS idx_precomputed_clusters_cluster;

CREATE INDEX idx_precomputed_clusters_resolution_type
  ON precomputed_topic_clusters(resolution, node_type);

CREATE INDEX idx_precomputed_clusters_cluster_type
  ON precomputed_topic_clusters(resolution, cluster_id, node_type);

-- Update get_precomputed_clusters function to accept node_type filter
CREATE OR REPLACE FUNCTION get_precomputed_clusters(
  target_resolution real,
  filter_node_type text DEFAULT 'article',
  node_ids text[] DEFAULT NULL
)
RETURNS TABLE (
  node_id text,
  cluster_id integer,
  hub_node_id text,
  cluster_label text,
  member_count integer
)
LANGUAGE plpgsql
AS $$
BEGIN
  -- Find nearest precomputed resolution for this node_type
  RETURN QUERY
  SELECT
    pc.node_id,
    pc.cluster_id,
    pc.hub_node_id,
    pc.cluster_label,
    pc.member_count
  FROM precomputed_topic_clusters pc
  WHERE pc.resolution = (
    SELECT resolution
    FROM precomputed_topic_clusters
    WHERE node_type = filter_node_type
    ORDER BY ABS(resolution - target_resolution)
    LIMIT 1
  )
  AND pc.node_type = filter_node_type
  AND (node_ids IS NULL OR pc.node_id = ANY(node_ids));
END;
$$;
