-- Denormalize node_type into keywords table for efficient filtering
-- This avoids the join to nodes table which prevents index usage

-- Add node_type column to keywords
alter table keywords add column if not exists node_type text;

-- Backfill from nodes table
update keywords k
set node_type = n.node_type
from nodes n
where k.node_id = n.id
  and k.node_type is null;

-- Create partial index for article-level keywords only
-- Using HNSW (more memory-efficient than IVFFlat for index building)
create index if not exists idx_keywords_article_embedding
on keywords using hnsw (embedding vector_cosine_ops)
where node_type = 'article';

-- Update get_article_keyword_graph to use the denormalized column
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
    -- Now we can filter directly on keywords.node_type without joining
    select
      k.id as keyword_id,
      k.keyword,
      k.embedding,
      k.node_id as article_id,
      n.source_path,
      coalesce(char_length(n.summary), 0) as summary_length
    from keywords k
    join nodes n on n.id = k.node_id
    where k.node_type = 'article'
      and k.embedding is not null
  )
  select
    ak.keyword_id,
    ak.keyword as keyword_text,
    ak.article_id,
    ak.source_path as article_path,
    ak.summary_length as article_size,
    neighbors.keyword_id as similar_keyword_id,
    neighbors.keyword as similar_keyword_text,
    neighbors.article_id as similar_article_id,
    neighbors.source_path as similar_article_path,
    neighbors.summary_length as similar_article_size,
    1 - (ak.embedding <=> neighbors.embedding) as similarity
  from article_keywords ak
  cross join lateral (
    -- This subquery can now use the partial index
    select
      k2.id as keyword_id,
      k2.keyword,
      k2.node_id as article_id,
      n2.source_path,
      coalesce(char_length(n2.summary), 0) as summary_length,
      k2.embedding
    from keywords k2
    join nodes n2 on n2.id = k2.node_id
    where k2.node_type = 'article'
      and k2.embedding is not null
      and k2.node_id != ak.article_id
    order by ak.embedding <=> k2.embedding
    limit max_edges_per_article
  ) neighbors
  where 1 - (ak.embedding <=> neighbors.embedding) >= min_similarity;
$$;

-- Also update find_similar_keywords_for_node to use the partial index
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
  where k.node_type = 'article'
    and k.embedding is not null
  order by k.embedding <=> node_embedding
  limit match_count;
$$;
