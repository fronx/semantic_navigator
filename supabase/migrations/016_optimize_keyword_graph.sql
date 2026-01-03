-- Optimize get_article_keyword_graph to avoid O(n²) cross-join
-- Uses LATERAL join with ORDER BY + LIMIT to leverage vector index

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
    ak.keyword_id,
    ak.keyword as keyword_text,
    ak.article_id,
    ak.source_path as article_path,
    ak.summary_length as article_size,
    neighbors.similar_keyword_id,
    neighbors.similar_keyword_text,
    neighbors.similar_article_id,
    neighbors.similar_article_path,
    neighbors.similar_article_size,
    neighbors.similarity
  from article_keywords ak
  cross join lateral (
    select
      k2.id as similar_keyword_id,
      k2.keyword as similar_keyword_text,
      n2.id as similar_article_id,
      n2.source_path as similar_article_path,
      coalesce(char_length(n2.summary), 0) as similar_article_size,
      1 - (ak.embedding <=> k2.embedding) as similarity
    from keywords k2
    join nodes n2 on n2.id = k2.node_id
    where n2.node_type = 'article'
      and k2.embedding is not null
      and n2.id != ak.article_id
    order by ak.embedding <=> k2.embedding
    limit max_edges_per_article
  ) neighbors
  where neighbors.similarity >= min_similarity;
$$;

comment on function get_article_keyword_graph(int, float) is
  'Find top-K semantically similar keyword pairs per article for the Map visualization. '
  'Uses LATERAL join with ORDER BY + LIMIT to leverage vector index.';
