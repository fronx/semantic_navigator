-- Function to search for similar keywords by embedding (uses pgvector index)
create or replace function search_similar_keywords(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10
)
returns table (
  id uuid,
  keyword text,
  node_id uuid,
  similarity float
)
language sql stable
as $$
  select
    keywords.id,
    keywords.keyword,
    keywords.node_id,
    1 - (keywords.embedding <=> query_embedding) as similarity
  from keywords
  where
    keywords.embedding is not null
    and 1 - (keywords.embedding <=> query_embedding) > match_threshold
  order by keywords.embedding <=> query_embedding
  limit match_count;
$$;
