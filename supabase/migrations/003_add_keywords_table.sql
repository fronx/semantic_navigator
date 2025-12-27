-- Keywords table for semantic search anchors
-- Keywords point to nodes but are not content themselves
create table keywords (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  embedding vector(1536),
  node_id uuid not null references nodes(id) on delete cascade,
  created_at timestamptz default now()
);

-- Index for vector similarity search on keywords
create index keywords_embedding_idx on keywords
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Index for looking up keywords by node
create index keywords_node_id_idx on keywords(node_id);

-- Prevent duplicate keywords for the same node
create unique index keywords_node_keyword_idx on keywords(node_id, keyword);

-- Updated search function that queries both nodes and keywords
create or replace function search_similar(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10,
  filter_node_type text default null
)
returns table (
  id uuid,
  content text,
  summary text,
  node_type text,
  source_path text,
  similarity float
)
language sql stable
as $$
  with combined as (
    -- Direct node matches
    select
      nodes.id,
      nodes.content,
      nodes.summary,
      nodes.node_type,
      nodes.source_path,
      1 - (nodes.embedding <=> query_embedding) as similarity
    from nodes
    where
      nodes.embedding is not null
      and (filter_node_type is null or nodes.node_type = filter_node_type)
      and 1 - (nodes.embedding <=> query_embedding) > match_threshold

    union all

    -- Keyword matches resolved to their nodes
    select
      nodes.id,
      nodes.content,
      nodes.summary,
      nodes.node_type,
      nodes.source_path,
      1 - (keywords.embedding <=> query_embedding) as similarity
    from keywords
    join nodes on nodes.id = keywords.node_id
    where
      keywords.embedding is not null
      and (filter_node_type is null or nodes.node_type = filter_node_type)
      and 1 - (keywords.embedding <=> query_embedding) > match_threshold
  ),
  deduplicated as (
    -- Keep highest similarity per node
    select distinct on (id)
      id, content, summary, node_type, source_path, similarity
    from combined
    order by id, similarity desc
  )
  select * from deduplicated
  order by similarity desc
  limit match_count;
$$;
