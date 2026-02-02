-- Precomputed topic clusters at fixed resolutions
-- Eliminates runtime Haiku API calls for label generation

CREATE TABLE IF NOT EXISTS precomputed_topic_clusters (
  -- Resolution level (0.5, 1.0, 1.5, 2.0, 3.0, 4.0)
  resolution real NOT NULL,

  -- Node ID (e.g., "kw:machine learning")
  node_id text NOT NULL,

  -- Cluster ID (per resolution, not globally unique)
  cluster_id integer NOT NULL,

  -- Hub node for this cluster (highest degree keyword)
  hub_node_id text NOT NULL,

  -- Semantic label from Haiku (cached)
  cluster_label text NOT NULL,

  -- Number of members in this cluster
  member_count integer NOT NULL,

  -- Metadata
  created_at timestamptz DEFAULT now(),

  -- Composite primary key
  PRIMARY KEY (resolution, node_id)
);

-- Index for querying by resolution
CREATE INDEX idx_precomputed_clusters_resolution
  ON precomputed_topic_clusters(resolution);

-- Index for querying by (resolution, cluster_id)
CREATE INDEX idx_precomputed_clusters_cluster
  ON precomputed_topic_clusters(resolution, cluster_id);

-- Function to query precomputed clusters for a resolution
-- Finds nearest precomputed resolution and returns cluster data
CREATE OR REPLACE FUNCTION get_precomputed_clusters(
  target_resolution real,
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
  -- Find nearest precomputed resolution (within ±0.15)
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
    ORDER BY ABS(resolution - target_resolution)
    LIMIT 1
  )
  AND (node_ids IS NULL OR pc.node_id = ANY(node_ids));
END;
$$;
