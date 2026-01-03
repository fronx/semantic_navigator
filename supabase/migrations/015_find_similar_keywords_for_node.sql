-- Find top-K similar keywords for a node based on embedding similarity
-- Used when expanding articles to connect chunks to the graph

create or replace function find_similar_keywords_for_node(
  node_embedding vector(1536),
  match_count int default 5,
  min_similarity float default 0.3
)
returns table (
  keyword text,
  similarity float
)
language sql stable
as $$
  select
    k.keyword,
    1 - (k.embedding <=> node_embedding) as similarity
  from keywords k
  join nodes n on n.id = k.node_id
  where
    k.embedding is not null
    and n.node_type = 'article'  -- Only match article-level keywords (those in the graph)
  order by k.embedding <=> node_embedding
  limit match_count;
$$;

comment on function find_similar_keywords_for_node(vector(1536), int, float) is
  'Find top-K keywords most similar to a given node embedding. '
  'Used to connect chunks to the map graph via semantic similarity.';
