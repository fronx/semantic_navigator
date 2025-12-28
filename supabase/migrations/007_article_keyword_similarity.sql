-- ============================================================================
-- Article Keyword Similarity Graph
-- ============================================================================
--
-- This function powers the Map view by finding semantically similar keywords
-- across different articles. It enables articles to cluster together based on
-- conceptual similarity, not just exact keyword matches.
--
-- HOW IT WORKS:
-- 1. Gets all article-level keywords (keywords where node_id points to an
--    article node, not paragraph or section)
-- 2. Computes cosine similarity between all keyword pairs from different articles
-- 3. Returns pairs above the similarity threshold
--
-- GRAPH STRUCTURE (built by /api/map):
--   Article A ──→ keyword "agency" ←──┐
--                                     │ similarity edge (0.85)
--   Article B ──→ keyword "agents"  ←─┘
--
-- Articles cluster together because their keywords are connected through
-- semantic similarity edges. This reveals conceptual relationships even when
-- articles use different terminology.
--
-- PERFORMANCE:
-- - Cross-join is O(n²) but with ~800 article-level keywords (100 articles × 8
--   keywords), that's 320K comparisons, which runs in ~1-2 seconds in Postgres.
-- - All computation happens in the database, avoiding network round-trips.
--
-- SEE ALSO:
-- - ADR-005: Hierarchical Keyword Bubbling (explains keyword reduction)
-- - /api/map/route.ts (builds the visualization graph)
-- ============================================================================

create or replace function get_article_keyword_graph(
  similarity_threshold float default 0.75
)
returns table (
  keyword_id uuid,
  keyword_text text,
  article_id uuid,
  article_path text,
  article_size int,
  similar_keyword_id uuid,
  similar_keyword_text text,
  similar_article_id uuid,
  similar_article_path text,
  similar_article_size int,
  similarity float
)
language sql stable
as $$
  with article_keywords as (
    -- Get keywords attached directly to article nodes
    -- (After hierarchical bubbling, each article has 5-10 high-quality keywords)
    select
      k.id as keyword_id,
      k.keyword,
      k.embedding,
      n.id as article_id,
      n.source_path,
      coalesce(char_length(n.summary), 0) as summary_length
    from keywords k
    join nodes n on n.id = k.node_id
    where n.node_type = 'article'
      and k.embedding is not null
  )
  select
    ak1.keyword_id,
    ak1.keyword as keyword_text,
    ak1.article_id,
    ak1.source_path as article_path,
    ak1.summary_length as article_size,
    ak2.keyword_id as similar_keyword_id,
    ak2.keyword as similar_keyword_text,
    ak2.article_id as similar_article_id,
    ak2.source_path as similar_article_path,
    ak2.summary_length as similar_article_size,
    -- Cosine similarity: 1 - cosine distance
    1 - (ak1.embedding <=> ak2.embedding) as similarity
  from article_keywords ak1
  cross join article_keywords ak2
  where
    -- Different keywords (avoid self-match; use < to avoid duplicate pairs)
    ak1.keyword_id < ak2.keyword_id
    -- From different articles (the whole point is cross-article connections)
    and ak1.article_id != ak2.article_id
    -- Above similarity threshold (0.75 default catches "agency"/"agents" type matches)
    and 1 - (ak1.embedding <=> ak2.embedding) >= similarity_threshold
  order by similarity desc;
$$;

comment on function get_article_keyword_graph(float) is
  'Find semantically similar keyword pairs across articles for the Map visualization. '
  'Returns pairs of keywords from different articles with similarity above threshold.';
