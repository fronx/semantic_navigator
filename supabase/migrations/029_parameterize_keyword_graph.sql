-- Create parameterized keyword graph function that accepts node_type
-- Enables switching between article-level and chunk-level keyword graphs

-- Generalized keyword graph function
create or replace function get_keyword_graph(
  filter_node_type text default 'article',
  max_edges_per_node int default 5,
  min_similarity float default 0.3
)
returns table (
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
language sql stable
as $$
  with filtered_keywords as (
    -- Filter by node_type to get article or chunk keywords
    select
      k.id as keyword_id,
      k.keyword,
      k.embedding,
      k.node_id,
      n.source_path,
      coalesce(
        char_length(n.summary),
        char_length(n.content),
        0
      ) as size
    from keywords k
    join nodes n on n.id = k.node_id
    where k.node_type = filter_node_type
      and k.embedding is not null
  )
  select
    fk.keyword_id,
    fk.keyword as keyword_text,
    fk.node_id,
    fk.source_path as node_path,
    fk.size as node_size,
    neighbors.keyword_id as similar_keyword_id,
    neighbors.keyword as similar_keyword_text,
    neighbors.node_id as similar_node_id,
    neighbors.source_path as similar_node_path,
    neighbors.size as similar_node_size,
    1 - (fk.embedding <=> neighbors.embedding) as similarity
  from filtered_keywords fk
  cross join lateral (
    -- Find top-K most similar keywords from same node_type
    select
      k2.id as keyword_id,
      k2.keyword,
      k2.node_id,
      n2.source_path,
      coalesce(
        char_length(n2.summary),
        char_length(n2.content),
        0
      ) as size,
      k2.embedding
    from keywords k2
    join nodes n2 on n2.id = k2.node_id
    where k2.node_type = filter_node_type
      and k2.embedding is not null
      and k2.node_id != fk.node_id
    order by fk.embedding <=> k2.embedding
    limit max_edges_per_node
  ) neighbors
  where 1 - (fk.embedding <=> neighbors.embedding) >= min_similarity;
$$;

-- Keep backward compatibility wrapper
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
  select * from get_keyword_graph('article', max_edges_per_article, min_similarity);
$$;
