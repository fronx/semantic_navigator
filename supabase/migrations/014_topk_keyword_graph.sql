-- Replace threshold-based filtering with top-K per article
-- This scales naturally as the corpus grows

create or replace function get_article_keyword_graph(
  max_edges_per_article int default 5,
  min_similarity float default 0.3
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
  ),
  all_pairs as (
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
      1 - (ak1.embedding <=> ak2.embedding) as similarity
    from article_keywords ak1
    cross join article_keywords ak2
    where
      ak1.keyword_id < ak2.keyword_id
      and ak1.article_id != ak2.article_id
      and 1 - (ak1.embedding <=> ak2.embedding) >= min_similarity
  ),
  ranked as (
    -- Rank pairs by similarity within each article
    -- An article can appear on either side, so we rank both ways
    select *,
      row_number() over (partition by article_id order by similarity desc) as rank1,
      row_number() over (partition by similar_article_id order by similarity desc) as rank2
    from all_pairs
  )
  -- Keep pairs where either article hasn't exceeded its quota
  select
    keyword_id, keyword_text, article_id, article_path, article_size,
    similar_keyword_id, similar_keyword_text, similar_article_id, similar_article_path, similar_article_size,
    similarity
  from ranked
  where rank1 <= max_edges_per_article or rank2 <= max_edges_per_article
  order by similarity desc;
$$;

comment on function get_article_keyword_graph(int, float) is
  'Find top-K semantically similar keyword pairs per article for the Map visualization. '
  'Scales naturally as corpus grows by limiting edges per article rather than using fixed threshold.';
