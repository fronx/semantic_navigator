-- Function to get keyword neighborhood for a project
-- Expands from project's associated articles' keywords through similarity edges

CREATE OR REPLACE FUNCTION get_project_neighborhood(
  p_project_id uuid,
  p_hops int DEFAULT 2
)
RETURNS TABLE (
  keyword_id uuid,
  keyword_label text,
  hop_distance int
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  -- Create temp table to accumulate neighborhood
  CREATE TEMP TABLE IF NOT EXISTS _neighborhood (
    kw_id uuid PRIMARY KEY,
    kw_label text,
    distance int
  ) ON COMMIT DROP;

  -- Truncate in case of reuse within transaction
  TRUNCATE _neighborhood;

  -- Step 1: Seed with keywords from project's associated articles
  INSERT INTO _neighborhood (kw_id, kw_label, distance)
  SELECT DISTINCT k.id, k.keyword, 0
  FROM project_associations pa
  JOIN keywords k ON k.node_id = pa.target_id
  WHERE pa.project_id = p_project_id
    AND k.node_type = 'article';

  -- Also include keywords from articles that are children of associated articles
  -- (in case project associates with articles that have article-level keywords)
  INSERT INTO _neighborhood (kw_id, kw_label, distance)
  SELECT DISTINCT k.id, k.keyword, 0
  FROM project_associations pa
  JOIN containment_edges ce ON ce.parent_id = pa.target_id
  JOIN keywords k ON k.node_id = ce.child_id
  WHERE pa.project_id = p_project_id
    AND k.node_type = 'article'
  ON CONFLICT (kw_id) DO NOTHING;

  -- Step 2: Expand through similarity edges for p_hops iterations
  FOR i IN 1..p_hops LOOP
    INSERT INTO _neighborhood (kw_id, kw_label, distance)
    SELECT DISTINCT
      neighbor_id,
      (SELECT keyword FROM keywords WHERE id = neighbor_id),
      i
    FROM (
      -- Get neighbors via keyword_similarities (both directions due to ordering constraint)
      SELECT
        CASE
          WHEN ks.keyword_a_id = n.kw_id THEN ks.keyword_b_id
          ELSE ks.keyword_a_id
        END AS neighbor_id
      FROM _neighborhood n
      JOIN keyword_similarities ks
        ON ks.keyword_a_id = n.kw_id OR ks.keyword_b_id = n.kw_id
      WHERE n.distance = i - 1
    ) neighbors
    ON CONFLICT (kw_id) DO NOTHING;
  END LOOP;

  -- Return results
  RETURN QUERY SELECT kw_id, kw_label, distance FROM _neighborhood;
END;
$$;

COMMENT ON FUNCTION get_project_neighborhood IS
  'Expands from a project through associated articles to find related keywords within N hops of similarity edges.';
